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
