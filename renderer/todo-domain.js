// 待办：分类（可增减，最多 6 个）、重复、可读的剩余时间、筛选与添加行的日期识别。纯函数，页面与 Node 测试共用。
// 存储兼容：`notch-todo-data` 仍是「分类 id → 待办数组」，原来的四类沿用 P0–P3 作为 id，
// 新增的分类只是多出新的键，旧版本读到的前四类不受影响。
(function exposeTodoDomain(root, factory) {
  const capture = root && root.NotchCapture ? root.NotchCapture : (typeof require === 'function' ? require('./capture-domain') : null);
  const api = factory(capture);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchTodo = api;
})(typeof window !== 'undefined' ? window : globalThis, function createTodoDomain(Capture) {
  const COLORS = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6'];
  const MAX_CATEGORIES = 6;
  const DEFAULT_CATEGORIES = [
    { id: 'P0', name: '课程', color: 'cat-1' },
    { id: 'P1', name: '自媒体&写作', color: 'cat-2' },
    { id: 'P2', name: 'Vibe coding', color: 'cat-3' },
    { id: 'P3', name: '日常', color: 'cat-4' },
  ];
  // 旧待办没有提醒设置，沿用原来的「到期前 1 小时」；新建的默认提前 15 分钟。
  const LEGACY_REMIND_MIN = 60;
  const DEFAULT_REMIND_MIN = 15;
  const REMIND_OPTIONS = [-1, 0, 5, 15, 30, 60, 1440];
  const REPEAT_KINDS = ['daily', 'weekdays', 'weekly', 'monthly', 'custom'];
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const MINUTE = 60000;
  const HOUR = 60 * MINUTE;

  const pad = (value) => String(value).padStart(2, '0');
  const clean = (value, limit) => Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
  const clock = (time) => { const date = new Date(time); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };
  const int = (value, min, max) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };

  function dayOffset(time, now = Date.now()) {
    const target = new Date(Number(time));
    const base = new Date(Number(now));
    const a = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const b = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
    return Math.round((a - b) / 86400000);
  }

  // ---------------- 分类 ----------------
  function normalizeCategories(value, legacyNames = {}) {
    const list = Array.isArray(value) ? value : [];
    const seen = new Set();
    const out = [];
    list.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const id = String(item.id || '').trim();
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || seen.has(id)) return;
      seen.add(id);
      out.push({
        id,
        name: clean(item.name, 24) || '未命名',
        color: COLORS.includes(item.color) ? item.color : COLORS[index % COLORS.length],
      });
    });
    if (out.length) return out.slice(0, MAX_CATEGORIES);
    // 第一次升级：原来的四类按旧名字、原顺序、原颜色迁过来。
    return DEFAULT_CATEGORIES.map((category) => ({
      ...category,
      name: clean(legacyNames && legacyNames[category.id], 24) || category.name,
    }));
  }

  function nextColor(categories) {
    const used = new Set(categories.map((category) => category.color));
    return COLORS.find((color) => !used.has(color)) || COLORS[categories.length % COLORS.length];
  }

  function gridShape(count) {
    if (count <= 3) return { columns: Math.max(1, count), rows: 1 };
    if (count === 4) return { columns: 2, rows: 2 };
    return { columns: 3, rows: 2 };
  }

  // ---------------- 待办 ----------------
  function normalizeRepeat(value) {
    if (!value || typeof value !== 'object' || !REPEAT_KINDS.includes(value.kind)) return null;
    if (value.kind === 'custom') {
      const unit = ['day', 'week', 'month'].includes(value.unit) ? value.unit : 'day';
      return { kind: 'custom', every: int(value.every, 1, 99) || 1, unit, ...(unit === 'month' && int(value.day, 1, 31) ? { day: int(value.day, 1, 31) } : {}) };
    }
    if (value.kind === 'monthly') return int(value.day, 1, 31) ? { kind: 'monthly', day: int(value.day, 1, 31) } : { kind: 'monthly' };
    return { kind: value.kind };
  }

  function normalizeItem(value, fallbackId) {
    if (typeof value === 'string') value = { text: value };
    if (!value || typeof value !== 'object') return null;
    const text = clean(value.text, 200);
    if (!text) return null;
    const deadline = Date.parse(String(value.deadline || ''));
    const item = {
      id: typeof value.id === 'string' && value.id ? value.id.slice(0, 80) : fallbackId,
      text,
      done: value.done === true,
      createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
      deadline: Number.isFinite(deadline) ? new Date(deadline).toISOString() : '',
      remindedAt: Math.max(0, Number(value.remindedAt) || 0),
    };
    if (item.done && Number(value.completedAt) > 0) item.completedAt = Number(value.completedAt);
    const repeat = normalizeRepeat(value.repeat);
    if (repeat) item.repeat = repeat;
    if (REMIND_OPTIONS.includes(value.remindMin)) item.remindMin = value.remindMin;
    return item;
  }

  // 「分类 id → 待办数组」。已删除分类留下的待办并入第一个分类，永远不丢。
  function normalizeData(raw, categories) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const data = Object.fromEntries(categories.map((category) => [category.id, []]));
    let counter = 0;
    const take = (list, target) => {
      (Array.isArray(list) ? list : []).forEach((value) => {
        counter += 1;
        const item = normalizeItem(value, `todo-${Date.now().toString(36)}-${counter}`);
        if (item) data[target].push(item);
      });
    };
    categories.forEach((category) => take(source[category.id], category.id));
    Object.keys(source).filter((key) => !data[key]).forEach((key) => take(source[key], categories[0].id));
    return data;
  }

  function remindLead(item) {
    return item && REMIND_OPTIONS.includes(item.remindMin) ? item.remindMin : LEGACY_REMIND_MIN;
  }

  function sortPending(items) {
    return [...items].sort((left, right) => {
      const a = Date.parse(left.deadline) || Infinity;
      const b = Date.parse(right.deadline) || Infinity;
      return a - b || (left.createdAt - right.createdAt) || String(left.id).localeCompare(String(right.id));
    });
  }

  function sortDone(items) {
    return [...items].sort((left, right) => (right.completedAt || right.createdAt) - (left.completedAt || left.createdAt));
  }

  // ---------------- 时间标签 ----------------
  // 逾期红色「逾期 2 小时」；今天「今天 20:00 · 还剩 5 小时」（1 小时内琥珀色）；明天「明天 23:30」；更远「9/26 周六」。
  function dueLabel(deadline, now = Date.now()) {
    const due = Date.parse(String(deadline || ''));
    if (!Number.isFinite(due)) return { text: '', tone: '' };
    const diff = due - Number(now);
    if (diff <= 0) {
      const minutes = Math.max(1, Math.floor(-diff / MINUTE));
      if (minutes < 60) return { text: `逾期 ${minutes} 分钟`, tone: 'overdue' };
      const hours = Math.floor(minutes / 60);
      return { text: hours < 24 ? `逾期 ${hours} 小时` : `逾期 ${Math.floor(hours / 24)} 天`, tone: 'overdue' };
    }
    const offset = dayOffset(due, now);
    const soon = diff <= HOUR;
    const left = soon ? `还剩 ${Math.max(1, Math.ceil(diff / MINUTE))} 分钟` : `还剩 ${Math.floor(diff / HOUR)} 小时`;
    if (offset === 0) return { text: `今天 ${clock(due)} · ${left}`, tone: soon ? 'soon' : '' };
    if (offset === 1) return { text: soon ? `明天 ${clock(due)} · ${left}` : `明天 ${clock(due)}`, tone: soon ? 'soon' : '' };
    const date = new Date(due);
    const sameYear = date.getFullYear() === new Date(Number(now)).getFullYear();
    return { text: sameYear ? `${date.getMonth() + 1}/${date.getDate()} ${WEEK[date.getDay()]}` : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`, tone: '' };
  }

  // 添加行日期按钮与解析标签上的短写法：「今天 23:30」「明天 15:00」「9/26 周六 15:00」。
  function shortDate(time, now = Date.now()) {
    const offset = dayOffset(time, now);
    const date = new Date(Number(time));
    const day = offset === 0 ? '今天' : offset === 1 ? '明天' : offset === 2 ? '后天' : `${date.getMonth() + 1}/${date.getDate()} ${WEEK[date.getDay()]}`;
    return `${day} ${clock(time)}`;
  }

  function fullDate(deadline) {
    const date = new Date(Date.parse(String(deadline || '')));
    if (!Number.isFinite(date.getTime())) return '';
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEK[date.getDay()]} ${clock(date)}`;
  }

  function repeatLabel(repeat, deadline) {
    const rule = normalizeRepeat(repeat);
    if (!rule) return '不重复';
    const date = new Date(Date.parse(String(deadline || '')) || Date.now());
    if (rule.kind === 'daily') return '每天';
    if (rule.kind === 'weekdays') return '工作日';
    if (rule.kind === 'weekly') return `每${WEEK[date.getDay()]}`;
    if (rule.kind === 'monthly') return `每月 ${rule.day || date.getDate()} 日`;
    return `每 ${rule.every} ${{ day: '天', week: '周', month: '个月' }[rule.unit]}`;
  }

  function remindLabel(minutes) {
    if (minutes === -1) return '不提醒';
    if (minutes === 0) return '准时提醒';
    if (minutes === 1440) return '提前 1 天';
    if (minutes === 60) return '提前 1 小时';
    return `提前 ${minutes} 分钟`;
  }

  function describe(item) {
    return [fullDate(item.deadline), item.repeat ? repeatLabel(item.repeat, item.deadline) : '', remindLabel(remindLead(item))].filter(Boolean).join(' · ');
  }

  // ---------------- 重复 ----------------
  function addMonths(date, months, anchorDay) {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1, date.getHours(), date.getMinutes());
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(anchorDay, last));
    return target;
  }

  // 完成一条重复待办后，下一次的截止时间：保留钟点，月底按当月最后一天（31 号 → 2 月 28/29 日 → 3 月 31 日）。
  // 已经错过的次数直接跳过，下一次一定在 now 之后。
  function nextOccurrence(deadline, repeat, now = Date.now()) {
    const rule = normalizeRepeat(repeat);
    const start = new Date(Date.parse(String(deadline || '')));
    if (!rule || !Number.isFinite(start.getTime())) return '';
    const anchor = rule.day || start.getDate();
    let date = new Date(start.getTime());
    let count = 0;
    const step = () => {
      count += 1;
      if (rule.kind === 'daily') date.setDate(date.getDate() + 1);
      else if (rule.kind === 'weekdays') {
        do { date.setDate(date.getDate() + 1); } while (date.getDay() === 0 || date.getDay() === 6);
      } else if (rule.kind === 'weekly') date.setDate(date.getDate() + 7);
      else if (rule.kind === 'monthly') date = addMonths(start, count, anchor);
      else if (rule.unit === 'day') date.setDate(date.getDate() + rule.every);
      else if (rule.unit === 'week') date.setDate(date.getDate() + 7 * rule.every);
      else date = addMonths(start, count * rule.every, anchor);
    };
    step();
    while (date.getTime() <= Number(now) && count < 5000) step();
    return date.toISOString();
  }

  // ---------------- 筛选 ----------------
  function matches(item, filter, now = Date.now()) {
    if (filter === 'done') return item.done;
    if (item.done) return false;
    if (filter === 'today') return Boolean(item.deadline) && dayOffset(Date.parse(item.deadline), now) === 0;
    if (filter === 'overdue') return Boolean(item.deadline) && Date.parse(item.deadline) <= Number(now);
    return true;
  }

  function matchesSearch(item, query) {
    const tokens = String(query || '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const text = item.text.toLocaleLowerCase();
    return tokens.every((token) => text.includes(token));
  }

  function counts(data, now = Date.now()) {
    const all = Object.values(data || {}).flat();
    return {
      all: all.filter((item) => !item.done).length,
      today: all.filter((item) => matches(item, 'today', now)).length,
      overdue: all.filter((item) => matches(item, 'overdue', now)).length,
      done: all.filter((item) => item.done).length,
    };
  }

  // ---------------- 添加行 ----------------
  function defaultDeadline(now = Date.now()) {
    const base = new Date(Number(now));
    let at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 30).getTime();
    if (at <= Number(now)) at = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 23, 30).getTime();
    return at;
  }

  // 输入「明天下午3点 给会计打电话」→ 文字「给会计打电话」+ 截止 明天 15:00。认不出日期就原样返回、不显示标签。
  function parseAddInput(text, now = Date.now()) {
    const raw = clean(text, 200);
    if (!raw || !Capture) return { text: raw, at: null };
    const when = Capture.parseWhen(raw, now);
    if (!when.at || when.at <= Number(now) || !when.rest) return { text: raw, at: null };
    return { text: clean(when.rest, 200), at: when.at, label: shortDate(when.at, now) };
  }

  // 截止时间选择器上方的快捷日期：今天、明天、周五（周四起换成周末）、下周一；钟点沿用当前选择。
  function quickDates(now = Date.now()) {
    const base = new Date(Number(now));
    const day = (offset) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    const weekday = base.getDay();
    const out = [{ label: '今天', date: day(0) }, { label: '明天', date: day(1) }];
    if (weekday >= 1 && weekday <= 3) out.push({ label: '周五', date: day(5 - weekday) });
    else if (weekday === 4) out.push({ label: '周末', date: day(2) });
    out.push({ label: '下周一', date: day(((8 - weekday) % 7) || 7) });
    return out;
  }

  // 月历：周一开头，前后补齐到整周。
  function monthGrid(year, month) {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const days = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let index = lead; index > 0; index -= 1) cells.push({ date: new Date(year, month, 1 - index), outside: true });
    for (let date = 1; date <= days; date += 1) cells.push({ date: new Date(year, month, date), outside: false });
    while (cells.length % 7) cells.push({ date: new Date(year, month + 1, cells.length - lead - days + 1), outside: true });
    return cells;
  }

  // 录音转写里「提取待办」：只列出带时间或带动作的句子作为候选，由用户勾选后写入；不总结、不改写。
  const ACTION_WORDS = /(发给|发一版|发过去|提交|交付|交稿|回复|回电话|打电话|联系|约|安排|准备|整理|确认|改到|修改|更新|完成|跟进|对接|报价|付款|开票|寄|预约|记得|别忘)/;
  function extractTodoCandidates(text, now = Date.now()) {
    const sentences = String(text || '')
      .split(/[。！？!?；;\n]+/)
      .map((sentence) => sentence.replace(/^[^：:]{1,8}[：:]\s*/, '').trim())
      .filter((sentence) => Array.from(sentence).length >= 4 && Array.from(sentence).length <= 80);
    const seen = new Set();
    return sentences.map((sentence) => {
      const when = Capture ? Capture.parseWhen(sentence, now) : { at: null };
      const timed = Boolean(when.at && when.at > Number(now) && !when.vague);
      if (!timed && !ACTION_WORDS.test(sentence)) return null;
      if (seen.has(sentence)) return null;
      seen.add(sentence);
      return { text: sentence, at: timed ? when.at : null, label: timed ? shortDate(when.at, now) : '' };
    }).filter(Boolean).slice(0, 12);
  }

  return {
    extractTodoCandidates,
    COLORS,
    MAX_CATEGORIES,
    DEFAULT_CATEGORIES,
    LEGACY_REMIND_MIN,
    DEFAULT_REMIND_MIN,
    REMIND_OPTIONS,
    WEEK,
    dayOffset,
    normalizeCategories,
    nextColor,
    gridShape,
    normalizeRepeat,
    normalizeItem,
    normalizeData,
    remindLead,
    sortPending,
    sortDone,
    dueLabel,
    shortDate,
    fullDate,
    repeatLabel,
    remindLabel,
    describe,
    nextOccurrence,
    matches,
    matchesSearch,
    counts,
    defaultDeadline,
    parseAddInput,
    quickDates,
    monthGrid,
  };
});
