const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { normalizeUsage, findCodex, createCodexUsageService } = require('../codex-usage');

test('prefer per-bucket limits and preserve missing values, without account identifiers', () => {
  const result = normalizeUsage({
    accountId: 'private', rateLimits: { primary: { usedPercent: 1 } },
    rateLimitsByLimitId: {
      codex: { planType: 'unknown-plan', primary: { usedPercent: 87, windowDurationMins: 10080, resetsAt: 1800000000 }, secondary: null },
      other: { primary: { usedPercent: null, windowDurationMins: null, resetsAt: null } },
    },
  }, 123);
  assert.equal(result.updatedAt, 123);
  assert.equal(result.buckets[0].plan, 'unknown-plan');
  assert.deepEqual(result.buckets[0].windows, [{ key: 'primary', remainingPercent: 13, durationMinutes: 10080, resetsAt: 1800000000000 }]);
  assert.deepEqual(result.buckets[1].windows, [{ key: 'primary', remainingPercent: null, durationMinutes: null, resetsAt: null }]);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('fallback supports both windows and clamps consumption; empty is not full quota', () => {
  const data = normalizeUsage({ rateLimits: { primary: { usedPercent: 110 }, secondary: { usedPercent: -2 } } });
  assert.deepEqual(data.buckets[0].windows.map((w) => w.remainingPercent), [0, 100]);
  assert.deepEqual(normalizeUsage({}).buckets, []);
  assert.equal(normalizeUsage({ rateLimits: { primary: { usedPercent: '10' } } }).buckets[0].windows[0].remainingPercent, null);
});

test('discovery never executes a relative PATH entry or a shell command', () => {
  const checked = [];
  const found = findCodex({ platform: 'linux', env: { PATH: '.:relative:/usr/local/bin' }, access(file) { checked.push(file); } });
  assert.equal(found, '/usr/local/bin/codex');
  assert.deepEqual(checked, ['/usr/local/bin/codex']);
});

// A fake file system for discovery tests: files is a set of executable paths, manifests maps a path to JSON,
// dirs maps a folder to its entries (a trailing "/" marks a folder).
function fakeFs({ files = [], manifests = {}, dirs = {} } = {}) {
  const executables = new Set(files);
  return {
    home: '/Users/me',
    access(file) { if (!executables.has(file)) throw new Error('ENOENT'); },
    readFile(file) {
      if (!(file in manifests)) throw new Error('ENOENT');
      return JSON.stringify(manifests[file]);
    },
    readdir(dir, options) {
      if (!(dir in dirs)) throw new Error('ENOENT');
      return dirs[dir].map((name) => (options && options.withFileTypes
        ? { name: name.replace(/\/$/, ''), isDirectory: () => name.endsWith('/') }
        : name.replace(/\/$/, '')));
    },
  };
}

test('finds Codex through the manifest the ChatGPT app ships, even with a macOS GUI PATH', () => {
  const base = '/Applications/ChatGPT.app/Contents/Resources/codex-cli';
  const found = findCodex({
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    ...fakeFs({ files: [`${base}/bin/codex`], manifests: { [`${base}/codex-package.json`]: { entrypoint: 'bin/codex' } } }),
  });
  assert.equal(found, `${base}/bin/codex`);
});

test('a manifest can only point inside its own package', () => {
  const base = '/Applications/ChatGPT.app/Contents/Resources/codex-cli';
  for (const entrypoint of ['../../../../../../usr/bin/evil', '/usr/bin/evil']) {
    const found = findCodex({
      platform: 'darwin',
      env: { PATH: '' },
      ...fakeFs({ files: ['/usr/bin/evil'], manifests: { [`${base}/codex-package.json`]: { entrypoint } } }),
    });
    assert.equal(found, null, entrypoint);
  }
});

test('falls back to the known bundled path when there is no manifest', () => {
  const bundled = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
  assert.equal(findCodex({ platform: 'darwin', env: { PATH: '/usr/bin' }, ...fakeFs({ files: [bundled] }) }), bundled);
});

test('if the app moves Codex somewhere new, a bounded search inside the bundle still finds it', () => {
  const res = '/Applications/ChatGPT.app/Contents/Resources';
  const moved = `${res}/tools/next/Codex.app/Contents/MacOS/codex`;
  const found = findCodex({
    platform: 'darwin',
    env: { PATH: '' },
    ...fakeFs({
      files: [moved],
      dirs: {
        [res]: ['tools/', 'Electron Framework.framework/', 'en.lproj/'],
        [`${res}/tools`]: ['next/'],
        [`${res}/tools/next`]: ['Codex.app/'],
        [`${res}/tools/next/Codex.app`]: ['Contents/'],
        [`${res}/tools/next/Codex.app/Contents`]: ['MacOS/'],
        [`${res}/tools/next/Codex.app/Contents/MacOS`]: ['codex'],
      },
    }),
  });
  assert.equal(found, moved);
});

function fixture({ respond, timeoutMs = 1000 } = {}) {
  const messages = [];
  const children = [];
  let time = 100000;
  const service = createCodexUsageService({
    locate: () => '/trusted/codex', now: () => time, timeoutMs,
    spawnProcess(file, args, options) {
      assert.equal(file, '/trusted/codex');
      assert.deepEqual(args, ['app-server', '--stdio']);
      assert.equal(options.shell, false);
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.exitCode = null;
      child.kill = () => { child.killed = true; child.exitCode = 0; queueMicrotask(() => child.emit('exit', 0)); };
      let input = '';
      child.stdin.on('data', (data) => {
        input += data;
        let i;
        while ((i = input.indexOf('\n')) !== -1) {
          const message = JSON.parse(input.slice(0, i)); input = input.slice(i + 1);
          messages.push(message);
          queueMicrotask(() => respond?.(message, child));
        }
      });
      children.push(child);
      return child;
    },
  });
  return { service, messages, children, advance: () => { time += 60001; } };
}
function reply(child, value) { child.stdout.write(`${JSON.stringify(value)}\n`); }
function handshake(message, child) {
  if (message.id === 1) reply(child, { id: 1, result: {} });
}

test('read-only handshake, fragmented responses, deduplication, cache expiry and cleanup', async () => {
  const f = fixture({ respond(message, child) {
    handshake(message, child);
    if (message.id === 2) {
      const output = JSON.stringify({ id: 2, result: { rateLimits: { primary: { usedPercent: 42 } } } });
      child.stdout.write(output.slice(0, 9)); child.stdout.write(`${output.slice(9)}\n`);
    }
  } });
  const a = f.service.read(); const b = f.service.read();
  assert.equal(a, b);
  assert.equal((await a).buckets[0].windows[0].remainingPercent, 58);
  assert.deepEqual(f.messages.map((m) => m.method), ['initialize', 'initialized', 'account/rateLimits/read']);
  await f.service.read(); assert.equal(f.children.length, 1);
  f.advance(); await f.service.read(); assert.equal(f.children.length, 2);
  assert.ok(f.children.every((child) => child.killed));
  f.service.dispose();
  assert.equal((await f.service.read()).error, 'cancelled');
});

test('missing CLI returns actionable state without launching anything', async () => {
  const service = createCodexUsageService({ locate: () => null, spawnProcess: () => assert.fail('must not spawn') });
  assert.deepEqual(await service.read(), { ok: false, error: 'not_installed' });
});

for (const [message, code, expected] of [
  ['not logged in: private account details', -32000, 'login_required'],
  ['network failed: secret details', -32000, 'read_failed'],
  ['unknown method', -32601, 'unsupported'],
]) {
  test(`server errors are redacted: ${expected}`, async () => {
    const f = fixture({ respond(m, child) {
      handshake(m, child);
      if (m.id === 2) reply(child, { id: 2, error: { code, message } });
    } });
    assert.deepEqual(await f.service.read(), { ok: false, error: expected });
    assert.ok(f.children[0].killed);
  });
}

test('timeout and app shutdown terminate child processes', async () => {
  const f = fixture({ timeoutMs: 15 });
  assert.equal((await f.service.read()).error, 'timeout');
  assert.ok(f.children[0].killed);
  const second = fixture();
  const pending = second.service.read(); second.service.dispose();
  assert.equal((await pending).error, 'cancelled');
  assert.ok(second.children[0].killed);
});

test('oversized output is bounded and an unexpected exit does not hang', async () => {
  const f = fixture({ respond(m, child) { child.stdout.write('x'.repeat(1024 * 1024 + 1)); } });
  assert.equal((await f.service.read()).error, 'invalid_response');
  const second = fixture({ respond(m, child) { child.emit('exit', 1); } });
  assert.equal((await second.service.read()).error, 'unavailable');
});

test('reset credits distinguish unknown from zero without leaking credit identifiers', () => {
  assert.equal(normalizeUsage({}).resetCredits, null);
  assert.equal(normalizeUsage({rateLimitResetCredits:{availableCount:0}}).resetCredits, 0);
  const result = normalizeUsage({rateLimitResetCredits:{availableCount:2,credits:[{id:'private-credit'}]}});
  assert.equal(result.resetCredits, 2);
  assert.ok(!JSON.stringify(result).includes('private-credit'));
});
