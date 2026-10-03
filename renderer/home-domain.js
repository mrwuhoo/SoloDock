// 首页「现在」与「精力」的纯函数：面板与单元测试共用。
// 精力只陈述事实：今天在电脑前多久、距离上次休息多久、今天专注多少；不和别的日子比，不打分。
(function exposeHomeDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchHomeDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createHomeDomain() {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const FOCUS_CHOICES = [15, 25, 45, 60];
  const DEFAULT_FOCUS_MINUTES = 25;
  const LONG_DAY_MINUTES = 10 * 60; // 与时间页一致：超过 10 小时算过度工作，只用暖色标出来
  const REST_DAY_MINUTES = 30;
  const DEFAULT_BREAK_MINUTES = 50;
  const WEEK_SCALE_MINUTES = 8 * 60; // 7 天柱子的最低满格：普通的一天不会顶满
  const DAY_BOUNDARY_HOUR = 4;
  const WEEKDAY = '日一二三四五六';

  const pad = (value) => String(value).padStart(2, '0');

  function clock(time) {
    const date = new Date(Number(time));
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 倒计时读数：25:00、04:09。
  function countdown(seconds) {
    const safe = Math.max(0, Math.ceil(Number(seconds) || 0));
    return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`;
  }

  function durationText(minutes) {
    const safe = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(safe / 60);
    const rest = safe % 60;
    if (!hours) return `${rest} 分钟`;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }

  // 大号数字：「5 小时 20 分」拆成数字与单位，单位用小字。
  function durationParts(minutes) {
    const safe = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(safe / 60);
    const rest = safe % 60;
    if (!hours) return [{ value: String(rest), unit: '分钟' }];
    return [{ value: String(hours), unit: '小时' }, { value: String(rest), unit: '分' }];
  }

  function untilText(ms) {
    const minutes = Math.round(Number(ms) / MINUTE);
    return minutes <= 0 ? '马上' : `${durationText(minutes)}后`;
  }

  function startOfDay(time) {
    const date = new Date(Number(time));
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  // 没写具体时间的待办截止在当天 23:30（随手记与待办页的约定）。
  function isDateOnly(time) {
    const date = new Date(Number(time));
    return date.getHours() === 23 && date.getMinutes() === 30;
  }

  // ---------------- 番茄钟 ----------------
  // 拉环表盘可以拨到任意整分钟：1–120 分钟（与「+5 分钟」的总长上限一致）。
  const MIN_FOCUS_MINUTES = 1;
  const MAX_FOCUS_MINUTES = 120;

  function focusMinutes(value) {
    const minutes = Math.round(Number(value));
    if (!Number.isFinite(minutes) || minutes < MIN_FOCUS_MINUTES) return DEFAULT_FOCUS_MINUTES;
    return Math.min(MAX_FOCUS_MINUTES, minutes);
  }

  // 旧版番茄钟存的是 [分, 秒]（更早是 [时, 分, 秒]），默认 5 分钟；只沿用正好是四档之一的时长。
  function focusMinutesFromLegacy(value) {
    if (!Array.isArray(value)) return DEFAULT_FOCUS_MINUTES;
    const parts = value.map((part) => Number(part) || 0);
    const minutes = parts.length === 3 ? parts[0] * 60 + parts[1] : parts[0];
    return !parts[parts.length - 1] && FOCUS_CHOICES.includes(minutes) ? minutes : DEFAULT_FOCUS_MINUTES;
  }

  // ---------------- 拉环表盘 ----------------
  // 参考锤子时钟的拉环计时器：表盘一圈是 60 分钟，从 12 点顺时针拖拉环定时长；
  // 蓝色弧是「剩下的」时间，计时中拉环沿着表盘慢慢退回 12 点。超过 60 分钟的部分画在第二圈。
  const DIAL_MINUTES = 60;
  const round2 = (value) => Math.round(value * 100) / 100;

  // 表盘上某个分钟数的位置（0 在 12 点，顺时针）。
  function dialPoint(minutes, r, cx = 50, cy = 50) {
    const angle = ((Number(minutes) || 0) / DIAL_MINUTES) * Math.PI * 2 - Math.PI / 2;
    return { x: round2(cx + Math.cos(angle) * r), y: round2(cy + Math.sin(angle) * r) };
  }

  // 从 12 点顺时针到某个分钟数的弧线（只画一圈以内；满一圈画成整圆，0 不画）。
  function dialArc(minutes, r, cx = 50, cy = 50) {
    const m = Math.max(0, Math.min(DIAL_MINUTES, Number(minutes) || 0));
    if (m <= 0.01) return '';
    const top = `M${round2(cx)} ${round2(cy - r)}`;
    if (m >= DIAL_MINUTES - 0.01) return `${top}A${r} ${r} 0 1 1 ${round2(cx)} ${round2(cy + r)}A${r} ${r} 0 1 1 ${round2(cx)} ${round2(cy - r)}`;
    const end = dialPoint(m, r, cx, cy);
    return `${top}A${r} ${r} 0 ${m > DIAL_MINUTES / 2 ? 1 : 0} 1 ${end.x} ${end.y}`;
  }

  // 一圈 24 格稀疏刻度（每 2.5 分钟一格），0 / 15 / 30 / 45 是长刻度。
  function dialTicks(cx = 50, cy = 50, outer = 47) {
    return Array.from({ length: 24 }, (_, slot) => {
      const index = slot * 2.5;
      const major = slot % 6 === 0;
      const a = dialPoint(index, outer, cx, cy);
      const b = dialPoint(index, major ? outer - 3.5 : outer - 2.2, cx, cy);
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, major };
    });
  }

  // 指针在表盘上的角度换成分钟（0–60，12 点为 0，顺时针）。
  function dialMinutesAt(x, y, cx, cy) {
    const angle = Math.atan2(Number(y) - cy, Number(x) - cx) + Math.PI / 2;
    const turn = ((angle / (Math.PI * 2)) % 1 + 1) % 1;
    return turn * DIAL_MINUTES;
  }

  // 拖动时两次读数之间走了多少分钟：跨过 12 点时取最近的方向，这样能连续拨到第二圈。
  function dialStep(from, to) {
    let step = (Number(to) || 0) - (Number(from) || 0);
    if (step > DIAL_MINUTES / 2) step -= DIAL_MINUTES;
    if (step < -DIAL_MINUTES / 2) step += DIAL_MINUTES;
    return step;
  }

  // 拖过头时的阻尼：超出 1–120 的部分只跟手三成，松手再弹回界内。
  function dialResist(value, min = MIN_FOCUS_MINUTES, max = MAX_FOCUS_MINUTES) {
    const v = Number(value) || 0;
    if (v < min) return min - (min - v) * 0.3;
    if (v > max) return max + (v - max) * 0.3;
    return v;
  }

  // 松手后停在最近的整分钟，并落回 1–120 之内。
  function dialSettle(value) {
    return Math.max(MIN_FOCUS_MINUTES, Math.min(MAX_FOCUS_MINUTES, Math.round(Number(value) || 0)));
  }

  // 表盘中间的数字：还剩几分钟（不足一分钟也写 1，走完为 0）。
  function remainingMinutes(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    return safe <= 0 ? 0 : Math.ceil(safe / 60);
  }

  // 读屏与提示用的一句：不跳秒，只说还剩几分钟。
  function remainingText(seconds, mode = 'focus') {
    const minutes = Math.max(1, Math.ceil((Number(seconds) || 0) / 60));
    return mode === 'break' ? `休息还剩 ${minutes} 分钟` : `还剩 ${minutes} 分钟`;
  }

  // 今天的专注：完整走完的算一个番茄；提前结束的只计分钟。
  function focusToday(log, dayStart, dayEnd = Infinity) {
    let tomatoes = 0;
    let minutes = 0;
    for (const entry of Array.isArray(log) ? log : []) {
      const end = Number(entry && entry.end);
      if (!Number.isFinite(end) || end < dayStart || end >= dayEnd) continue;
      minutes += Math.max(0, Number(entry.minutes) || 0);
      if (entry.complete !== false) tomatoes += 1;
    }
    return { tomatoes, minutes };
  }

  // ---------------- 现在 ----------------
  // 「现在」这件事：标了「在做」的就是它；否则是今天最急的一件（逾期在前，其次最早截止）。
  function currentTask({ doing = null, today = [] } = {}) {
    if (doing && doing.id) return { id: String(doing.id), text: String(doing.text || ''), categoryId: doing.categoryId || doing.priority || '', deadline: doing.deadline || '', source: 'doing' };
    const first = (Array.isArray(today) ? today : [])[0];
    if (!first) return null;
    return { id: String(first.id), text: String(first.text || ''), categoryId: first.priority || first.categoryId || '', deadline: first.due ? new Date(first.due).toISOString() : '', source: 'today' };
  }

  // 截止说明：lead 是醒目的前半句（今天到期、逾期用暖色），rest 是补充。
  function dueLine(deadline, now = Date.now()) {
    const due = Date.parse(String(deadline || ''));
    if (!Number.isFinite(due)) return null;
    const diff = due - now;
    const dayGap = Math.round((startOfDay(due) - startOfDay(now)) / (24 * HOUR));
    if (diff <= 0) {
      const minutes = Math.max(1, Math.floor(-diff / MINUTE));
      const text = minutes < 24 * 60 ? durationText(minutes) : `${Math.floor(minutes / (24 * 60))} 天`;
      return { lead: `已逾期 ${text}`, rest: '', tone: 'overdue' };
    }
    if (dayGap === 0) {
      if (isDateOnly(due)) return { lead: '今天截止', rest: '', tone: 'today' };
      return { lead: `今天 ${clock(due)} 截止`, rest: `还剩 ${durationText(diff / MINUTE)}`, tone: 'today' };
    }
    const date = new Date(due);
    const day = dayGap === 1 ? '明天' : dayGap === 2 ? '后天' : `${date.getMonth() + 1}月${date.getDate()}日`;
    return { lead: isDateOnly(due) ? `${day}截止` : `${day} ${clock(due)} 截止`, rest: '', tone: '' };
  }

  // 换一件事列表右侧的短标签：逾期 / 今天的钟点 / 明天 / M月D日。
  function shortDue(due, now = Date.now()) {
    const time = Number(due);
    if (!Number.isFinite(time)) return '';
    if (time <= now) return '逾期';
    const dayGap = Math.round((startOfDay(time) - startOfDay(now)) / (24 * HOUR));
    if (dayGap === 0) return isDateOnly(time) ? '今天' : clock(time);
    if (dayGap === 1) return '明天';
    const date = new Date(time);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  // 接下来：今天还没结束的日程，和今天稍后的截止（不含正在做的那件）。
  function upcoming({ events = [], todos = [], now = Date.now(), excludeId = '', limit = 2 } = {}) {
    const endOfDay = startOfDay(now) + 24 * HOUR;
    const items = [];
    for (const event of Array.isArray(events) ? events : []) {
      const start = Number(event && event.start);
      const end = start + (Number(event.durationMin) || 30) * MINUTE;
      if (!Number.isFinite(start) || start >= endOfDay || end <= now) continue;
      const ongoing = start <= now;
      items.push({ kind: 'event', id: String(event.id), at: start, time: clock(start), title: String(event.title || ''), note: ongoing ? '进行中' : `日程 · ${untilText(start - now)}` });
    }
    for (const todo of Array.isArray(todos) ? todos : []) {
      const due = Number(todo && todo.due);
      if (!todo || String(todo.id) === String(excludeId) || !(due > now) || due >= endOfDay) continue;
      const dateOnly = isDateOnly(due);
      items.push({ kind: 'due', id: String(todo.id), at: dateOnly ? endOfDay : due, time: dateOnly ? '今天' : clock(due), title: String(todo.text || ''), note: '截止' });
    }
    return items.sort((left, right) => left.at - right.at).slice(0, Math.max(0, limit));
  }

  // ---------------- 精力 ----------------
  function runMinutes(runs) {
    return Math.round((Array.isArray(runs) ? runs : []).reduce((sum, [start, end]) => sum + Math.max(0, end - start), 0) / MINUTE);
  }

  // 今天的时间条：默认 9–21 点，早开始或晚收工时自动延伸；刻度每 3 小时一个，两端都有。
  function dayTrack(runs, now, dayKeyValue) {
    const [year, month, day] = String(dayKeyValue).split('-').map(Number);
    const midnight = new Date(year, month - 1, day).getTime();
    const list = Array.isArray(runs) ? runs : [];
    const hourOf = (time) => (time - midnight) / HOUR;
    const first = list.length ? hourOf(list[0][0]) : 9;
    const last = Math.max(hourOf(now), list.length ? hourOf(list[list.length - 1][1]) : 0);
    const startHour = Math.max(DAY_BOUNDARY_HOUR, Math.min(9, Math.floor(first)));
    let endHour = Math.max(startHour + 12, Math.ceil(last));
    endHour = Math.min(24 + DAY_BOUNDARY_HOUR, startHour + Math.ceil((endHour - startHour) / 3) * 3);
    const from = midnight + startHour * HOUR;
    const span = (endHour - startHour) * HOUR;
    const percent = (time) => Math.max(0, Math.min(100, ((time - from) / span) * 100));
    const segments = list
      .map(([start, end, kind]) => ({ left: percent(start), width: percent(end) - percent(start), kind: kind === 'focus' ? 'focus' : 'active' }))
      .filter((segment) => segment.width > 0.05)
      .map((segment) => ({ ...segment, left: Math.round(segment.left * 100) / 100, width: Math.round(segment.width * 100) / 100 }));
    const ticks = [];
    for (let hour = startHour; hour <= endHour; hour += 3) ticks.push(String(hour % 24));
    return { startHour, endHour, segments, ticks, now: Math.round(percent(now) * 100) / 100 };
  }

  function offworkInfo(offwork, now) {
    if (!offwork || !offwork.enabled || !/^\d{2}:\d{2}$/.test(String(offwork.time || ''))) return null;
    const [hour, minute] = offwork.time.split(':').map(Number);
    const base = new Date(now);
    let at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute).getTime();
    // 凌晨的收工时间属于前一个工作日的晚上。
    if (hour < DAY_BOUNDARY_HOUR && base.getHours() >= DAY_BOUNDARY_HOUR) at += 24 * HOUR;
    const left = at - now;
    return left > 0
      ? { time: offwork.time, text: `${offwork.time} · 还有 ${durationText(Math.ceil(left / MINUTE))}`, passed: false }
      : { time: offwork.time, text: `${offwork.time} · 已到，早点休息`, passed: true };
  }

  function weekBars(days, keys, todayKey) {
    const minutes = keys.map((key) => runMinutes(days && days[key] && days[key].runs));
    const scale = Math.max(WEEK_SCALE_MINUTES, ...minutes);
    return keys.map((key, index) => {
      const [year, month, day] = key.split('-').map(Number);
      const value = minutes[index];
      const kind = key === todayKey ? 'today' : value > LONG_DAY_MINUTES ? 'long' : value < REST_DAY_MINUTES ? 'rest' : 'normal';
      return {
        key,
        label: key === todayKey ? '今天' : WEEKDAY[new Date(year, month - 1, day).getDay()],
        minutes: value,
        height: Math.max(kind === 'rest' ? 4 : 8, Math.round((value / scale) * 100)),
        kind,
        long: value > LONG_DAY_MINUTES,
      };
    });
  }

  // 最近 7 天的「工作日」key（04:00 为界），最后一个是今天。
  function recentDayKeys(todayKey, count = 7) {
    const [year, month, day] = String(todayKey).split('-').map(Number);
    const keys = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(year, month - 1, day - offset);
      keys.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
    }
    return keys;
  }

  function energyView({
    now = Date.now(),
    todayKey,
    days = {},
    enabled = true,
    activeSince = null,
    focus = null,
    focusMinutesToday = 0,
    breakMinutes = DEFAULT_BREAK_MINUTES,
    offwork = null,
  } = {}) {
    if (!enabled) return { enabled: false };
    const runs = (days[todayKey] && days[todayKey].runs) || [];
    const total = runMinutes(runs);
    const focusing = Boolean(focus && focus.running && focus.mode === 'focus');
    const resting = Boolean(focus && focus.running && focus.mode === 'break');
    const threshold = Math.max(10, Number(breakMinutes) || DEFAULT_BREAK_MINUTES);
    let sinceBreak;
    if (focusing) {
      sinceBreak = { text: `这段专注 ${durationText(focus.elapsedMinutes)}`, warn: false, fraction: null };
    } else if (resting || activeSince === null || now - activeSince < MINUTE) {
      sinceBreak = { text: resting ? '正在休息' : '刚休息过', warn: false, fraction: resting ? null : 0 };
    } else {
      const minutes = Math.floor((now - activeSince) / MINUTE);
      const fraction = Math.min(1, minutes / threshold);
      sinceBreak = { text: durationText(minutes), warn: fraction >= 0.8, fraction: Math.round(fraction * 1000) / 1000 };
    }
    const off = offworkInfo(offwork, now);
    const state = focusing ? { text: '专注中', tone: 'focus' }
      : resting ? { text: '休息中', tone: 'ok' }
        : sinceBreak.warn ? { text: '该歇一会儿了', tone: 'warn' }
          : off && off.passed ? { text: '收工时间到了', tone: 'warn' }
            : total > LONG_DAY_MINUTES ? { text: '今天辛苦了', tone: 'warn' }
              : { text: '状态不错', tone: 'ok' };
    const week = weekBars(days, recentDayKeys(todayKey), todayKey);
    return {
      enabled: true,
      total,
      parts: durationParts(total),
      state,
      track: dayTrack(runs, now, todayKey),
      sinceBreak,
      canRest: !focusing && !resting,
      focusText: durationText(focusMinutesToday),
      offwork: off,
      week,
      hasLongDay: week.some((bar) => bar.long),
    };
  }

  return {
    FOCUS_CHOICES,
    DEFAULT_FOCUS_MINUTES,
    LONG_DAY_MINUTES,
    clock,
    countdown,
    durationText,
    durationParts,
    untilText,
    focusMinutes,
    focusMinutesFromLegacy,
    MIN_FOCUS_MINUTES,
    MAX_FOCUS_MINUTES,
    DIAL_MINUTES,
    dialPoint,
    dialArc,
    dialTicks,
    dialMinutesAt,
    dialStep,
    dialResist,
    dialSettle,
    remainingMinutes,
    remainingText,
    focusToday,
    currentTask,
    dueLine,
    shortDue,
    upcoming,
    dayTrack,
    offworkInfo,
    weekBars,
    recentDayKeys,
    energyView,
  };
});
