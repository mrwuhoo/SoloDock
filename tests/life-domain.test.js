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

test('habit reminders fire after work and at weekends, and skip what is already done', () => {
  const at = (text) => new Date(text).getTime();
  const now = at('2026-09-23T20:00:00'); // Wednesday
  let state = life.normalizeLife(null);
  assert.equal(state.remindWorkdays, false);
  state = life.updateHabit(state, 'exercise', { remindAt: '19:00' });
  state = life.updateHabit(state, 'read', { remindAt: '23:00' });
  state = life.updateHabit(state, 'meditate', { remindAt: '25:00' });
  assert.equal(state.habits.find((habit) => habit.id === 'meditate').remindAt, '', 'invalid times are dropped');
  const queue = life.habitReminderQueue(state, { now, offwork: '22:30', days: 5 });
  const ids = queue.map((item) => item.id);
  // 19:00 is before 收工 on weekdays: only Saturday and Sunday. 23:00 is after 收工: every day from tonight.
  assert.deepEqual(ids.filter((id) => id.startsWith('habit-exercise')), ['habit-exercise-2026-09-26', 'habit-exercise-2026-09-27']);
  assert.deepEqual(ids.filter((id) => id.startsWith('habit-read')), ['habit-read-2026-09-23', 'habit-read-2026-09-24', 'habit-read-2026-09-25', 'habit-read-2026-09-26', 'habit-read-2026-09-27']);
  assert.equal(queue[0].at, at('2026-09-23T23:00:00'));
  assert.deepEqual([queue[0].title, queue[0].detail, queue[0].kind, queue[0].habitId], ['今天阅读了吗？', '本周 0 / 4 次', 'habit', 'read']);
  // Opting in to workdays brings the 19:00 reminder back on weekdays (tonight's has already passed).
  const workdays = life.habitReminderQueue({ ...state, remindWorkdays: true }, { now, offwork: '22:30', days: 5 }).map((item) => item.id);
  assert.ok(workdays.includes('habit-exercise-2026-09-24'));
  assert.ok(!workdays.includes('habit-exercise-2026-09-23'));
  // Recorded today: no reminder tonight. Weekly goal reached: none for the rest of the week, back next week.
  state = life.addRecord(state, { id: 'r1', habitId: 'read', at: at('2026-09-23T12:00:00') });
  assert.ok(!life.habitReminderQueue(state, { now, days: 5 }).some((item) => item.id === 'habit-read-2026-09-23'));
  for (const [index, day] of ['21', '22', '24'].entries()) state = life.addRecord(state, { id: `w${index}`, habitId: 'read', at: at(`2026-09-${day}T12:00:00`) });
  const reached = life.habitReminderQueue(state, { now, days: 7 }).filter((item) => item.habitId === 'read').map((item) => item.id);
  assert.deepEqual(reached, ['habit-read-2026-09-28', 'habit-read-2026-09-29']);
  // After midnight still counts as the same day: 00:30 is "after 22:30" and belongs to the day that started at 04:00.
  state = life.updateHabit(state, 'meditate', { remindAt: '00:30' });
  const late = life.habitReminderQueue(state, { now, days: 1 }).find((item) => item.habitId === 'meditate');
  assert.equal(late.at, at('2026-09-24T00:30:00'));
  assert.equal(late.id, 'habit-meditate-2026-09-23');
  // Updates keep the workdays opt-in.
  assert.equal(life.addRecord({ ...state, remindWorkdays: true }, { id: 'x', habitId: 'read', at: now }).remindWorkdays, true);
});

test('life records export as CSV that opens cleanly in Excel', () => {
  let state = life.normalizeLife(null);
  state = life.addRecord(state, { id: 'r2', habitId: 'exercise', at: new Date('2026-09-24T07:05:00').getTime(), item: '跑步', minutes: 32, note: '5km, 配速 "6:24"' });
  state = life.addRecord(state, { id: 'r1', habitId: 'read', at: new Date('2026-09-23T22:10:00').getTime(), note: '=HYPERLINK("x")' });
  const csv = life.recordsCsv(state);
  assert.ok(csv.startsWith('\ufeff'), 'BOM for Excel');
  assert.deepEqual(csv.slice(1).trimEnd().split('\r\n'), [
    '日期,时间,习惯,项目,时长（分钟）,备注',
    '2026-09-23,22:10,阅读,,,"\'=HYPERLINK(""x"")"',
    '2026-09-24,07:05,运动,跑步,32,"5km, 配速 ""6:24"""',
  ]);
});
