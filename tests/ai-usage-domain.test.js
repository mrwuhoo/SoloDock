const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../renderer/ai-usage-domain');

test('subscriptions default to Codex on and Claude off, and keep the saved order', () => {
  const defaults = ai.normalizeSubscriptions(null);
  assert.deepEqual(defaults.map((item) => [item.id, item.enabled]), [['codex', true], ['claude', false]]);
  const saved = ai.normalizeSubscriptions([
    { id: 'manual-grok', name: 'Grok', plan: 'SuperGrok', renewalDay: 18 },
    { id: 'claude', enabled: true, plan: 'Max', renewalDay: 3 },
    { id: 'codex', enabled: true, plan: 'Plus' },
    { id: 'manual-bad id', name: 'x' },
    { id: 'manual-empty', name: '  ' },
  ]);
  assert.deepEqual(saved.map((item) => item.id), ['manual-grok', 'claude', 'codex']);
  assert.equal(saved[0].mark, 'G');
  assert.equal(saved[1].renewalDay, 3);
});

test('the home card shows at most three enabled subscriptions in order', () => {
  const list = ai.normalizeSubscriptions([
    { id: 'codex' }, { id: 'claude', enabled: true },
    { id: 'manual-a', name: 'Grok' }, { id: 'manual-b', name: 'Gemini' },
    { id: 'manual-c', name: 'Kimi', enabled: false },
  ]);
  assert.deepEqual(ai.homeSubscriptions(list).map((item) => item.id), ['codex', 'claude', 'manual-a']);
});

test('renewal countdown handles today, next month and short months', () => {
  const now = new Date(2026, 8, 24, 14, 0).getTime();
  assert.deepEqual(
    (({ daysLeft, label }) => ({ daysLeft, label }))(ai.renewalInfo(12, now)),
    { daysLeft: 18, label: '10月12日' }
  );
  assert.equal(ai.renewalInfo(24, now).daysLeft, 0);
  assert.equal(ai.renewalInfo(31, new Date(2026, 1, 10).getTime()).label, '2月28日');
  assert.equal(ai.renewalInfo(0, now), null);
  const progress = ai.renewalInfo(12, now).progress;
  assert.ok(progress > 0.35 && progress < 0.45);
});

test('Claude summary uses the tightest live window and never shows expired quota', () => {
  const now = 1_790_000_000_000;
  const ready = ai.claudeSummary({
    ok: true, receivedAt: now - 60_000,
    fiveHour: { usedPercent: 82, resetsAt: now + 2 * 3600_000 },
    sevenDay: { usedPercent: 46, resetsAt: now + 3 * 86400_000 },
  }, now);
  assert.equal(ready.state, 'ready');
  assert.equal(ready.primary.label, '5 小时');
  assert.equal(ready.primary.remaining, 18);
  assert.equal(ready.secondary.remaining, 54);
  const stale = ai.claudeSummary({ ok: true, fiveHour: { usedPercent: 10, resetsAt: now - 1 } }, now);
  assert.equal(stale.state, 'stale');
  assert.equal(ai.claudeSummary({ ok: false }, now).state, 'disconnected');
  assert.equal(ai.level(18), 'low');
  assert.equal(ai.level(4), 'critical');
});

test('usage detail windows: weekly first, stale numbers hidden, low windows get an estimate', () => {
  const Ai = require('../renderer/ai-usage-domain');
  const at = (text) => new Date(text).getTime();
  const now = at('2026-09-24T14:00:00'); // Thursday
  const codex = Ai.detailWindows('codex', { buckets: [{ id: 'codex', name: 'codex', windows: [
    { key: 'primary', remainingPercent: 70, durationMinutes: 300, resetsAt: at('2026-09-24T16:00:00') },
    { key: 'secondary', remainingPercent: 18, durationMinutes: 10080, resetsAt: at('2026-09-26T14:00:00') },
  ] }, { id: 'other', name: 'GPT-5 Pro', windows: [{ key: 'primary', remainingPercent: 50, durationMinutes: 1440, resetsAt: at('2026-09-23T10:00:00') }] }] }, now);
  assert.deepEqual(codex.map((item) => [item.label, item.remaining, item.level]), [['本周', 18, 'low'], ['GPT-5 Pro · 1 天', null, 'unknown'], ['5 小时', 70, 'normal']]);
  assert.equal(codex[1].expired, true, 'past the reset time: the old number is not shown');
  // Weekly window started Sep 19 14:00; 82% used in 5 days → 16.4%/day → 18% lasts ~1.1 days, before Saturday's reset.
  assert.equal(codex[0].estimate.state, 'runs-out');
  assert.ok(Math.abs(codex[0].estimate.at - (now + 18 / 16.4 * 86400000)) < 60000);
  assert.deepEqual(codex[2].estimate, { state: 'none' }, 'only low windows get an estimate');
  // Plenty of time left at a slow pace: enough until the reset.
  assert.deepEqual(Ai.exhaustEstimate({ remaining: 15, resetsAt: now + 3600000, durationMinutes: 10080 }, now), { state: 'enough' });
  assert.deepEqual(Ai.exhaustEstimate({ remaining: 15, resetsAt: null, durationMinutes: 300 }, now), { state: 'none' });
  const claude = Ai.detailWindows('claude', { fiveHour: { usedPercent: 96, resetsAt: at('2026-09-24T15:00:00') }, sevenDay: { usedPercent: 30, resetsAt: at('2026-09-28T09:00:00') } }, now);
  assert.deepEqual(claude.map((item) => [item.label, item.remaining, item.level]), [['本周', 70, 'normal'], ['5 小时', 4, 'critical']]);
  assert.equal(Ai.momentLabel(at('2026-09-24T16:40:00'), now), '今天 16:40');
  assert.equal(Ai.momentLabel(at('2026-09-25T09:00:00'), now), '明天 09:00');
  assert.equal(Ai.momentLabel(at('2026-09-26T09:00:00'), now), '周六 09:00');
  assert.equal(Ai.momentLabel(at('2026-10-03T09:00:00'), now), '10月3日 09:00');
  assert.deepEqual(Ai.detailWindows('claude', null, now), []);
});
