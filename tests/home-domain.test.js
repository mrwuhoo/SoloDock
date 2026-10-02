const test = require('node:test');
const assert = require('node:assert/strict');
const Home = require('../renderer/home-domain');

const at = (hour, minute = 0, day = 29) => new Date(2026, 8, day, hour, minute).getTime();

test('countdown and duration text read naturally', () => {
  assert.equal(Home.countdown(25 * 60), '25:00');
  assert.equal(Home.countdown(249.2), '04:10');
  assert.equal(Home.countdown(-3), '00:00');
  assert.equal(Home.durationText(45), '45 分钟');
  assert.equal(Home.durationText(60), '1 小时');
  assert.equal(Home.durationText(75), '1 小时 15 分');
  assert.deepEqual(Home.durationParts(320), [{ value: '5', unit: '小时' }, { value: '20', unit: '分' }]);
  assert.deepEqual(Home.durationParts(12), [{ value: '12', unit: '分钟' }]);
  assert.equal(Home.untilText(100 * 60000), '1 小时 40 分后');
});

test('focus minutes stay on the four choices and migrate the old timer', () => {
  assert.equal(Home.focusMinutes(45), 45);
  assert.equal(Home.focusMinutes(30), 25);
  assert.equal(Home.focusMinutes('x'), 25);
  assert.equal(Home.focusMinutesFromLegacy([15, 0]), 15);
  assert.equal(Home.focusMinutesFromLegacy([5, 0]), 25, 'the old 5 minute default becomes 25');
  assert.equal(Home.focusMinutesFromLegacy([0, 45, 0]), 45);
  assert.equal(Home.focusMinutesFromLegacy([25, 30]), 25);
  assert.equal(Home.focusMinutesFromLegacy(null), 25);
});

test('the time disc is a 60-minute face drawn clockwise from 12 o\'clock', () => {
  assert.deepEqual(Home.discFraction(25 * 60), { fraction: 25 / 60, overflow: 0 });
  assert.deepEqual(Home.discFraction(65 * 60), { fraction: 1, overflow: 5 / 60 });
  assert.deepEqual(Home.discFraction(-3), { fraction: 0, overflow: 0 });
  assert.equal(Home.wedgePath(50, 50, 40, 0), '');
  assert.equal(Home.wedgePath(50, 50, 40, 0.25), 'M50 50L50 10A40 40 0 0 1 90 50Z');
  assert.equal(Home.wedgePath(50, 50, 40, 0.75), 'M50 50L50 10A40 40 0 1 1 10 50Z');
  assert.match(Home.wedgePath(50, 50, 40, 1), /^M50 10A40 40 0 1 1 50 90A40 40 0 1 1 50 10Z$/);
  assert.equal(Home.remainingText(14 * 60 + 32), '还剩 15 分钟');
  assert.equal(Home.remainingText(20), '还剩 1 分钟');
  assert.equal(Home.remainingText(190, 'break'), '休息还剩 4 分钟');
});

test('today focus counts full sessions as tomatoes and early stops as minutes only', () => {
  const log = [
    { start: at(8), end: at(8, 25), minutes: 25 },
    { start: at(10), end: at(10, 25), minutes: 25, complete: true },
    { start: at(11), end: at(11, 12), minutes: 12, complete: false },
    { start: at(9, 0, 28), end: at(9, 25, 28), minutes: 25 },
  ];
  assert.deepEqual(Home.focusToday(log, at(4)), { tomatoes: 2, minutes: 62 });
  assert.deepEqual(Home.focusToday('broken', at(4)), { tomatoes: 0, minutes: 0 });
});

test('current task prefers the doing todo, then the most urgent one today', () => {
  const doing = { id: 'd', text: '录制第 3 节课', categoryId: 'P1', deadline: '2026-09-29T10:00:00.000Z' };
  assert.equal(Home.currentTask({ doing, today: [{ id: 'x', text: '别的', due: at(9), priority: 'P0' }] }).source, 'doing');
  const today = Home.currentTask({ today: [{ id: 'x', text: '回复客户', due: at(9), priority: 'P0' }] });
  assert.deepEqual({ id: today.id, text: today.text, categoryId: today.categoryId, source: today.source }, { id: 'x', text: '回复客户', categoryId: 'P0', source: 'today' });
  assert.equal(Home.currentTask({ today: [] }), null);
});

test('due line says when, with warm tone only for today and overdue', () => {
  const now = at(14, 20);
  assert.deepEqual(Home.dueLine(new Date(at(18)).toISOString(), now), { lead: '今天 18:00 截止', rest: '还剩 3 小时 40 分', tone: 'today' });
  assert.deepEqual(Home.dueLine(new Date(at(23, 30)).toISOString(), now), { lead: '今天截止', rest: '', tone: 'today' });
  assert.deepEqual(Home.dueLine(new Date(at(12, 20)).toISOString(), now), { lead: '已逾期 2 小时', rest: '', tone: 'overdue' });
  assert.deepEqual(Home.dueLine(new Date(at(9, 0, 30)).toISOString(), now), { lead: '明天 09:00 截止', rest: '', tone: '' });
  assert.deepEqual(Home.dueLine(new Date(at(23, 30, 3 + 30)).toISOString(), now).lead, '10月3日截止');
  assert.equal(Home.dueLine('', now), null);
});

test('short due labels fit the task picker', () => {
  const now = at(14, 20);
  assert.equal(Home.shortDue(at(18), now), '18:00');
  assert.equal(Home.shortDue(at(23, 30), now), '今天');
  assert.equal(Home.shortDue(at(9), now), '逾期');
  assert.equal(Home.shortDue(at(23, 30, 30), now), '明天');
  assert.equal(Home.shortDue(at(9, 0, 3 + 30), now), '10月3日');
  assert.equal(Home.shortDue(NaN, now), '');
});

test('upcoming lists what is left today in time order', () => {
  const now = at(14, 20);
  const events = [
    { id: 'e1', title: '课程录制', start: at(10), durationMin: 90 },
    { id: 'e2', title: '客户电话', start: at(16), durationMin: 30 },
    { id: 'e3', title: '周会', start: at(14), durationMin: 60 },
    { id: 'e4', title: '明天的事', start: at(9, 0, 30), durationMin: 30 },
  ];
  const todos = [
    { id: 't1', text: '交付封面终稿', due: at(21) },
    { id: 't2', text: '正在做的', due: at(15) },
    { id: 't3', text: '随手记的待办', due: at(23, 30) },
    { id: 't4', text: '已经逾期', due: at(9) },
  ];
  const items = Home.upcoming({ events, todos, now, excludeId: 't2', limit: 4 });
  assert.deepEqual(items.map((item) => [item.time, item.title, item.note]), [
    ['14:00', '周会', '进行中'],
    ['16:00', '客户电话', '日程 · 1 小时 40 分后'],
    ['21:00', '交付封面终稿', '截止'],
    ['今天', '随手记的待办', '截止'],
  ]);
  assert.equal(Home.upcoming({ events, todos, now, limit: 2 }).length, 2);
});

test('day track spans 9 to 21 by default and stretches for early starts and late nights', () => {
  const runs = [[at(9, 30), at(11), 'active'], [at(10), at(10, 30), 'focus']];
  const track = Home.dayTrack(runs, at(14, 20), '2026-09-29');
  assert.deepEqual([track.startHour, track.endHour, track.ticks], [9, 21, ['9', '12', '15', '18', '21']]);
  assert.equal(track.segments[0].kind, 'active');
  assert.equal(track.segments[0].left, 4.17);
  assert.ok(track.now > 44 && track.now < 45);
  const late = Home.dayTrack([[at(7, 10), at(8), 'active']], at(23, 40), '2026-09-29');
  assert.deepEqual([late.startHour, late.endHour], [7, 25]);
  assert.equal(late.ticks.at(-1), '1');
});

test('energy view states facts without comparing days', () => {
  const now = at(14, 20);
  const days = {
    '2026-09-29': { runs: [[at(9), at(12), 'active'], [at(13), at(14, 20), 'focus']] },
    '2026-09-25': { runs: [[at(8, 0, 25), at(19, 30, 25), 'active']] },
    '2026-09-27': { runs: [[at(10, 0, 27), at(10, 10, 27), 'active']] },
  };
  const view = Home.energyView({ now, todayKey: '2026-09-29', days, activeSince: now - 48 * 60000, focusMinutesToday: 75, breakMinutes: 50, offwork: { enabled: true, time: '22:30' } });
  assert.equal(view.total, 260);
  assert.deepEqual(view.parts, [{ value: '4', unit: '小时' }, { value: '20', unit: '分' }]);
  assert.deepEqual(view.sinceBreak, { text: '48 分钟', warn: true, fraction: 0.96 });
  assert.deepEqual(view.state, { text: '该歇一会儿了', tone: 'warn' });
  assert.equal(view.focusText, '1 小时 15 分');
  assert.deepEqual(view.offwork, { time: '22:30', text: '22:30 · 还有 8 小时 10 分', passed: false });
  assert.deepEqual(view.week.map((bar) => bar.label), ['三', '四', '五', '六', '日', '一', '今天']);
  assert.deepEqual(view.week.map((bar) => bar.kind), ['rest', 'rest', 'long', 'rest', 'rest', 'rest', 'today']);
  assert.equal(view.hasLongDay, true);
  assert.equal(JSON.stringify(view).includes('平均'), false);
  assert.equal(JSON.stringify(view).includes('比'), false);

  const focusing = Home.energyView({ now, todayKey: '2026-09-29', days, activeSince: now - 80 * 60000, focus: { running: true, mode: 'focus', elapsedMinutes: 10 } });
  assert.deepEqual(focusing.state, { text: '专注中', tone: 'focus' });
  assert.equal(focusing.sinceBreak.text, '这段专注 10 分钟');
  assert.equal(focusing.canRest, false);
  const rested = Home.energyView({ now, todayKey: '2026-09-29', days: {}, activeSince: null });
  assert.deepEqual([rested.state.text, rested.sinceBreak.text, rested.total], ['状态不错', '刚休息过', 0]);
  assert.equal(Home.energyView({ enabled: false }).enabled, false);
});

test('offwork after midnight belongs to the same evening', () => {
  assert.equal(Home.offworkInfo({ enabled: true, time: '01:00' }, at(23)).passed, false);
  assert.equal(Home.offworkInfo({ enabled: true, time: '18:00' }, at(19)).text, '18:00 · 已到，早点休息');
  assert.equal(Home.offworkInfo({ enabled: false, time: '18:00' }, at(19)), null);
});
