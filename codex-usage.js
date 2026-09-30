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

// 装 Codex 的应用包：独立的 Codex 桌面端，以及内置 Codex 的 ChatGPT 桌面端。
const CODEX_APP_BUNDLES = ['Codex.app', 'ChatGPT.app'];

// 应用包里有一份官方清单 codex-package.json，写明入口（entrypoint，例如 bin/codex）。
// 按清单找，App 以后在包里挪文件也不会再「连不上」。
function manifestEntrypoints(appPath, { readFile, readdir }) {
  const resources = path.join(appPath, 'Contents', 'Resources');
  const dirs = ['codex-cli'];
  try {
    for (const entry of readdir(resources)) {
      const name = typeof entry === 'string' ? entry : entry.name;
      if (/codex/i.test(name) && !dirs.includes(name)) dirs.push(name);
    }
  } catch {}
  const found = [];
  for (const dir of dirs) {
    const base = path.join(resources, dir);
    try {
      const manifest = JSON.parse(readFile(path.join(base, 'codex-package.json'), 'utf8'));
      const entry = typeof manifest.entrypoint === 'string' ? manifest.entrypoint : '';
      // 只接受包内的相对路径，不跟随绝对路径或 ..。
      if (!entry || path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) continue;
      found.push(path.join(base, entry));
    } catch {}
  }
  return found;
}

// 兜底：清单和已知路径都找不到时，在应用包的 Resources 里限定深度找名为 codex 的可执行文件。
function searchBundle(appPath, { readdir, access }, maxDepth = 5) {
  const queue = [[path.join(appPath, 'Contents', 'Resources'), 0]];
  let visited = 0;
  while (queue.length && visited < 400) {
    const [dir, depth] = queue.shift();
    visited += 1;
    let entries;
    try { entries = readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth && !/\.(framework|lproj)$|^node_modules$/.test(entry.name)) queue.push([full, depth + 1]);
      } else if (entry.name === 'codex') {
        try { access(full, fs.constants.X_OK); return full; } catch {}
      }
    }
  }
  return null;
}

// 找本机的 Codex 客户端。从访达打开的 App 拿不到终端里的 PATH，所以常见的命令行安装位置要写全；
// 不执行任何 shell，也不从相对路径解析。
function findCodex({
  platform = process.platform,
  env = process.env,
  access = fs.accessSync,
  readFile = fs.readFileSync,
  readdir = fs.readdirSync,
  home = os.homedir(),
} = {}) {
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  const apps = platform === 'darwin'
    ? ['/Applications', path.join(home, 'Applications')].flatMap((root) => CODEX_APP_BUNDLES.map((name) => path.join(root, name)))
    : [];
  const candidates = apps.flatMap((app) => manifestEntrypoints(app, { readFile, readdir }));
  if (platform === 'darwin') {
    for (const app of apps) {
      candidates.push(
        path.join(app, 'Contents/Resources/codex'),
        path.join(app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),
      );
    }
    candidates.push(
      '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
      path.join(home, '.local/bin/codex'), path.join(home, '.npm-global/bin/codex'), path.join(home, '.bun/bin/codex'),
    );
  }
  for (const directory of (env.PATH || '').split(platform === 'win32' ? ';' : ':')) {
    // Do not resolve executables from the current project or a relative PATH entry.
    if ((platform === 'win32' ? path.win32 : path).isAbsolute(directory)) {
      candidates.push((platform === 'win32' ? path.win32 : path).join(directory, executable));
    }
  }
  const usable = (candidate) => {
    try { access(candidate, fs.constants.X_OK); return true; } catch { return false; }
  };
  const hit = [...new Set(candidates)].find(usable);
  if (hit) return hit;
  for (const app of apps) {
    const found = searchBundle(app, { readdir, access });
    if (found) return found;
  }
  return null;
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
