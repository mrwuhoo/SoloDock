// 统一提醒：每类提醒的按钮与停留方式，以及身体与作息提醒（久坐、护眼、收工）的判断。
// 纯函数，时间由调用方传入，便于测试；主进程每 30 秒用 macOS 的系统空闲时间喂给 tracker。

const BREAK_IDLE_MS = 5 * 60 * 1000; // 离开电脑 5 分钟算休息过一次
const ACTIVE_IDLE_MS = 2 * 60 * 1000; // 2 分钟内有操作才算「正在用电脑」
const SIT_CHOICES = [30, 45, 50, 60, 90];
const EYE_CHOICES = [20, 30, 45];
const AI_SOURCES = new Set(['codex', 'claude', 'gpt', 'chatgpt', 'task']);

const action = (id, label, primary = false) => ({ id, label, ...(primary ? { primary: true } : {}) });

// visibleMs 为 0 表示不自动消失（要你处理的：待办到期、日程、收工）。
function reminderPresentation(source) {
  switch (source) {
    case 'pomodoro':
      return { visibleMs: 12_000, actions: [action('break-5', '休息 5 分钟', true), action('focus-5', '再专注 5 分钟'), action('dismiss', '跳过')] };
    case 'pomodoro-break':
      return { visibleMs: 12_000, actions: [action('focus-again', '开始专注', true), action('dismiss', '知道了')] };
    case 'todo':
      return { visibleMs: 0, actions: [action('todo-done', '完成', true), action('snooze-30', '30 分钟后'), action('open-todo', '打开')] };
    case 'event':
    case 'reminder':
      return { visibleMs: 0, actions: [action('dismiss', '知道了', true), action('snooze-10', '10 分钟后再提醒')] };
    case 'sit':
      return { visibleMs: 15_000, actions: [action('break-5', '休息 5 分钟', true), action('body-snooze-10', '10 分钟后'), action('body-mute-today', '今天不再提醒')] };
    case 'eye':
      return { visibleMs: 20_000, style: 'quiet', actions: [] };
    case 'offwork':
      return { visibleMs: 0, actions: [action('move-tomorrow', '待办挪到明天', true), action('body-snooze-30', '再工作 30 分钟')] };
    case 'needs-you':
      return { visibleMs: 0, actions: [action('open', '跳回窗口', true), action('snooze-10', '稍后提醒')] };
    case 'focus-summary':
    case 'info':
      return { visibleMs: 6_000, actions: [] };
    default:
      return AI_SOURCES.has(source)
        ? { visibleMs: 8_000, actions: [action('open', '跳回窗口', true), action('snooze-10', '稍后提醒')] }
        : { visibleMs: 8_000, actions: [] };
  }
}

function isAiSource(source) {
  return AI_SOURCES.has(String(source || ''));
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeBodySettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const part = (key) => (source[key] && typeof source[key] === 'object' ? source[key] : {});
  const sit = part('sit');
  const eye = part('eye');
  const offwork = part('offwork');
  const worklog = part('worklog');
  return {
    sit: { enabled: sit.enabled !== false, minutes: SIT_CHOICES.includes(Number(sit.minutes)) ? Number(sit.minutes) : 50 },
    eye: { enabled: eye.enabled === true, minutes: EYE_CHOICES.includes(Number(eye.minutes)) ? Number(eye.minutes) : 20 },
    offwork: { enabled: offwork.enabled !== false, time: TIME.test(String(offwork.time || '')) ? offwork.time : '22:30' },
    // 工作时间统计（时间页）：只记在用电脑与专注的时间段，关掉后立即停止。
    worklog: { enabled: worklog.enabled !== false },
  };
}

function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function atTime(time, hhmm, dayOffset = 0) {
  const date = new Date(time);
  const [hour, minute] = hhmm.split(':').map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset, hour, minute).getTime();
}

/**
 * 连续使用电脑的计时：系统空闲 ≥ 5 分钟（或锁屏、休眠）算休息，计时清零。
 * sample() 返回这一刻应该发出的提醒种类数组（'sit' | 'eye' | 'offwork'）。
 */
function createActivityTracker(initialSettings, startedAt = Date.now()) {
  let settings = normalizeBodySettings(initialSettings);
  let activeSince = null;
  let lastSitAt = 0;
  let lastEyeAt = 0;
  let focusUntil = 0;
  const snoozedUntil = { sit: 0, offwork: 0 };
  const mutedOn = { sit: '' };
  let offworkNextAt = atTime(startedAt, settings.offwork.time);
  // 启动时已经过了收工时间，就从明天开始算（刚打开电脑不该立刻催收工）。
  if (offworkNextAt <= startedAt) offworkNextAt = atTime(startedAt, settings.offwork.time, 1);

  function takeBreak() {
    activeSince = null;
    lastSitAt = 0;
    lastEyeAt = 0;
  }

  function sample(idleMs, now) {
    const fired = [];
    if (idleMs >= BREAK_IDLE_MS) {
      takeBreak();
      return fired;
    }
    if (activeSince === null) activeSince = now - idleMs;
    const focusing = focusUntil > now;
    const active = idleMs < ACTIVE_IDLE_MS;

    if (settings.sit.enabled && !focusing && mutedOn.sit !== dayKey(now) && now >= snoozedUntil.sit) {
      if (now - Math.max(activeSince, lastSitAt) >= settings.sit.minutes * 60_000) {
        fired.push('sit');
        lastSitAt = now;
        // 同一刻只提醒一件事：久坐提醒已经包含「看看远处」。
        lastEyeAt = now;
      }
    }
    if (settings.eye.enabled && !focusing && !fired.length && active) {
      if (now - Math.max(activeSince, lastEyeAt) >= settings.eye.minutes * 60_000) {
        fired.push('eye');
        lastEyeAt = now;
      }
    }
    if (settings.offwork.enabled && !focusing && active && now >= offworkNextAt && now >= snoozedUntil.offwork) {
      fired.push('offwork');
      offworkNextAt = atTime(now, settings.offwork.time, 1);
    }
    return fired;
  }

  return {
    sample,
    takeBreak,
    setSettings(next, now = Date.now()) {
      const previousTime = settings.offwork.time;
      settings = normalizeBodySettings(next);
      if (settings.offwork.time !== previousTime) {
        offworkNextAt = atTime(now, settings.offwork.time);
        if (offworkNextAt <= now) offworkNextAt = atTime(now, settings.offwork.time, 1);
      }
    },
    settings: () => normalizeBodySettings(settings),
    // 番茄钟专注期间不打扰；结束后条件仍满足就会提醒。
    setFocusUntil(time) { focusUntil = Math.max(0, Number(time) || 0); },
    // 「休息 5 分钟」：从现在起重新计时。
    startBreak(now) { activeSince = now; lastSitAt = now; lastEyeAt = now; },
    // 「10 分钟后」：到点就再提醒（只要这期间没有离开电脑休息过）。
    snooze(kind, minutes, now) {
      if (kind === 'sit') {
        snoozedUntil.sit = now + minutes * 60_000;
        lastSitAt = 0;
      }
      if (kind === 'offwork') {
        snoozedUntil.offwork = now + minutes * 60_000;
        offworkNextAt = Math.min(offworkNextAt, snoozedUntil.offwork);
      }
    },
    muteToday(kind, now) { if (kind === 'sit') mutedOn.sit = dayKey(now); },
    state: () => ({ activeSince, lastSitAt, lastEyeAt, offworkNextAt, focusUntil }),
  };
}

/**
 * 番茄钟专注期间暂存 AI 完成提醒；专注结束（或暂停、到点）后交出：1 条原样返回，多条合成一条汇总。
 */
function createFocusHold() {
  let focus = { running: false, mode: 'focus', endsAt: 0 };
  const held = [];
  const focusing = (now) => focus.running && focus.mode === 'focus' && focus.endsAt > now;
  return {
    setFocus(state) {
      focus = {
        running: Boolean(state && state.running),
        mode: state && state.mode === 'break' ? 'break' : 'focus',
        endsAt: Math.max(0, Number(state && state.endsAt) || 0),
      };
    },
    focusing,
    focus: () => ({ ...focus }),
    // 返回 true 表示已暂存，不要弹出。
    hold(notification, now) {
      if (!isAiSource(notification && notification.source) || !focusing(now)) return false;
      held.push(notification);
      return true;
    },
    flush(now) {
      if (focusing(now) || !held.length) return [];
      const items = held.splice(0);
      if (items.length === 1) return [{ ...items[0], eventId: `${items[0].eventId}-after-focus` }];
      const titles = items.map((item) => item.title).filter(Boolean);
      return [{
        eventId: `focus-summary-${now}`,
        taskId: `focus-summary-${now}`,
        source: 'focus-summary',
        project: '',
        title: `专注期间完成了 ${items.length} 个 AI 任务`,
        detail: titles.slice(0, 3).join('、') + (titles.length > 3 ? ' 等' : ''),
        completedAt: now,
      }];
    },
    size: () => held.length,
  };
}

// ============ 暂停提醒 ============
// 开会、录课或想安静一会儿时，所有弹出提醒先不弹，照常记进通知中心；恢复时汇总成一句。
// 「今天不再提醒」到次日 04:00（和随手记、笔记的「一天」同一条分界线）。
const PAUSE_CHOICES = [
  { id: '30m', label: '30 分钟' },
  { id: '1h', label: '1 小时' },
  { id: '2h', label: '2 小时' },
  { id: 'today', label: '今天不再提醒' },
];
const DAY_BOUNDARY_HOUR = 4;

function pauseUntil(choice, now = Date.now()) {
  const minutes = { '30m': 30, '1h': 60, '2h': 120 }[choice];
  if (minutes) return now + minutes * 60_000;
  if (choice !== 'today') return 0;
  const end = new Date(now);
  if (end.getHours() >= DAY_BOUNDARY_HOUR) end.setDate(end.getDate() + 1);
  end.setHours(DAY_BOUNDARY_HOUR, 0, 0, 0);
  return end.getTime();
}

// 「15:30 恢复」/「明天 04:00 恢复」
function pauseResumeLabel(until, now = Date.now()) {
  const date = new Date(until);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return `${sameDay ? '' : '明天 '}${clock} 恢复`;
}

function createReminderPause(initialUntil = 0, now = Date.now()) {
  let until = Number(initialUntil) > now ? Number(initialUntil) : 0;
  let missed = 0;
  return {
    until: () => until,
    paused: (at = Date.now()) => until > at,
    start(nextUntil, at = Date.now()) {
      if (!(until > at)) missed = 0;
      until = Number(nextUntil) > at ? Number(nextUntil) : 0;
      return until;
    },
    // 返回 true 表示暂停中：已记进通知中心，不要弹出。
    hold(notification, at = Date.now()) {
      if (!(until > at) || !notification) return false;
      missed += 1;
      return true;
    },
    // 到点或手动恢复：返回要弹出的一条汇总（没错过就是 null）。
    resume(at = Date.now()) {
      const count = missed;
      until = 0;
      missed = 0;
      if (!count) return null;
      return {
        eventId: `pause-summary-${at}`,
        taskId: `pause-summary-${at}`,
        source: 'info',
        project: '',
        title: `暂停期间有 ${count} 条提醒`,
        detail: '都在通知中心里，点顶栏的铃铛查看',
        completedAt: at,
        record: false,
      };
    },
    missed: () => missed,
  };
}

module.exports = {
  createReminderPause,
  pauseUntil,
  pauseResumeLabel,
  PAUSE_CHOICES,
  createFocusHold,
  BREAK_IDLE_MS,
  ACTIVE_IDLE_MS,
  SIT_CHOICES,
  EYE_CHOICES,
  reminderPresentation,
  isAiSource,
  normalizeBodySettings,
  createActivityTracker,
};
