// 番茄钟计时：首页「现在」、刘海状态、右键菜单、⌘K 与提醒浮窗按钮共用这一份状态（window.NotchPomodoro）。
// 按结束时刻计时，面板收起或被节流也不会走慢；每次变化派发 notch:pomodoro-changed。
(function setupFocusTimer() {
  'use strict';

  const Home = window.NotchHomeDomain;
  if (!Home) return;

  const MINUTES_KEY = 'notch-focus-minutes-v1';
  const LEGACY_KEY = 'dynamic-panel-pomodoro-duration-v3';
  const FOCUS_LOG_KEY = 'notch-focus-log-v1';
  const EXTEND_LIMIT_SECONDS = 120 * 60;

  function readMinutes() {
    try {
      const stored = localStorage.getItem(MINUTES_KEY);
      if (stored !== null) return Home.focusMinutes(stored);
      return Home.focusMinutesFromLegacy(JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'));
    } catch (error) {
      return Home.DEFAULT_FOCUS_MINUTES;
    }
  }

  let minutes = readMinutes();
  // mode：'focus' 计入专注记录；'break' 是「休息 5 分钟」，不计入。
  let session = null; // { mode, seconds, endsAt, remaining, running, startedAt, focusedMs, resumedAt, task }
  let ticker = null;

  const toast = (message) => { if (typeof window.showStatusToast === 'function') window.showStatusToast(message); };

  function remainingSeconds(now = Date.now()) {
    if (!session) return minutes * 60;
    return session.running ? Math.max(0, (session.endsAt - now) / 1000) : session.remaining;
  }

  function focusedMs(now = Date.now()) {
    if (!session) return 0;
    return session.focusedMs + (session.running ? now - session.resumedAt : 0);
  }

  function state() {
    const remaining = remainingSeconds();
    return {
      running: Boolean(session && session.running),
      started: Boolean(session),
      mode: session ? session.mode : 'focus',
      remaining: Math.ceil(remaining),
      session: session ? session.seconds : minutes * 60,
      endsAt: session && session.running ? session.endsAt : 0,
      elapsedMinutes: Math.floor(focusedMs() / 60000),
      task: session && session.task ? { ...session.task } : null,
      minutes,
    };
  }

  function changed() {
    document.dispatchEvent(new CustomEvent('notch:pomodoro-changed', { detail: state() }));
  }

  // 告诉主进程是否在专注：专注期间 AI 完成提醒只计数，身体提醒延后。
  function reportFocusState() {
    window.notchAPI?.setFocusState?.({
      running: Boolean(session && session.running),
      mode: session ? session.mode : 'focus',
      endsAt: session && session.running ? session.endsAt : 0,
    });
  }

  // 专注时段记在本机，供首页、时间线与时间页使用（只保留最近 500 条）。
  function recordFocus(ms, complete) {
    const end = Date.now();
    const loggedMinutes = Math.max(1, Math.round(ms / 60000));
    try {
      const log = JSON.parse(localStorage.getItem(FOCUS_LOG_KEY) || '[]');
      const next = [...(Array.isArray(log) ? log : []), { start: end - loggedMinutes * 60000, end, minutes: loggedMinutes, complete }].slice(-500);
      localStorage.setItem(FOCUS_LOG_KEY, JSON.stringify(next));
    } catch (error) {
      // 存储不可用时只影响统计，不影响计时本身。
    }
    document.dispatchEvent(new CustomEvent('notch:focus-logged'));
  }

  function stopTicker() {
    clearInterval(ticker);
    ticker = null;
  }

  function tick() {
    if (!session || !session.running) return;
    if (Date.now() >= session.endsAt) complete();
    else changed();
  }

  function startTicker() {
    stopTicker();
    ticker = setInterval(tick, 1000);
  }

  function complete() {
    if (!session) return;
    const { mode, seconds } = session;
    const done = focusedMs();
    const doneMinutes = Math.max(1, Math.round(seconds / 60));
    stopTicker();
    session = null;
    if (mode === 'focus') {
      recordFocus(done || seconds * 1000, true);
      toast(`${doneMinutes} 分钟专注完成`);
    } else {
      toast('休息结束');
    }
    window.notchAPI?.notifyPomodoro?.({ minutes: doneMinutes, mode })?.catch?.(() => {});
    reportFocusState();
    changed();
  }

  function start(seconds, mode = 'focus', options = {}) {
    const safeSeconds = Math.max(1, Math.round(Number(seconds) || minutes * 60));
    const now = Date.now();
    session = {
      mode: mode === 'break' ? 'break' : 'focus',
      seconds: safeSeconds,
      endsAt: now + safeSeconds * 1000,
      remaining: safeSeconds,
      running: true,
      startedAt: now,
      focusedMs: 0,
      resumedAt: now,
      task: options.task && options.task.text ? { id: String(options.task.id || ''), text: String(options.task.text), categoryId: String(options.task.categoryId || ''), deadline: String(options.task.deadline || '') } : null,
    };
    startTicker();
    reportFocusState();
    changed();
  }

  function pause() {
    if (!session || !session.running) return;
    const now = Date.now();
    session.remaining = Math.max(0, (session.endsAt - now) / 1000);
    session.focusedMs += now - session.resumedAt;
    session.running = false;
    stopTicker();
    reportFocusState();
    changed();
  }

  function resume() {
    if (!session || session.running) return;
    const now = Date.now();
    session.endsAt = now + session.remaining * 1000;
    session.resumedAt = now;
    session.running = true;
    startTicker();
    reportFocusState();
    changed();
  }

  function toggle() {
    if (!session) start(minutes * 60, 'focus', { task: window.NotchHomeNow?.task?.() });
    else if (session.running) pause();
    else resume();
  }

  // 「+5 分钟」：把这一段延长，总长不超过 2 小时。
  function extend(seconds = 300) {
    if (!session) return;
    const add = Math.max(0, Math.min(Number(seconds) || 0, EXTEND_LIMIT_SECONDS - session.seconds));
    if (!add) return;
    session.seconds += add;
    if (session.running) session.endsAt += add * 1000;
    else session.remaining += add;
    reportFocusState();
    changed();
  }

  // 「结束」：专注满 1 分钟就记下实际专注的时长（不算一个完整番茄）；休息直接结束。
  function finish() {
    if (!session) return;
    const { mode } = session;
    const done = focusedMs();
    stopTicker();
    session = null;
    if (mode === 'focus' && done >= 60000) {
      recordFocus(done, false);
      toast(`专注了 ${Home.durationText(Math.round(done / 60000))}`);
    } else if (mode === 'break') {
      toast('休息结束');
    }
    reportFocusState();
    changed();
  }

  function setMinutes(value) {
    minutes = Home.focusMinutes(value);
    try { localStorage.setItem(MINUTES_KEY, String(minutes)); } catch (error) {}
    changed();
    return minutes;
  }

  window.NotchPomodoro = {
    start,
    toggle,
    pause,
    resume,
    extend,
    finish,
    setMinutes,
    minutes: () => minutes,
    state,
  };
})();
