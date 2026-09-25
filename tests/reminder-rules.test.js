const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../reminder-rules');

const MIN = 60_000;
const at = (hour, minute = 0, day = 25) => new Date(2026, 8, day, hour, minute).getTime();

// Feed the tracker one sample per minute; `idle` maps a minute offset to idle milliseconds.
function run(tracker, start, minutes, idle = () => 0) {
  const fired = [];
  for (let minute = 0; minute <= minutes; minute += 1) {
    const now = start + minute * MIN;
    for (const kind of tracker.sample(idle(minute), now)) fired.push([minute, kind]);
  }
  return fired;
}

test('each reminder type gets its own buttons, and the ones that need you stay until handled', () => {
  const ids = (source) => rules.reminderPresentation(source).actions.map((item) => item.id);
  assert.deepEqual(ids('pomodoro'), ['break-5', 'focus-5', 'dismiss']);
  assert.deepEqual(ids('todo'), ['todo-done', 'snooze-30', 'open-todo']);
  assert.deepEqual(ids('sit'), ['break-5', 'body-snooze-10', 'body-mute-today']);
  assert.deepEqual(ids('offwork'), ['move-tomorrow', 'body-snooze-30']);
  assert.deepEqual(ids('codex'), ['open', 'snooze-10']);
  assert.deepEqual(ids('needs-you'), ['open', 'snooze-10']);
  assert.equal(rules.reminderPresentation('needs-you').visibleMs, 0, 'a permission request waits for you');
  assert.equal(rules.isAiSource('needs-you'), false, 'not a completion');
  assert.equal(rules.reminderPresentation('todo').visibleMs, 0);
  assert.equal(rules.reminderPresentation('event').visibleMs, 0);
  assert.equal(rules.reminderPresentation('codex').visibleMs, 8000);
  const eye = rules.reminderPresentation('eye');
  assert.deepEqual([eye.style, eye.actions.length, eye.visibleMs], ['quiet', 0, 20000]);
  for (const source of ['pomodoro', 'todo', 'sit', 'offwork', 'codex']) {
    assert.equal(rules.reminderPresentation(source).actions.filter((item) => item.primary).length, 1, source);
  }
  assert.equal(rules.isAiSource('claude'), true);
  assert.equal(rules.isAiSource('pomodoro'), false);
});

test('body settings default to sit on (50 min), eye off, off-work at 22:30', () => {
  assert.deepEqual(rules.normalizeBodySettings({}), {
    sit: { enabled: true, minutes: 50 },
    eye: { enabled: false, minutes: 20 },
    offwork: { enabled: true, time: '22:30' },
    worklog: { enabled: true },
  });
  assert.deepEqual(rules.normalizeBodySettings({ sit: { minutes: 45 }, eye: { enabled: true, minutes: 7 }, offwork: { time: '25:00' }, worklog: { enabled: false } }), {
    sit: { enabled: true, minutes: 45 },
    eye: { enabled: true, minutes: 20 },
    offwork: { enabled: true, time: '22:30' },
    worklog: { enabled: false },
  });
});

test('sitting: 50 minutes of continuous use, reset by a 5-minute break, then again 50 minutes later', () => {
  const start = at(9);
  const tracker = rules.createActivityTracker({ offwork: { enabled: false } }, start);
  assert.deepEqual(run(tracker, start, 120), [[50, 'sit'], [100, 'sit']]);

  const other = rules.createActivityTracker({ offwork: { enabled: false } }, start);
  // Away from the computer for 6 minutes around minute 30: the count starts over.
  const fired = run(other, start, 100, (minute) => (minute >= 30 && minute < 36 ? (minute - 29) * MIN : 0));
  assert.deepEqual(fired, [[86, 'sit']], 'back at minute 36, so 50 minutes later');
});

test('sitting reminders can be snoozed, muted for today, and wait for a focus session to end', () => {
  const start = at(9);
  const tracker = rules.createActivityTracker({ offwork: { enabled: false } }, start);
  run(tracker, start, 50);
  tracker.snooze('sit', 10, start + 50 * MIN);
  assert.deepEqual(run(tracker, start + 51 * MIN, 15), [[9, 'sit']], 'fires again once the snooze ends');

  tracker.muteToday('sit', start + 60 * MIN);
  assert.deepEqual(run(tracker, start + 61 * MIN, 200), [], 'muted for the rest of the day');

  const focus = rules.createActivityTracker({ offwork: { enabled: false } }, start);
  focus.setFocusUntil(start + 70 * MIN);
  assert.deepEqual(run(focus, start, 75), [[70, 'sit']], 'held during focus, delivered right after');

  const rested = rules.createActivityTracker({ offwork: { enabled: false } }, start);
  run(rested, start, 50);
  rested.startBreak(start + 50 * MIN);
  assert.deepEqual(run(rested, start + 51 * MIN, 60), [[49, 'sit']], '"休息 5 分钟" restarts the count');
});

test('eye reminders every 20 minutes of use when turned on, never together with a sitting reminder', () => {
  const start = at(9);
  const tracker = rules.createActivityTracker({ eye: { enabled: true }, offwork: { enabled: false } }, start);
  assert.deepEqual(run(tracker, start, 61), [[20, 'eye'], [40, 'eye'], [50, 'sit']]);
});

test('off-work fires once at the set time while you are at the computer, and can be pushed back 30 minutes', () => {
  const start = at(21);
  const tracker = rules.createActivityTracker({ sit: { enabled: false } }, start);
  // Away (idle 3 minutes, not a break yet) at 22:30, back at 22:33.
  const fired = run(tracker, start, 100, (minute) => (minute >= 89 && minute <= 92 ? 3 * MIN : 0));
  assert.deepEqual(fired, [[93, 'offwork']]);
  tracker.snooze('offwork', 30, start + 93 * MIN);
  assert.deepEqual(run(tracker, start + 94 * MIN, 40), [[29, 'offwork']]);
  assert.deepEqual(run(tracker, start + 124 * MIN, 120), [], 'then not again tonight');

  // Starting the app after the off-work time does not nag right away.
  const late = rules.createActivityTracker({ sit: { enabled: false } }, at(23));
  assert.deepEqual(run(late, at(23), 60), []);
  late.setSettings({ sit: { enabled: false }, offwork: { time: '23:30' } }, at(23, 5));
  assert.deepEqual(run(late, at(23, 6), 30), [[24, 'offwork']], 'changing the time takes effect the same day');
});

test('AI completions during a focus session are held, then delivered as one or summarised', () => {
  const hold = rules.createFocusHold();
  const now = at(10);
  const ai = (id, title) => ({ eventId: id, source: 'codex', title });
  assert.equal(hold.hold(ai('a', 'x'), now), false, 'nothing is held outside focus');
  hold.setFocus({ running: true, mode: 'focus', endsAt: now + 25 * MIN });
  assert.equal(hold.hold({ eventId: 't', source: 'todo', title: 'due' }, now), false, 'todos still show up');
  assert.equal(hold.hold(ai('b', '重构用量卡片'), now), true);
  assert.deepEqual(hold.flush(now), [], 'nothing comes out while focusing');
  hold.setFocus({ running: false, mode: 'focus', endsAt: 0 });
  assert.deepEqual(hold.flush(now).map((item) => [item.eventId, item.title]), [['b-after-focus', '重构用量卡片']]);

  hold.setFocus({ running: true, mode: 'focus', endsAt: now + 25 * MIN });
  ['补测试', '改文档', '修样式', '发版本'].forEach((title, index) => hold.hold(ai(`c${index}`, title), now));
  // The session simply runs out without the renderer reporting it.
  const [summary] = hold.flush(now + 26 * MIN);
  assert.equal(summary.source, 'focus-summary');
  assert.equal(summary.title, '专注期间完成了 4 个 AI 任务');
  assert.equal(summary.detail, '补测试、改文档、修样式 等');
  assert.equal(hold.size(), 0);

  hold.setFocus({ running: true, mode: 'break', endsAt: now + 5 * MIN });
  assert.equal(hold.hold(ai('d', 'y'), now), false, 'a break is not focus');
});
