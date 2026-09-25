const test = require('node:test');
const assert = require('node:assert/strict');
const todo = require('../renderer/todo-domain');

// 2026-09-25 is a Friday.
const at = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const now = at(2026, 9, 25, 15, 0);
const iso = (...args) => new Date(at(...args)).toISOString();

test('first upgrade: the four P0–P3 categories keep their names, order and colours', () => {
  const migrated = todo.normalizeCategories(null, { P0: '学习', P2: '  编程  ' });
  assert.deepEqual(migrated, [
    { id: 'P0', name: '学习', color: 'cat-1' },
    { id: 'P1', name: '自媒体&写作', color: 'cat-2' },
    { id: 'P2', name: '编程', color: 'cat-3' },
    { id: 'P3', name: '日常', color: 'cat-4' },
  ]);
  const stored = todo.normalizeCategories([{ id: 'P3', name: '日常', color: 'cat-4' }, { id: 'c-1', name: '家', color: 'cat-9' }, { id: 'P3', name: 'dup' }, { id: 'bad id', name: 'x' }]);
  assert.deepEqual(stored, [{ id: 'P3', name: '日常', color: 'cat-4' }, { id: 'c-1', name: '家', color: 'cat-2' }]);
  assert.equal(todo.normalizeCategories(Array.from({ length: 9 }, (_, index) => ({ id: `c${index}`, name: `${index}` }))).length, 6);
  assert.equal(todo.nextColor(migrated), 'cat-5');
  assert.deepEqual([4, 5, 6, 3, 1].map((count) => todo.gridShape(count)), [{ columns: 2, rows: 2 }, { columns: 3, rows: 2 }, { columns: 3, rows: 2 }, { columns: 3, rows: 1 }, { columns: 1, rows: 1 }]);
});

test('data stays keyed by category; todos of a removed category move to the first, never lost', () => {
  const categories = [{ id: 'P1', name: 'a', color: 'cat-2' }, { id: 'c-2', name: 'b', color: 'cat-5' }];
  const data = todo.normalizeData({
    P0: [{ id: 'x', text: '孤儿', createdAt: 1, deadline: iso(2026, 9, 26, 10) }],
    P1: [{ id: 'y', text: '  写稿 ', createdAt: 2, deadline: 'bad', done: true, completedAt: 9, repeat: { kind: 'weekly' }, remindMin: 15 }, 'legacy string', null],
  }, categories);
  assert.deepEqual(Object.keys(data), ['P1', 'c-2']);
  assert.deepEqual(data.P1.map((item) => item.text), ['写稿', 'legacy string', '孤儿']);
  assert.deepEqual([data.P1[0].deadline, data.P1[0].completedAt, data.P1[0].repeat, data.P1[0].remindMin], ['', 9, { kind: 'weekly' }, 15]);
  assert.equal(todo.remindLead(data.P1[1]), 60, 'old todos keep the one-hour reminder');
  assert.equal(todo.remindLead({ remindMin: -1 }), -1);
  assert.equal(todo.normalizeItem({ text: 'a', remindMin: 7 }, 'id').remindMin, undefined);
});

test('time labels: overdue in red, today with time left (amber within an hour), tomorrow, then date and weekday', () => {
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 25, 13, 0), now), { text: '逾期 2 小时', tone: 'overdue' });
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 25, 14, 50), now), { text: '逾期 10 分钟', tone: 'overdue' });
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 22, 9, 0), now), { text: '逾期 3 天', tone: 'overdue' });
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 25, 20, 0), now), { text: '今天 20:00 · 还剩 5 小时', tone: '' });
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 25, 15, 40), now), { text: '今天 15:40 · 还剩 40 分钟', tone: 'soon' });
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 26, 23, 30), now), { text: '明天 23:30', tone: '' });
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 26, 0, 20), at(2026, 9, 25, 23, 50)), { text: '明天 00:20 · 还剩 30 分钟', tone: 'soon' });
  assert.deepEqual(todo.dueLabel(iso(2026, 9, 28, 9, 0), now), { text: '9/28 周一', tone: '' });
  assert.deepEqual(todo.dueLabel(iso(2027, 1, 5, 9, 0), now), { text: '2027/1/5', tone: '' });
  assert.equal(todo.fullDate(iso(2026, 9, 26, 23, 30)), '2026年9月26日 周六 23:30');
  assert.equal(todo.describe({ deadline: iso(2026, 9, 26, 23, 30), repeat: { kind: 'weekly' }, remindMin: 15 }), '2026年9月26日 周六 23:30 · 每周六 · 提前 15 分钟');
  assert.equal(todo.shortDate(at(2026, 9, 25, 23, 30), now), '今天 23:30');
  assert.equal(todo.shortDate(at(2026, 9, 29, 9, 0), now), '9/29 周二 09:00');
});

test('repeating todos: the next time keeps the clock; month ends, leap years and missed runs are right', () => {
  assert.equal(todo.nextOccurrence(iso(2026, 9, 25, 21), { kind: 'daily' }, now), iso(2026, 9, 26, 21));
  assert.equal(todo.nextOccurrence(iso(2026, 12, 31, 9), { kind: 'daily' }, at(2026, 12, 31, 8)), iso(2027, 1, 1, 9), 'across the year');
  assert.equal(todo.nextOccurrence(iso(2026, 9, 25, 18), { kind: 'weekdays' }, now), iso(2026, 9, 28, 18), 'Friday → Monday');
  assert.equal(todo.nextOccurrence(iso(2026, 9, 26, 10), { kind: 'weekly' }, now), iso(2026, 10, 3, 10));
  assert.equal(todo.nextOccurrence(iso(2026, 1, 31, 23, 30), { kind: 'monthly', day: 31 }, at(2026, 1, 31, 12)), iso(2026, 2, 28, 23, 30));
  assert.equal(todo.nextOccurrence(iso(2026, 2, 28, 23, 30), { kind: 'monthly', day: 31 }, at(2026, 2, 28, 12)), iso(2026, 3, 31, 23, 30), 'back to the 31st');
  assert.equal(todo.nextOccurrence(iso(2028, 1, 31, 9), { kind: 'monthly', day: 31 }, at(2028, 1, 31, 8)), iso(2028, 2, 29, 9), 'leap year');
  assert.equal(todo.nextOccurrence(iso(2026, 12, 15, 9), { kind: 'monthly' }, at(2026, 12, 14)), iso(2027, 1, 15, 9));
  assert.equal(todo.nextOccurrence(iso(2026, 9, 1, 9), { kind: 'custom', every: 2, unit: 'week' }, at(2026, 9, 1, 8)), iso(2026, 9, 15, 9));
  assert.equal(todo.nextOccurrence(iso(2026, 9, 20, 21), { kind: 'daily' }, now), iso(2026, 9, 25, 21), 'missed days are skipped');
  assert.equal(todo.nextOccurrence(iso(2026, 9, 25, 21), null, now), '');
  assert.equal(todo.repeatLabel({ kind: 'monthly', day: 31 }, iso(2026, 1, 31)), '每月 31 日');
  assert.equal(todo.repeatLabel({ kind: 'custom', every: 3, unit: 'day' }), '每 3 天');
  assert.deepEqual([-1, 0, 15, 60, 1440].map(todo.remindLabel), ['不提醒', '准时提醒', '提前 15 分钟', '提前 1 小时', '提前 1 天']);
});

test('filters and counts: all pending, due today, overdue, done; search needs every word', () => {
  const data = {
    P0: [
      { id: 'a', text: '周报复盘', done: false, deadline: iso(2026, 9, 25, 13) },
      { id: 'b', text: '小红书封面 3 张', done: false, deadline: iso(2026, 9, 25, 18) },
      { id: 'c', text: '旧的', done: true, deadline: iso(2026, 9, 24, 18) },
    ],
    P1: [{ id: 'd', text: '预约牙医', done: false, deadline: iso(2026, 9, 30, 23, 30) }],
  };
  assert.deepEqual(todo.counts(data, now), { all: 3, today: 2, overdue: 1, done: 1 });
  assert.equal(todo.matchesSearch(data.P0[1], '封面 小红书'), true);
  assert.equal(todo.matchesSearch(data.P0[1], '封面 牙医'), false);
  assert.deepEqual(todo.sortPending([data.P1[0], data.P0[1], data.P0[0]]).map((item) => item.id), ['a', 'b', 'd']);
});

test('the add row reads dates from the text; otherwise today 23:30 (tomorrow once that has passed)', () => {
  assert.deepEqual(todo.parseAddInput('明天下午3点 给会计打电话', now), { text: '给会计打电话', at: at(2026, 9, 26, 15), label: '明天 15:00' });
  assert.deepEqual(todo.parseAddInput('周五前 交稿', at(2026, 9, 23, 10)), { text: '交稿', at: at(2026, 9, 25, 23, 30), label: '后天 23:30' });
  assert.deepEqual(todo.parseAddInput('整理发票', now), { text: '整理发票', at: null });
  assert.deepEqual(todo.parseAddInput('明天', now), { text: '明天', at: null }, 'a date alone is not a todo text');
  assert.equal(todo.defaultDeadline(now), at(2026, 9, 25, 23, 30));
  assert.equal(todo.defaultDeadline(at(2026, 9, 25, 23, 40)), at(2026, 9, 26, 23, 30));
  assert.deepEqual(todo.quickDates(at(2026, 9, 24, 10)).map((item) => item.label), ['今天', '明天', '周末', '下周一'], 'Thursday');
  assert.deepEqual(todo.quickDates(at(2026, 9, 22, 10)).map((item) => [item.label, item.date.getDate()]), [['今天', 22], ['明天', 23], ['周五', 25], ['下周一', 28]]);
  assert.deepEqual(todo.quickDates(now).map((item) => item.label), ['今天', '明天', '下周一'], 'Friday');
  const grid = todo.monthGrid(2026, 8);
  assert.equal(grid.length % 7, 0);
  assert.deepEqual([grid[0].date.getDate(), grid[0].outside, grid[1].date.getDate(), grid.at(-1).date.getDate()], [31, true, 1, 4], 'Sept 2026 starts on Tuesday');
});

test('extracting todos from a transcript lists only sentences with a time or an action, unchanged', () => {
  const transcript = '王总：合同第 4 条的交付时间，我们这边希望改到 11 月 20 日。我：可以。王总：报价单麻烦今天发一版给财务，按基础版走。我：好的，下午 5 点前发过去。天气不错';
  const candidates = todo.extractTodoCandidates(transcript, now);
  assert.deepEqual(candidates.map((item) => item.text), [
    '合同第 4 条的交付时间，我们这边希望改到 11 月 20 日',
    '报价单麻烦今天发一版给财务，按基础版走',
    '好的，下午 5 点前发过去',
  ]);
  assert.equal(candidates[0].at, at(2026, 11, 20, 23, 30));
  assert.equal(candidates[2].at, at(2026, 9, 25, 17));
  assert.equal(candidates[1].at, null, '"今天" alone is not a deadline');
  assert.deepEqual(todo.extractTodoCandidates('', now), []);
});
