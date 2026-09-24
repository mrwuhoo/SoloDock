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

test('eight homepage widgets fit every visible subset and each requested usage size', () => {
  const domain = require('../renderer/domain');
  const sizes = {music:'medium',pomodoro:'mini',windows:'medium',recorder:'small',mirror:'medium',note:'medium',commands:'mini',usage:'medium'};
  const ids = Object.keys(sizes);
  for (let mask = 0; mask < 255; mask++) {
    const hidden = ids.filter((_,i) => mask & (1 << i));
    const layout = domain.resolveHomeWidgetLayout(ids,sizes,hidden);
    assert.ok(domain.validateHomeWidgetLayout(layout, ids.filter(id => !hidden.includes(id))), `visibility mask ${mask}`);
  }
  for (const size of ['mini','small','medium','large']) {
    const normalized = domain.normalizeHomeWidgetSizes({...sizes,usage:size},sizes,'usage',48);
    const layout = domain.resolveHomeWidgetLayout(ids,normalized,[]);
    assert.equal(normalized.usage,size);
    assert.ok(domain.validateHomeWidgetLayout(layout,ids));
  }
});
