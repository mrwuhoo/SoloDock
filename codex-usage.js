// Read-only Codex app-server integration. Never read/copy auth.json or start a turn.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const shortText = (value) => typeof value === 'string' ? value.slice(0, 100) : null;

function normalizeUsage(result, now = Date.now()) {
  const mapped = result?.rateLimitsByLimitId;
  const entries = mapped && typeof mapped === 'object' && !Array.isArray(mapped) && Object.keys(mapped).length
    ? Object.entries(mapped) : result?.rateLimits ? [['codex', result.rateLimits]] : [];
  const buckets = entries.map(([id, bucket]) => ({
    id: shortText(id),
    name: shortText(bucket?.limitName) || shortText(id),
    plan: shortText(bucket?.planType),
    windows: ['primary', 'secondary'].flatMap((key) => {
      const item = bucket?.[key];
      if (!item || typeof item !== 'object') return [];
      const used = finite(item.usedPercent) ? Math.max(0, Math.min(100, item.usedPercent)) : null;
      return [{
        key,
        remainingPercent: used === null ? null : 100 - used,
        durationMinutes: finite(item.windowDurationMins) && item.windowDurationMins > 0 ? item.windowDurationMins : null,
        resetsAt: finite(item.resetsAt) && item.resetsAt > 0 && item.resetsAt < 8640000000000 ? item.resetsAt * 1000 : null,
      }];
    }),
  }));
  const count = result?.rateLimitResetCredits?.availableCount;
  const resetCredits = Number.isInteger(count) && count >= 0 ? count : null;
  return { ok: true, updatedAt: now, buckets, resetCredits };
}

function findCodex({ platform = process.platform, env = process.env, access = fs.accessSync } = {}) {
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  const candidates = platform === 'darwin' ? [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    path.join(os.homedir(), 'Applications/Codex.app/Contents/Resources/codex'),
    path.join(os.homedir(), 'Applications/ChatGPT.app/Contents/Resources/codex'),
    '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
  ] : [];
  for (const directory of (env.PATH || '').split(platform === 'win32' ? ';' : ':')) {
    // Do not resolve executables from the current project or a relative PATH entry.
    if ((platform === 'win32' ? path.win32 : path).isAbsolute(directory)) {
      candidates.push((platform === 'win32' ? path.win32 : path).join(directory, executable));
    }
  }
  return candidates.find((candidate) => {
    try { access(candidate, fs.constants.X_OK); return true; } catch { return false; }
  }) || null;
}

function createCodexUsageService({ spawnProcess = spawn, locate = findCodex, now = Date.now, timeoutMs = 20000 } = {}) {
  let pending = null;
  let cancel = null;
  let cached = null;
  let cachedAt = 0;
  let disposed = false;

  function request() {
    return new Promise((resolve) => {
      const executable = locate();
      if (!executable) return resolve({ ok: false, error: 'not_installed' });
      let child;
      try {
        child = spawnProcess(executable, ['app-server', '--stdio'], {
          cwd: os.homedir(), shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch { return resolve({ ok: false, error: 'unavailable' }); }
      let complete = false;
      let buffer = '';
      let totalBytes = 0;
      let initialized = false;
      const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
      const finish = (result) => {
        if (complete) return;
        complete = true;
        clearTimeout(timer);
        cancel = null;
        child.stdin.end();
        child.kill();
        const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 1500);
        killTimer.unref();
        child.once('exit', () => clearTimeout(killTimer));
        resolve(result);
      };
      cancel = () => finish({ ok: false, error: 'cancelled' });
      const send = (message) => { if (!complete) child.stdin.write(`${JSON.stringify(message)}\n`); };
      // Drain diagnostics without retaining or exposing paths, account data or tokens.
      child.stderr.resume();
      child.on('error', () => finish({ ok: false, error: 'unavailable' }));
      child.on('exit', () => finish({ ok: false, error: 'unavailable' }));
      child.stdin.on('error', () => finish({ ok: false, error: 'unavailable' }));
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        if (complete) return;
        totalBytes += Buffer.byteLength(data);
        if (totalBytes > 1024 * 1024) return finish({ ok: false, error: 'invalid_response' });
        buffer += data;
        let newline;
        while (!complete && (newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { continue; }
          if (message.id === 1 && !initialized) {
            if (message.error || !message.result) return finish({ ok: false, error: 'unsupported' });
            initialized = true;
            send({ method: 'initialized', params: {} });
            send({ id: 2, method: 'account/rateLimits/read' });
          } else if (message.id === 2 && initialized) {
            if (message.error) {
              const text = String(message.error.message || '');
              const error = /not logged|unauth|sign.in|auth.*required|requires.*auth|requires.*ChatGPT/i.test(text)
                ? 'login_required' : message.error.code === -32601 ? 'unsupported' : 'read_failed';
              return finish({ ok: false, error });
            }
            if (!message.result || typeof message.result !== 'object') return finish({ ok: false, error: 'invalid_response' });
            finish(normalizeUsage(message.result, now()));
          }
        }
      });
      send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'solodock', title: 'SoloDock', version: '0.1.0' } } });
    });
  }

  return {
    read() {
      if (disposed) return Promise.resolve({ ok: false, error: 'cancelled' });
      if (pending) return pending;
      if (cached && now() - cachedAt < 60000) return Promise.resolve(cached);
      pending = request().catch(() => ({ ok: false, error: 'unavailable' })).then((result) => {
        cached = result;
        cachedAt = now();
        pending = null;
        return result;
      });
      return pending;
    },
    dispose() { disposed = true; cancel?.(); cached = null; },
  };
}

module.exports = { normalizeUsage, findCodex, createCodexUsageService };
