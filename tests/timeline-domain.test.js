const test = require('node:test');
const assert = require('node:assert/strict');
const tl = require('../renderer/timeline-domain');

const now = new Date(2026, 8, 24, 14, 26).getTime();
const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();

test('the axis runs from 08:00 to 24:00 and hides times outside it', () => {
  assert.equal(tl.axisPercent(at(24, 8), now), 0);
  assert.equal(tl.axisPercent(at(24, 16), now), 50);
  assert.equal(tl.axisPercent(at(24, 7, 59), now), null);
  assert.equal(tl.axisPercent(at(25, 9), now), null);
});

test('quick event input understands common Chinese time phrases', () => {
  assert.deepEqual(tl.parseEventInput('3点 客户电话 30分钟', now), { title: '客户电话', start: at(24, 15), durationMin: 30 });
  assert.deepEqual(tl.parseEventInput('下午4点半 复盘会 1小时', now), { title: '复盘会', start: at(24, 16, 30), durationMin: 60 });
  assert.deepEqual(tl.parseEventInput('明天 10:00 牙医', now), { title: '牙医', start: at(25, 10), durationMin: 30 });
  assert.deepEqual(tl.parseEventInput('上午9点 站会 15分钟', now), { title: '站会', start: at(24, 9), durationMin: 15 });
  assert.equal(tl.parseEventInput('客户电话', now), null, 'a time is required');
  assert.equal(tl.parseEventInput('25:00 x', now), null);
});

test('reminder queue includes upcoming events ahead of time and later reminders', () => {
  const events = [
    { id: 'call', title: '客户电话', start: at(24, 15), durationMin: 30, remindMin: 10 },
    { id: 'past', title: '早会', start: at(24, 9), durationMin: 30, remindMin: 10 },
    { id: 'done', title: '已提醒', start: at(24, 18), durationMin: 30, remindMin: 10, remindedAt: now },
  ];
  const later = [{ id: 'l1', note: '看导出进度', at: now + 20 * 60000 }];
  const queue = tl.reminderQueue(events, later, now);
  assert.deepEqual(queue.map((item) => [item.id, item.at]), [
    ['later-l1', now + 20 * 60000],
    ['event-call', at(24, 14, 50)],
  ].sort((a, b) => a[1] - b[1]));
  assert.equal(queue.find((item) => item.kind === 'event').detail, '10 分钟后开始');
});

test('later presets and the day summary', () => {
  assert.equal(tl.laterAt('30', now), now + 30 * 60000);
  assert.equal(tl.laterAt('evening', now), at(24, 20));
  assert.equal(tl.laterAt('evening', at(24, 21)), at(25, 20));
  assert.equal(tl.summary({ dueCount: 4, eventCount: 1, focusMinutes: 75 }), '4 项到期 · 1 个日程 · 已专注 75 分钟');
  assert.equal(tl.summary({}), '今天还没有安排');
  assert.equal(tl.eventsForDay([{ id: 'a', title: 'x', start: at(25, 9) }, { id: 'b', title: 'y', start: at(24, 9) }], now).length, 1);
});
