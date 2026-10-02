const test = require('node:test');
const assert = require('node:assert/strict');
const { pickNotchStatus, duration } = require('../renderer/notch-status-domain');

const now = new Date(2026, 8, 25, 14, 26).getTime();
const at = (hour, minute = 0) => new Date(2026, 8, 25, hour, minute).getTime();

test('idle: nothing to say, the notch stays a notch', () => {
  assert.equal(pickNotchStatus({}, now), null);
  assert.equal(pickNotchStatus({ offwork: { enabled: true, time: '22:30' } }, now), null, 'before off-work time');
});

test('one status at a time, by priority', () => {
  const everything = {
    needsYou: { title: 'Claude 需要你确认' },
    recording: { status: 'recording', durationMs: 192_000 },
    pomodoro: { started: true, running: true, mode: 'focus', remaining: 1112, session: 1500 },
    quota: [{ name: 'Codex', remaining: 12 }],
    events: [{ title: '客户电话', start: at(15), durationMin: 30 }],
    later: [{ note: '看导出进度', at: at(14, 40) }],
  };
  const order = [];
  const input = { ...everything };
  for (const key of ['needsYou', 'recording', 'pomodoro', 'quota', 'events', 'later']) {
    order.push(pickNotchStatus(input, now).kind);
    delete input[key];
  }
  assert.deepEqual(order, ['needs-you', 'recording', 'focus', 'quota', 'event', 'later']);
});

test('the focus band stays on the lip when a more urgent status takes the text', () => {
  const pomodoro = { started: true, running: true, mode: 'focus', remaining: 1112, session: 1500 };
  const needs = pickNotchStatus({ needsYou: { title: 'Claude 需要你确认' }, pomodoro }, now);
  assert.deepEqual([needs.kind, Math.round(needs.progress * 100), needs.bandTone], ['needs-you', 26, 'focus']);
  const recording = pickNotchStatus({ recording: { status: 'recording', durationMs: 1000 }, pomodoro: { ...pomodoro, mode: 'break', remaining: 150, session: 300 } }, now);
  assert.deepEqual([recording.kind, recording.progress, recording.bandTone], ['recording', 0.5, 'calm']);
  assert.equal(pickNotchStatus({ needsYou: { title: 'Claude 需要你确认' } }, now).progress, null, 'no band without a focus session');
});

test('each status reads well in 200 points', () => {
  assert.deepEqual(pickNotchStatus({ recording: { status: 'recording', durationMs: 192_000 } }, now), {
    kind: 'recording', icon: 'dot', text: '录音中', detail: '03:12', tone: 'recording', progress: null, target: 'recordings',
  });
  const focus = pickNotchStatus({ pomodoro: { started: true, running: true, mode: 'focus', remaining: 1112, session: 1500 } }, now);
  assert.deepEqual([focus.text, focus.detail, Math.round(focus.progress * 100), focus.bandTone], ['专注中', '14:44 结束', 26, 'focus'], 'running focus says when it ends, not a ticking countdown');
  const paused = pickNotchStatus({ pomodoro: { started: true, running: false, mode: 'break', remaining: 190, session: 300 } }, now);
  assert.deepEqual([paused.kind, paused.text, paused.detail, paused.icon], ['break', '休息已暂停', '03:10', 'leaf']);
  const quota = pickNotchStatus({ quota: [{ name: 'Claude', remaining: 18.4 }, { name: 'Codex', remaining: 9 }, { name: 'Grok', remaining: 80 }] }, now);
  assert.deepEqual([quota.text, quota.detail], ['Codex 额度不足', '9%'], 'the tightest one');
  assert.equal(pickNotchStatus({ quota: [{ name: 'Codex', remaining: 20 }] }, now), null, '20% is not low yet');
});

test('events within an hour, ongoing events, and later reminders', () => {
  const soon = pickNotchStatus({ events: [{ title: '客户电话', start: at(15), durationMin: 30 }] }, now);
  assert.deepEqual([soon.text, soon.detail], ['15:00 客户电话', '34 分钟后']);
  assert.equal(pickNotchStatus({ events: [{ title: '复盘', start: at(15, 40), durationMin: 30 }] }, now), null, 'more than an hour away');
  const ongoing = pickNotchStatus({ events: [{ title: '站会', start: at(14, 15), durationMin: 30 }] }, now);
  assert.deepEqual([ongoing.detail, ongoing.tone], ['进行中', 'focus']);
  assert.equal(pickNotchStatus({ events: [{ title: '早会', start: at(9), durationMin: 30 }] }, now), null, 'finished events are gone');
  const later = pickNotchStatus({ later: [{ note: '', at: at(16) }, { note: '看导出进度', at: at(14, 40) }] }, now);
  assert.deepEqual([later.text, later.detail], ['看导出进度', '14:40']);
});

test('after off-work time, quietly show the time while you are still at the computer', () => {
  const late = at(23, 12);
  assert.deepEqual(pickNotchStatus({ offwork: { enabled: true, time: '22:30' } }, late), {
    kind: 'offwork', icon: 'moon', text: '已过收工时间', detail: '23:12', tone: 'calm', progress: null, target: 'home',
  });
  assert.equal(pickNotchStatus({ offwork: { enabled: true, time: '22:30' }, active: false }, late), null, 'not while away');
  assert.equal(pickNotchStatus({ offwork: { enabled: false, time: '22:30' } }, late), null);
  assert.equal(pickNotchStatus({ offwork: { enabled: true, time: '22:30' } }, new Date(2026, 8, 26, 1, 5).getTime()).detail, '01:05', 'past midnight still counts');
  assert.equal(duration(3725), '1:02:05');
});
