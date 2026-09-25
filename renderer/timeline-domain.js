// Home "今天" timeline: schedule events, "remind me later" entries and the day's time axis.
// Pure helpers shared by the renderer and Node tests.
(function exposeTimelineDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchTimeline = api;
})(typeof window !== 'undefined' ? window : globalThis, function createTimelineDomain() {
  const DAY_START_HOUR = 8;
  const DAY_END_HOUR = 24;
  const MAX_EVENTS = 300;
  const MAX_LATER = 50;
  const clean = (value, limit) => Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim())
    .slice(0, limit).join('');

  function dayBounds(now = Date.now()) {
    const date = new Date(Number(now));
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    return { start, end: start + 86400000 };
  }

  // Position (0–100) of a timestamp on today's 08:00–24:00 axis; null when outside it.
  function axisPercent(time, now = Date.now()) {
    const { start } = dayBounds(now);
    const from = start + DAY_START_HOUR * 3600000;
    const to = start + DAY_END_HOUR * 3600000;
    if (!Number.isFinite(time) || time < from || time > to) return null;
    return ((time - from) / (to - from)) * 100;
  }

  function normalizeEvent(item) {
    if (!item || typeof item !== 'object') return null;
    const id = clean(item.id, 80);
    const title = clean(item.title, 40);
    const start = Number(item.start);
    if (!id || !title || !Number.isFinite(start) || start <= 0) return null;
    const duration = Math.round(Number(item.durationMin));
    const remind = Math.round(Number(item.remindMin));
    return {
      id,
      title,
      start,
      durationMin: duration >= 5 && duration <= 720 ? duration : 30,
      remindMin: remind >= 0 && remind <= 120 ? remind : 10,
      remindedAt: Math.max(0, Number(item.remindedAt) || 0),
    };
  }

  function normalizeEvents(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(normalizeEvent).filter((event) => {
      if (!event || seen.has(event.id)) return false;
      seen.add(event.id);
      return true;
    }).sort((left, right) => left.start - right.start).slice(-MAX_EVENTS);
  }

  function normalizeLater(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = clean(item.id, 80);
      const at = Number(item.at);
      if (!id || !Number.isFinite(at) || at <= 0) return null;
      return { id, note: clean(item.note, 60), at, createdAt: Math.max(0, Number(item.createdAt) || 0) };
    }).filter(Boolean).sort((left, right) => left.at - right.at).slice(0, MAX_LATER);
  }

  function eventsForDay(events, now = Date.now()) {
    const { start, end } = dayBounds(now);
    return normalizeEvents(events).filter((event) => event.start >= start && event.start < end);
  }

  // What the main process should notify about: events (ahead by remindMin) and later reminders.
  function reminderQueue(events, later, now = Date.now()) {
    const upcoming = normalizeEvents(events)
      .filter((event) => !event.remindedAt && event.start + event.durationMin * 60000 > now)
      .map((event) => ({
        id: `event-${event.id}`,
        kind: 'event',
        title: event.title,
        detail: event.remindMin ? `${event.remindMin} 分钟后开始` : '现在开始',
        at: event.start - event.remindMin * 60000,
      }));
    const laters = normalizeLater(later).map((item) => ({
      id: `later-${item.id}`,
      kind: 'later',
      title: item.note || '到时间了',
      detail: '稍后提醒',
      at: item.at,
    }));
    return [...upcoming, ...laters].sort((left, right) => left.at - right.at);
  }

  // Parse quick input such as "3点 客户电话 30分钟", "下午3点半 复盘", "15:00 电话".
  function parseEventInput(text, now = Date.now()) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const base = new Date(Number(now));
    let day = 0;
    let rest = raw;
    if (/明天/.test(rest)) { day = 1; rest = rest.replace(/明天/, ' '); }
    else if (/后天/.test(rest)) { day = 2; rest = rest.replace(/后天/, ' '); }
    else rest = rest.replace(/今天/, ' ');
    let hour = null;
    let minute = 0;
    const clock = rest.match(/(\d{1,2})[:：](\d{2})/);
    const chinese = rest.match(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半|(\d{1,2})\s*分?)?/);
    if (clock) {
      hour = Number(clock[1]);
      minute = Number(clock[2]);
      rest = rest.replace(clock[0], ' ');
    } else if (chinese) {
      hour = Number(chinese[2]);
      minute = chinese[3] === '半' ? 30 : Number(chinese[4] || 0);
      const period = chinese[1] || '';
      if (/下午|晚上/.test(period) && hour < 12) hour += 12;
      if (period === '中午' && hour < 11) hour += 12;
      // A bare "3点" during working hours means the afternoon.
      if (!period && hour >= 1 && hour <= 7) hour += 12;
      rest = rest.replace(chinese[0], ' ');
    }
    let durationMin = 30;
    // \b does not work next to Chinese characters, so only exclude a following Latin letter.
    const duration = rest.match(/(\d{1,3})\s*(分钟|min|m)(?![a-z])|(\d(?:\.\d)?)\s*(小时|h)(?![a-z])/i);
    if (duration) {
      durationMin = duration[1] ? Number(duration[1]) : Math.round(Number(duration[3]) * 60);
      rest = rest.replace(duration[0], ' ');
    }
    const title = clean(rest, 40);
    if (hour === null || hour > 23 || minute > 59 || !title) return null;
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + day, hour, minute).getTime();
    return { title, start, durationMin: Math.max(5, Math.min(720, durationMin)) };
  }

  function laterAt(preset, now = Date.now()) {
    const current = new Date(Number(now));
    if (preset === 'evening') {
      const evening = new Date(current.getFullYear(), current.getMonth(), current.getDate(), 20, 0).getTime();
      return evening > now ? evening : evening + 86400000;
    }
    const minutes = Number(preset);
    return Number.isFinite(minutes) && minutes > 0 ? Number(now) + minutes * 60000 : null;
  }

  function clock(time) {
    const date = new Date(time);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  function summary({ dueCount = 0, eventCount = 0, focusMinutes = 0 } = {}) {
    const parts = [];
    if (dueCount) parts.push(`${dueCount} 项到期`);
    if (eventCount) parts.push(`${eventCount} 个日程`);
    if (focusMinutes) parts.push(`已专注 ${focusMinutes} 分钟`);
    return parts.join(' · ') || '今天还没有安排';
  }

  return {
    DAY_START_HOUR,
    DAY_END_HOUR,
    dayBounds,
    axisPercent,
    normalizeEvents,
    normalizeLater,
    eventsForDay,
    reminderQueue,
    parseEventInput,
    laterAt,
    clock,
    summary,
  };
});
