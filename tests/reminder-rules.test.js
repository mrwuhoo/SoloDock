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
    cat: { enabled: true },
  });
  assert.deepEqual(rules.normalizeBodySettings({ sit: { minutes: 45 }, eye: { enabled: true, minutes: 7 }, offwork: { time: '25:00' }, worklog: { enabled: false }, cat: { enabled: false } }), {
    sit: { enabled: true, minutes: 45 },
    eye: { enabled: true, minutes: 20 },
    offwork: { enabled: true, time: '22:30' },
    worklog: { enabled: false },
    cat: { enabled: false },
  });
});

test('break companion: the cat comes with a running break and leaves when it ends', () => {
  const cat = rules.createBreakCompanion();
  const now = at(10);
  const breakState = (endsAt, running = true) => ({ running, mode: 'break', endsAt });
  assert.equal(cat.update({ running: true, mode: 'focus', endsAt: now + 1500_000 }, true, now), null, 'focus never brings the cat');
  assert.deepEqual(cat.update(breakState(now + 300_000), true, now), { type: 'show', endsAt: now + 300_000 });
  assert.equal(cat.update(breakState(now + 300_000), true, now + 1000), null, 'same break, nothing new');
  assert.deepEqual(cat.update(breakState(now + 600_000), true, now + 2000), { type: 'update', endsAt: now + 600_000 }, '+5 分钟 moves the countdown');
  assert.equal(cat.endsAt(), now + 600_000);
  assert.deepEqual(cat.update(breakState(now + 600_000, false), true, now + 3000), { type: 'hide' }, 'pausing the break sends it away');
  assert.equal(cat.visible(), false);
  assert.deepEqual(cat.update(breakState(now + 600_000), true, now + 4000).type, 'show', 'resuming brings it back');
  assert.deepEqual(cat.update(breakState(now + 600_000), true, now + 600_000), { type: 'hide' }, 'time is up even if the renderer is late');
  assert.equal(cat.update({ running: false, mode: 'focus', endsAt: 0 }, true, now + 601_000), null);
});

test('break companion: 让它走 lasts for this break only, and the setting turns it off', () => {
  const cat = rules.createBreakCompanion();
  const now = at(10);
  const resting = { running: true, mode: 'break', endsAt: now + 300_000 };
  assert.equal(cat.dismiss(), null, 'nothing to dismiss yet');
  assert.equal(cat.update(resting, true, now).type, 'show');
  assert.deepEqual(cat.dismiss(), { type: 'hide' });
  assert.equal(cat.update(resting, true, now + 1000), null, 'stays away for the rest of this break');
  assert.equal(cat.update({ running: false, mode: 'focus', endsAt: 0 }, true, now + 2000), null);
  assert.equal(cat.update({ ...resting, endsAt: now + 900_000 }, true, now + 3000).type, 'show', 'the next break brings it back');
  assert.deepEqual(cat.update({ ...resting, endsAt: now + 900_000 }, false, now + 4000), { type: 'hide' }, 'switching it off sends it away');
  assert.equal(cat.update({ ...resting, endsAt: now + 900_000 }, false, now + 5000), null);
});

test('with the cat on, a finished focus and a sitting reminder start the break themselves: the card only offers not resting', () => {
  const ids = (source) => rules.autoBreakPresentation(source).actions.map((item) => item.id);
  assert.deepEqual(ids('pomodoro'), ['focus-5', 'dismiss']);
  assert.deepEqual(ids('sit'), ['body-snooze-10', 'body-mute-today']);
  assert.equal(rules.autoBreakPresentation('pomodoro').actions.find((item) => item.primary).id, 'dismiss');
  for (const source of ['pomodoro-break', 'eye', 'offwork', 'todo', 'codex', 'needs-you']) {
    assert.equal(rules.autoBreakPresentation(source), null, `${source} never starts a break`);
  }
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

test('pausing reminders keeps them out of sight, counts them, and sums them up on resume', () => {
  const { createReminderPause, pauseUntil, pauseResumeLabel, PAUSE_CHOICES } = require('../reminder-rules');
  const at = (text) => new Date(text).getTime();
  const now = at('2026-09-25T14:30:00');
  assert.deepEqual(PAUSE_CHOICES.map((choice) => choice.id), ['30m', '1h', '2h', 'today']);
  assert.equal(pauseUntil('1h', now), at('2026-09-25T15:30:00'));
  assert.equal(pauseUntil('today', now), at('2026-09-26T04:00:00'));
  assert.equal(pauseUntil('today', at('2026-09-26T01:30:00')), at('2026-09-26T04:00:00'), 'after midnight "today" still ends at 04:00');
  assert.equal(pauseUntil('forever', now), 0);
  assert.equal(pauseResumeLabel(at('2026-09-25T15:30:00'), now), '15:30 恢复');
  assert.equal(pauseResumeLabel(at('2026-09-26T04:00:00'), now), '明天 04:00 恢复');

  const pause = createReminderPause(0, now);
  assert.equal(pause.paused(now), false);
  assert.equal(pause.hold({ source: 'todo' }, now), false, 'not paused: pop up as usual');
  pause.start(pauseUntil('30m', now), now);
  assert.equal(pause.paused(now + 60_000), true);
  assert.equal(pause.hold({ source: 'todo' }, now + 60_000), true);
  assert.equal(pause.hold({ source: 'sit' }, now + 120_000), true);
  pause.start(pauseUntil('2h', now), now + 180_000);
  assert.equal(pause.missed(), 2, 'extending a pause keeps the count');
  const summary = pause.resume(now + 200_000);
  assert.equal(summary.title, '暂停期间有 2 条提醒');
  assert.equal(summary.record, false, 'the summary itself is not another notice');
  assert.equal(pause.paused(now + 200_000), false);
  assert.equal(pause.resume(now + 300_000), null, 'nothing missed, nothing to say');
  assert.equal(createReminderPause(now - 1, now).paused(now), false, 'an expired stored pause is ignored');
  assert.equal(createReminderPause(now + 60_000, now).until(), now + 60_000, 'a stored pause survives a restart');
});

test('AI quota reminders fire once per window per cycle, below 20%', () => {
  const { createQuotaWatch, quotaWindows, quotaResetLabel } = require('../reminder-rules');
  const at = (text) => new Date(text).getTime();
  const now = at('2026-09-24T14:00:00'); // Thursday
  const claude = quotaWindows('claude', { fiveHour: { usedPercent: 85, resetsAt: at('2026-09-24T16:40:00') }, sevenDay: { usedPercent: 40, resetsAt: at('2026-09-26T09:00:00') } });
  assert.deepEqual(claude.map((window) => [window.key, window.label, window.remaining]), [['sevenDay', '本周', 60], ['fiveHour', '5 小时', 15]]);
  const codex = quotaWindows('codex', { buckets: [{ id: 'codex', name: 'codex', windows: [
    { key: 'primary', remainingPercent: 70, durationMinutes: 300, resetsAt: at('2026-09-24T18:00:00') },
    { key: 'secondary', remainingPercent: 18, durationMinutes: 10080, resetsAt: at('2026-09-26T09:00:00') },
  ] }] });
  assert.deepEqual(codex.map((window) => window.label), ['本周', '5 小时'], 'weekly first');
  assert.equal(quotaResetLabel(at('2026-09-24T16:40:00'), now), '今天 16:40');
  assert.equal(quotaResetLabel(at('2026-09-25T09:00:00'), now), '明天 09:00');
  assert.equal(quotaResetLabel(at('2026-09-26T09:00:00'), now), '周六 09:00');

  const watch = createQuotaWatch();
  const first = watch.check('codex', codex, { now, resetCredits: 1 });
  assert.deepEqual([first.title, first.detail, first.source, first.taskId], ['Codex 本周额度剩余 18%', '周六 09:00 重置 · 还有 1 张重置卡', 'quota', 'codex']);
  assert.equal(watch.check('codex', codex, { now: now + 60_000 }), null, 'same cycle: only once');
  assert.equal(watch.check('claude', claude, { now }).title, 'Claude 5 小时额度剩余 15%');
  // A new cycle (new reset time) can remind again; 本周期不再提醒 silences the provider until then.
  const nextCycle = quotaWindows('claude', { fiveHour: { usedPercent: 90, resetsAt: at('2026-09-24T21:40:00') } });
  watch.mute('claude', at('2026-09-24T16:40:00'));
  assert.equal(watch.check('claude', nextCycle, { now: now + 60_000 }), null);
  assert.equal(watch.check('claude', nextCycle, { now: at('2026-09-24T17:00:00') }).title, 'Claude 5 小时额度剩余 10%');
  // Plenty left, expired windows and unknown numbers never remind.
  assert.equal(createQuotaWatch().check('claude', quotaWindows('claude', { fiveHour: { usedPercent: 50, resetsAt: now + 1 } }), { now }), null);
  assert.equal(createQuotaWatch().check('claude', quotaWindows('claude', { fiveHour: { usedPercent: 99, resetsAt: now - 1 } }), { now }), null);
  assert.deepEqual(quotaWindows('claude', null), []);
});
