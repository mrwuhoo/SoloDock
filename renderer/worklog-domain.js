// 工作时间统计：只按时间段记「在用电脑（active）/ 专注（focus）」，不记应用、窗口或任何内容。
// 一天从 04:00 算起（熬夜算前一天）。纯函数，主进程记录与时间页展示共用。
(function exposeWorklogDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchWorklog = api;
})(typeof window !== 'undefined' ? window : globalThis, function createWorklogDomain() {
  const DAY_BOUNDARY_HOUR = 4;
  const MINUTE = 60_000;
  const STREAK_GAP_MS = 5 * MINUTE; // 中间离开不到 5 分钟，仍算同一段连续工作
  const LONG_DAY_MINUTES = 10 * 60;
  const FULL_CUP_MINUTES = 12 * 60;

  const pad = (value) => String(value).padStart(2, '0');

  // 某个时刻属于哪一个「工作日」（04:00 为界）。
  function dayKey(time, boundaryHour = DAY_BOUNDARY_HOUR) {
    const date = new Date(Number(time) - boundaryHour * 3600_000);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dayStart(key, boundaryHour = DAY_BOUNDARY_HOUR) {
    const [year, month, day] = String(key).split('-').map(Number);
    return new Date(year, month - 1, day, boundaryHour).getTime();
  }

  // runs: [[start, end, kind]]，按开始时间排序；同类相邻合并，专注覆盖普通活跃。
  function addInterval(runs, start, end, kind = 'active') {
    const from = Math.round(Number(start));
    const to = Math.round(Number(end));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return (runs || []).slice();
    const pieces = [];
    for (const [s, e, k] of runs || []) {
      if (e <= from || s >= to) { pieces.push([s, e, k]); continue; }
      if (k === 'focus' && kind === 'active') {
        // 已是专注的部分保持专注；新的活跃只填空隙。
        pieces.push([s, e, k]);
        continue;
      }
      if (s < from) pieces.push([s, from, k]);
      if (e > to) pieces.push([to, e, k]);
    }
    const gaps = kind === 'active'
      ? subtract([[from, to]], (runs || []).filter(([s, e, k]) => k === 'focus' && e > from && s < to))
      : [[from, to]];
    gaps.forEach(([s, e]) => pieces.push([s, e, kind]));
    pieces.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const merged = [];
    for (const piece of pieces) {
      const last = merged[merged.length - 1];
      if (last && last[2] === piece[2] && piece[0] <= last[1]) last[1] = Math.max(last[1], piece[1]);
      else merged.push([...piece]);
    }
    return merged;
  }

  function subtract(ranges, holes) {
    let result = ranges.map(([s, e]) => [s, e]);
    for (const [hs, he] of holes) {
      result = result.flatMap(([s, e]) => {
        if (he <= s || hs >= e) return [[s, e]];
        const out = [];
        if (hs > s) out.push([s, hs]);
        if (he < e) out.push([he, e]);
        return out;
      });
    }
    return result;
  }

  function summarizeDay(day) {
    const runs = Array.isArray(day && day.runs) ? day.runs : [];
    let active = 0;
    let focus = 0;
    let longest = 0;
    let streakStart = null;
    let streakEnd = null;
    for (const [start, end, kind] of runs) {
      const length = end - start;
      active += length;
      if (kind === 'focus') focus += length;
      if (streakEnd !== null && start - streakEnd < STREAK_GAP_MS) {
        streakEnd = Math.max(streakEnd, end);
      } else {
        if (streakStart !== null) longest = Math.max(longest, streakEnd - streakStart);
        streakStart = start;
        streakEnd = end;
      }
    }
    if (streakStart !== null) longest = Math.max(longest, streakEnd - streakStart);
    return {
      activeMinutes: Math.round(active / MINUTE),
      focusMinutes: Math.round(focus / MINUTE),
      longestMinutes: Math.round(longest / MINUTE),
      firstActive: runs.length ? runs[0][0] : null,
      lastActive: runs.length ? runs[runs.length - 1][1] : null,
      aiTasks: Math.max(0, Number(day && day.ai) || 0),
      todosDone: Math.max(0, Number(day && day.todos) || 0),
    };
  }

  // 月汇总：只陈述事实，不打分。days 是 { [dayKey]: day }。
  function summarizeMonth(days, year, month) {
    const prefix = `${year}-${pad(month)}-`;
    const entries = Object.entries(days || {}).filter(([key]) => key.startsWith(prefix)).map(([key, day]) => [key, summarizeDay(day)]);
    const worked = entries.filter(([, summary]) => summary.activeMinutes > 0);
    const active = worked.reduce((sum, [, summary]) => sum + summary.activeMinutes, 0);
    const focus = worked.reduce((sum, [, summary]) => sum + summary.focusMinutes, 0);
    return {
      activeMinutes: active,
      averageMinutes: worked.length ? Math.round(active / worked.length) : 0,
      focusRatio: active ? focus / active : 0,
      todosDone: entries.reduce((sum, [, summary]) => sum + summary.todosDone, 0),
      longDays: worked.filter(([, summary]) => summary.activeMinutes > LONG_DAY_MINUTES).length,
      workedDays: worked.length,
    };
  }

  // 月历网格：周一开头，前后用空格补齐。
  function monthGrid(year, month) {
    const first = new Date(year, month - 1, 1);
    const leading = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = [];
    for (let index = 0; index < leading; index += 1) cells.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(`${year}-${pad(month)}-${pad(day)}`);
    while (cells.length % 7) cells.push(null);
    return cells;
  }

  function formatMinutes(minutes) {
    const safe = Math.max(0, Math.round(minutes));
    const hours = Math.floor(safe / 60);
    const rest = safe % 60;
    if (!hours) return `${rest} 分钟`;
    return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
  }

  function cupLevel(minutes) {
    return Math.max(0, Math.min(1, minutes / FULL_CUP_MINUTES));
  }

  return {
    DAY_BOUNDARY_HOUR,
    LONG_DAY_MINUTES,
    FULL_CUP_MINUTES,
    dayKey,
    dayStart,
    addInterval,
    summarizeDay,
    summarizeMonth,
    monthGrid,
    formatMinutes,
    cupLevel,
  };
});
