// 生活习惯：运动、冥想、阅读等，只记次数、看见坚持。和工作数据完全分开（LocalStorage notch-life-v1）。
// 一天从 04:00 算起；目标按「每周几次」计，连续是「连续达标的周数」。纯函数，页面与 Node 测试共用。
(function exposeLifeDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchLife = api;
})(typeof window !== 'undefined' ? window : globalThis, function createLifeDomain() {
  const DAY_BOUNDARY_HOUR = 4;
  const MAX_HABITS = 6;
  const MAX_RECORDS = 3000;
  const COLORS = ['cat-3', 'cat-5', 'cat-6', 'cat-4', 'cat-1', 'cat-2'];
  const ICONS = ['run', 'lotus', 'book', 'moon', 'drop', 'leaf'];
  const DEFAULT_HABITS = [
    { id: 'exercise', name: '运动', color: 'cat-3', icon: 'run', goal: 3, items: ['跑步', '健身', '骑行', '散步', '瑜伽'] },
    { id: 'meditate', name: '冥想', color: 'cat-5', icon: 'lotus', goal: 5, items: ['呼吸', '正念', '睡前冥想'] },
    { id: 'read', name: '阅读', color: 'cat-6', icon: 'book', goal: 4, items: ['纸书', '电子书', '长文章'] },
  ];

  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const pad = (value) => String(value).padStart(2, '0');
  const clean = (value, limit) => Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim()).slice(0, limit).join('');

  function dayKey(time) {
    const date = new Date(Number(time) - DAY_BOUNDARY_HOUR * 3600_000);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function dayStart(key) {
    const [year, month, day] = String(key).split('-').map(Number);
    return new Date(year, month - 1, day, DAY_BOUNDARY_HOUR).getTime();
  }

  // 本周一到周日的七个日期。
  function weekDays(now = Date.now(), offsetWeeks = 0) {
    const start = dayStart(dayKey(now));
    const weekday = (new Date(start).getDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, index) => dayKey(start + (index - weekday + offsetWeeks * 7) * 86400000 + 3600_000));
  }

  function normalizeHabit(value, index) {
    if (!value || typeof value !== 'object') return null;
    const id = clean(value.id, 40);
    const name = clean(value.name, 12);
    if (!id || !name) return null;
    return {
      id,
      name,
      color: COLORS.includes(value.color) ? value.color : COLORS[index % COLORS.length],
      icon: ICONS.includes(value.icon) ? value.icon : ICONS[index % ICONS.length],
      goal: Math.max(1, Math.min(7, Math.round(Number(value.goal) || 3))),
      items: (Array.isArray(value.items) ? value.items : []).map((item) => clean(item, 10)).filter(Boolean).slice(0, 8),
      remindAt: TIME.test(value.remindAt) ? value.remindAt : '',
    };
  }

  function normalizeRecord(value, habitIds) {
    if (!value || typeof value !== 'object') return null;
    const id = clean(value.id, 60);
    const habitId = clean(value.habitId, 40);
    const at = Number(value.at);
    if (!id || !habitIds.has(habitId) || !Number.isFinite(at) || at <= 0) return null;
    const minutes = Math.round(Number(value.minutes));
    return {
      id,
      habitId,
      at,
      item: clean(value.item, 10),
      minutes: minutes > 0 && minutes <= 600 ? minutes : 0,
      note: clean(value.note, 60),
    };
  }

  function normalizeLife(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const seen = new Set();
    const habits = (Array.isArray(source.habits) && source.habits.length ? source.habits : DEFAULT_HABITS)
      .map(normalizeHabit)
      .filter((habit) => habit && !seen.has(habit.id) && seen.add(habit.id))
      .slice(0, MAX_HABITS);
    const habitIds = new Set(habits.map((habit) => habit.id));
    const records = (Array.isArray(source.records) ? source.records : [])
      .map((record) => normalizeRecord(record, habitIds))
      .filter(Boolean)
      .sort((left, right) => right.at - left.at)
      .slice(0, MAX_RECORDS);
    return { habits, records, remindWorkdays: source.remindWorkdays === true };
  }

  function recordsFor(state, habitId) {
    return state.records.filter((record) => record.habitId === habitId);
  }

  function habitWeek(state, habitId, now = Date.now(), offsetWeeks = 0) {
    const days = weekDays(now, offsetWeeks);
    const inWeek = recordsFor(state, habitId).filter((record) => days.includes(dayKey(record.at)));
    const habit = state.habits.find((item) => item.id === habitId);
    const goal = habit ? habit.goal : 3;
    return { days, count: inWeek.length, doneDays: [...new Set(inWeek.map((record) => dayKey(record.at)))], goal, reached: inWeek.length >= goal };
  }

  // 连续达标的周数：本周已达标就算上本周；本周还没达标，从上周往回数（不因为周一还没做而清零）。
  function streakWeeks(state, habitId, now = Date.now()) {
    let streak = habitWeek(state, habitId, now, 0).reached ? 1 : 0;
    for (let offset = -1; offset > -104; offset -= 1) {
      if (!habitWeek(state, habitId, now, offset).reached) break;
      streak += 1;
    }
    return streak;
  }

  function monthDots(state, year, month) {
    const prefix = `${year}-${pad(month)}-`;
    const dots = {};
    for (const record of state.records) {
      const key = dayKey(record.at);
      if (!key.startsWith(prefix)) continue;
      dots[key] = dots[key] || [];
      if (!dots[key].includes(record.habitId)) dots[key].push(record.habitId);
    }
    const order = state.habits.map((habit) => habit.id);
    Object.values(dots).forEach((ids) => ids.sort((left, right) => order.indexOf(left) - order.indexOf(right)));
    return dots;
  }

  function addRecord(state, record) {
    return normalizeLife({ ...state, records: [{ ...record }, ...state.records] });
  }

  function removeRecord(state, id) {
    return normalizeLife({ ...state, records: state.records.filter((record) => record.id !== id) });
  }

  function updateRecord(state, id, patch) {
    return normalizeLife({ ...state, records: state.records.map((record) => (record.id === id ? { ...record, ...patch, id } : record)) });
  }

  // 「跑步 5km 32分钟」→ 运动 · 跑步 · 32 分钟 · 备注 5km。认不出习惯时返回 null。
  function parseLifeInput(text, state) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    let habit = null;
    let item = '';
    for (const candidate of state.habits) {
      const hit = candidate.items.find((entry) => raw.includes(entry));
      if (hit) { habit = candidate; item = hit; break; }
      if (raw.includes(candidate.name)) { habit = candidate; break; }
    }
    if (!habit) return null;
    const duration = raw.match(/(\d{1,3})\s*(分钟|min|m)(?![a-z])|(\d(?:\.\d)?)\s*(小时|h)(?![a-z])/i);
    const minutes = duration ? (duration[1] ? Number(duration[1]) : Math.round(Number(duration[3]) * 60)) : 0;
    const note = clean(raw.replace(item, ' ').replace(habit.name, ' ').replace(duration ? duration[0] : '', ' '), 60);
    return { habitId: habit.id, item, minutes, note };
  }

  function addHabit(state, name) {
    if (state.habits.length >= MAX_HABITS) return state;
    const used = new Set(state.habits.map((habit) => habit.color));
    const color = COLORS.find((item) => !used.has(item)) || COLORS[state.habits.length % COLORS.length];
    const index = state.habits.length;
    const id = `habit-${Date.now().toString(36)}-${index}`;
    return normalizeLife({ ...state, habits: [...state.habits, { id, name, color, icon: ICONS[index % ICONS.length], goal: 3, items: [] }] });
  }

  function removeHabit(state, id) {
    return normalizeLife({ ...state, habits: state.habits.filter((habit) => habit.id !== id) });
  }

  function updateHabit(state, id, patch) {
    return normalizeLife({ ...state, habits: state.habits.map((habit) => (habit.id === id ? { ...habit, ...patch, id } : habit)) });
  }

  // 从 04:00 起算的分钟数：00:30 算在 22:30 之后（还是同一个「一天」）。
  const minutesFromDayStart = (time) => {
    const [hour, minute] = String(time).split(':').map(Number);
    return (hour * 60 + minute - DAY_BOUNDARY_HOUR * 60 + 1440) % 1440;
  };

  // 习惯提醒：接下来几天里每个设了提醒时间的习惯，到点走统一提醒浮窗。
  // 默认只在收工后与周末提醒：工作日的提醒时间早于收工时间就跳过（可在习惯设置里改为工作日也提醒）。
  // 今天已经记过、或本周已达标的，不再提醒。
  function habitReminderQueue(state, { now = Date.now(), offwork = '22:30', days = 7 } = {}) {
    const offworkMinutes = minutesFromDayStart(TIME.test(offwork) ? offwork : '22:30');
    const today = dayKey(now);
    const queue = [];
    for (const habit of state.habits) {
      if (!habit.remindAt) continue;
      const remindMinutes = minutesFromDayStart(habit.remindAt);
      for (let offset = 0; offset < days; offset += 1) {
        const key = dayKey(dayStart(today) + offset * 86400000 + 3600_000);
        const at = dayStart(key) + remindMinutes * 60_000;
        if (at <= now) continue;
        const weekday = new Date(dayStart(key)).getDay();
        const weekend = weekday === 0 || weekday === 6;
        if (!weekend && !state.remindWorkdays && remindMinutes < offworkMinutes) continue;
        const week = habitWeek(state, habit.id, dayStart(key) + 3600_000);
        if (week.reached) continue;
        if (week.doneDays.includes(key)) continue;
        queue.push({
          id: `habit-${habit.id}-${key}`,
          kind: 'habit',
          habitId: habit.id,
          at,
          title: `今天${habit.name}了吗？`,
          detail: `本周 ${week.count} / ${habit.goal} 次`,
        });
      }
    }
    return queue.sort((left, right) => left.at - right.at);
  }

  // 导出 CSV：UTF-8 带 BOM（Excel 直接打开不乱码）；以 = + - @ 开头的格子前加 '，防止被当成公式执行。
  function recordsCsv(state) {
    const cell = (value) => {
      let text = String(value == null ? '' : value);
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const names = new Map(state.habits.map((habit) => [habit.id, habit.name]));
    const rows = [['日期', '时间', '习惯', '项目', '时长（分钟）', '备注']];
    for (const record of [...state.records].sort((left, right) => left.at - right.at)) {
      const date = new Date(record.at);
      rows.push([dayKey(record.at), `${pad(date.getHours())}:${pad(date.getMinutes())}`, names.get(record.habitId) || '', record.item, record.minutes || '', record.note]);
    }
    return `\ufeff${rows.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
  }

  return {
    DAY_BOUNDARY_HOUR,
    habitReminderQueue,
    recordsCsv,
    MAX_HABITS,
    DEFAULT_HABITS,
    dayKey,
    dayStart,
    weekDays,
    normalizeLife,
    habitWeek,
    streakWeeks,
    monthDots,
    addRecord,
    removeRecord,
    updateRecord,
    parseLifeInput,
    addHabit,
    removeHabit,
    updateHabit,
  };
});
