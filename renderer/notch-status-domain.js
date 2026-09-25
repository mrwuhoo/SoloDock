// 刘海下沿状态：同一时刻只显示最要紧的一条。纯函数，渲染层与 Node 测试共用。
// 优先级：AI 需要你确认 ＞ 录音中 ＞ 专注 / 休息 ＞ AI 额度不足（低于 20%）＞ 60 分钟内的日程 ＞ 稍后提醒 ＞ 收工后。
(function exposeNotchStatusDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchStatus = api;
})(typeof window !== 'undefined' ? window : globalThis, function createNotchStatusDomain() {
  const EVENT_WINDOW_MS = 60 * 60 * 1000;
  const LOW_QUOTA = 20;

  const pad = (value) => String(value).padStart(2, '0');
  const clock = (time) => {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const duration = (seconds) => {
    const safe = Math.max(0, Math.round(seconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    return hours ? `${hours}:${pad(minutes)}:${pad(safe % 60)}` : `${pad(minutes)}:${pad(safe % 60)}`;
  };
  const minutesUntil = (time, now) => Math.max(1, Math.ceil((time - now) / 60000));

  function atClock(now, hhmm) {
    const date = new Date(now);
    const [hour, minute] = String(hhmm || '').split(':').map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute).getTime();
  }

  /**
   * @returns {null | { kind, icon, text, detail, tone, progress, target }}
   *   target 是点击后要去的页面：home / recordings / todo / settings。
   */
  function pickNotchStatus(input = {}, now = Date.now()) {
    const needsYou = input.needsYou;
    if (needsYou && needsYou.title) {
      return { kind: 'needs-you', icon: 'alert', text: needsYou.title, detail: '', tone: 'needs', progress: null, target: 'home' };
    }

    const recording = input.recording;
    if (recording && ['recording', 'paused', 'saving'].includes(recording.status)) {
      const text = recording.status === 'saving' ? '正在保存录音' : recording.status === 'paused' ? '录音已暂停' : '录音中';
      return {
        kind: 'recording', icon: 'dot', text, detail: recording.status === 'saving' ? '' : duration((Number(recording.durationMs) || 0) / 1000),
        tone: 'recording', progress: null, target: 'recordings',
      };
    }

    const pomodoro = input.pomodoro;
    if (pomodoro && pomodoro.started) {
      const isBreak = pomodoro.mode === 'break';
      const session = Math.max(1, Number(pomodoro.session) || 1);
      const remaining = Math.max(0, Number(pomodoro.remaining) || 0);
      return {
        kind: isBreak ? 'break' : 'focus',
        icon: isBreak ? 'leaf' : 'timer',
        text: pomodoro.running ? (isBreak ? '休息中' : '专注中') : (isBreak ? '休息已暂停' : '专注已暂停'),
        detail: duration(remaining),
        tone: isBreak ? 'calm' : 'focus',
        progress: 1 - remaining / session,
        target: 'home',
      };
    }

    const low = (Array.isArray(input.quota) ? input.quota : [])
      .filter((item) => item && Number.isFinite(item.remaining) && item.remaining < LOW_QUOTA)
      .sort((left, right) => left.remaining - right.remaining)[0];
    if (low) {
      return { kind: 'quota', icon: 'gauge', text: `${low.name} 额度不足`, detail: `${Math.round(low.remaining)}%`, tone: 'warning', progress: null, target: 'home' };
    }

    const event = (Array.isArray(input.events) ? input.events : [])
      .filter((item) => item && Number.isFinite(item.start))
      .map((item) => ({ ...item, end: item.start + (Number(item.durationMin) || 30) * 60000 }))
      .filter((item) => item.end > now && item.start - now <= EVENT_WINDOW_MS)
      .sort((left, right) => left.start - right.start)[0];
    if (event) {
      const ongoing = event.start <= now;
      return {
        kind: 'event', icon: 'calendar', text: `${clock(event.start)} ${event.title}`,
        detail: ongoing ? '进行中' : `${minutesUntil(event.start, now)} 分钟后`, tone: ongoing ? 'focus' : 'info', progress: null, target: 'home',
      };
    }

    const later = (Array.isArray(input.later) ? input.later : [])
      .filter((item) => item && Number.isFinite(item.at) && item.at > now)
      .sort((left, right) => left.at - right.at)[0];
    if (later) {
      return { kind: 'later', icon: 'bell', text: later.note || '稍后提醒', detail: clock(later.at), tone: 'info', progress: null, target: 'home' };
    }

    const offwork = input.offwork;
    if (offwork && offwork.enabled && input.active !== false) {
      const at = atClock(now, offwork.time);
      // 过了收工时间还在用电脑：安静地显示现在几点，不闪烁。零点后到早上 5 点也算「昨晚还没收工」。
      const hour = new Date(now).getHours();
      if ((at !== null && now >= at) || hour < 5) {
        return { kind: 'offwork', icon: 'moon', text: '已过收工时间', detail: clock(now), tone: 'calm', progress: null, target: 'home' };
      }
    }
    return null;
  }

  return { pickNotchStatus, duration, clock, LOW_QUOTA, EVENT_WINDOW_MS };
});
