const test = require('node:test');
const assert = require('node:assert/strict');
const life = require('../renderer/life-domain');

// Thursday 2026-09-24, 21:00.
const now = new Date(2026, 8, 24, 21).getTime();
const at = (month, day, hour = 20) => new Date(2026, month - 1, day, hour).getTime();
let seq = 0;
const record = (habitId, time, extra = {}) => ({ id: `r${seq += 1}`, habitId, at: time, ...extra });

test('three default habits; custom habits up to six; bad data is dropped', () => {
  const state = life.normalizeLife({});
  assert.deepEqual(state.habits.map((habit) => [habit.name, habit.color, habit.goal]), [['运动', 'cat-3', 3], ['冥想', 'cat-5', 5], ['阅读', 'cat-6', 4]]);
  let custom = state;
  for (const name of ['早睡', '喝水', '写日记', '多出来的']) custom = life.addHabit(custom, name);
  assert.equal(custom.habits.length, 6);
  assert.deepEqual(custom.habits.slice(3).map((habit) => habit.color), ['cat-4', 'cat-1', 'cat-2'], 'each new habit gets an unused colour');
  const messy = life.normalizeLife({ habits: state.habits, records: [record('exercise', at(9, 22)), record('nope', at(9, 22)), { id: 'x', habitId: 'read', at: 'soon' }] });
  assert.equal(messy.records.length, 1);
});

test('this week, goal reached, and weeks in a row; the day starts at 04:00', () => {
  let state = life.normalizeLife({});
  // This week (Mon 21 – Sun 27): three runs, one at 01:30 on Wednesday night that counts as Tuesday.
  state = life.addRecord(state, record('exercise', at(9, 21, 19)));
  state = life.addRecord(state, record('exercise', at(9, 23, 1)));
  state = life.addRecord(state, record('exercise', at(9, 24, 7)));
  // The two previous weeks also reached 3.
  for (const day of [8, 10, 12, 15, 16, 18]) state = life.addRecord(state, record('exercise', at(9, day)));
  const week = life.habitWeek(state, 'exercise', now);
  assert.deepEqual([week.count, week.goal, week.reached], [3, 3, true]);
  assert.deepEqual(week.doneDays.sort(), ['2026-09-21', '2026-09-22', '2026-09-24']);
  assert.equal(life.streakWeeks(state, 'exercise', now), 3);
  // A week that hasn't reached its goal yet doesn't break the streak.
  assert.equal(life.streakWeeks(state, 'exercise', new Date(2026, 8, 28, 9).getTime()), 3);
  assert.equal(life.streakWeeks(state, 'read', now), 0);
  assert.deepEqual(life.weekDays(now), ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27']);
});

test('month dots show which habits happened each day, in habit order', () => {
  let state = life.normalizeLife({});
  state = life.addRecord(state, record('read', at(9, 5)));
  state = life.addRecord(state, record('exercise', at(9, 5, 7)));
  state = life.addRecord(state, record('exercise', at(9, 5, 19)));
  state = life.addRecord(state, record('meditate', at(8, 31)));
  assert.deepEqual(life.monthDots(state, 2026, 9), { '2026-09-05': ['exercise', 'read'] });
  const removed = life.removeRecord(state, state.records[0].id);
  assert.equal(removed.records.length, 3);
  const edited = life.updateRecord(state, state.records[0].id, { minutes: 32, note: '5km' });
  assert.deepEqual([edited.records[0].minutes, edited.records[0].note], [32, '5km']);
});

test('quick input: "跑步 5km 32分钟" becomes a run with a note', () => {
  const state = life.normalizeLife({});
  assert.deepEqual(life.parseLifeInput('跑步 5km 32分钟', state), { habitId: 'exercise', item: '跑步', minutes: 32, note: '5km' });
  assert.deepEqual(life.parseLifeInput('冥想 10min', state), { habitId: 'meditate', item: '', minutes: 10, note: '' });
  assert.deepEqual(life.parseLifeInput('读纸书 1小时 三体', state), { habitId: 'read', item: '纸书', minutes: 60, note: '读 三体' });
  assert.equal(life.parseLifeInput('开会 30分钟', state), null);
});
