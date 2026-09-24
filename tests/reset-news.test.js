const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeResetNews, createResetNewsService } = require('../reset-news');

test('public reset data is reduced to dated records and safe source links', () => {
  const result = normalizeResetNews({
    timezone: 'Asia/Shanghai', today: '2026-09-24', checkedAt: '2026-09-24T10:00:00+08:00',
    events: [
      { id: 'one', status: 'confirmed', type: 'reset_credit', occurredOn: '2026-09-23', title: '<img onerror=alert(1)>', posts: [{ text: '公开消息', url: 'javascript:alert(1)' }] },
      { id: 'two', status: 'announced', type: 'direct_reset', schedule: { from: '2026-09-25T15:00:00+08:00', label: '北京时间预计 9月25日' }, posts: [{ text: '预告', url: 'https://x.com/thsottiaux/status/1' }] },
    ],
  });
  assert.deepEqual(result.events.map(({ day, status, kind }) => ({ day, status, kind })), [
    { day: '2026-09-23', status: 'confirmed', kind: 'credit' },
    { day: '2026-09-25', status: 'announced', kind: 'reset' },
  ]);
  assert.equal(result.events[0].posts[0].url, '');
  assert.equal(result.events[1].posts[0].url, 'https://x.com/thsottiaux/status/1');
});

test('reset news service deduplicates reads and keeps last data when network fails', async () => {
  let calls = 0;
  let time = 1000000;
  const service = createResetNewsService({ now: () => time, fetcher: async () => {
    calls += 1;
    if (calls === 2) throw new Error('timeout');
    return { ok: true, events: [{ day: '2026-09-23' }] };
  } });
  const [first, second] = await Promise.all([service.read(), service.read()]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  await service.read();
  assert.equal(calls, 1);
  time += 16 * 60 * 1000;
  const stale = await service.read();
  assert.equal(calls, 2);
  assert.equal(stale.stale, true);
  assert.equal(stale.events[0].day, '2026-09-23');
});
