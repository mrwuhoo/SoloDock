// 待办页：分类卡（4 类 2×2，5–6 类 3×2）、筛选、搜索、管理分类、截止时间选择器、在做、重复。
// 数据归这里：`notch-todo-data`（分类 id → 待办数组）、`notch-todo-categories-v1`、`notch-todo-doing-v1`。
// 第一次升级时把旧数据原样备份到 `notch-todo-data-v1-backup`，P0–P3 的名字同时写回旧键，方便回滚。
(function bootstrapTodoPage() {
  'use strict';

  const T = window.NotchTodo;
  const $ = (id) => document.getElementById(id);
  const page = $('task-page');
  const grid = $('task-grid');
  if (!T || !page || !grid) return;

  const DATA_KEY = 'notch-todo-data';
  const CATEGORY_KEY = 'notch-todo-categories-v1';
  const LEGACY_NAMES_KEY = 'notch-todo-category-names-v1';
  const BACKUP_KEY = 'notch-todo-data-v1-backup';
  const DOING_KEY = 'notch-todo-doing-v1';
  const COMPLETE_DELAY_MS = 300;
  const api = () => window.notchAPI || {};
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    filters: $('task-filters'),
    search: $('task-search'),
    manage: $('task-manage'),
    picker: $('task-picker'),
    pickerQuick: $('task-picker-quick'),
    pickerMonth: $('task-picker-month'),
    pickerGrid: $('task-picker-grid'),
    pickerHour: $('task-picker-hour'),
    pickerMinute: $('task-picker-minute'),
    pickerRepeat: $('task-picker-repeat'),
    pickerCustom: $('task-picker-custom'),
    pickerEvery: $('task-picker-every'),
    pickerUnit: $('task-picker-unit'),
    pickerRemind: $('task-picker-remind'),
    pickerError: $('task-picker-error'),
    manager: $('task-manager'),
    managerList: $('task-manager-list'),
    managerCount: $('task-manager-count'),
    managerAdd: $('task-manager-add'),
    managerName: $('task-manager-name'),
    menu: $('task-menu'),
    menuSwatches: $('task-menu-swatches'),
  };

  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.6 3.6 7.4-8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5.5" width="15" height="14" rx="3"/><path d="M4.5 10h15M9 3.5v4M15 3.5v4"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17.5" cy="12" r="1.3"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11a6.5 6.5 0 0 1 11.4-4.3L18.5 9"/><path d="M18.5 4.5V9H14"/><path d="M19 13a6.5 6.5 0 0 1-11.4 4.3L5.5 15"/><path d="M5.5 19.5V15H10"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.5v11l9-5.5Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 7.5h13M10 7.5V5.5h4v2M7.5 7.5l.8 11h7.4l.8-11"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 7.5 9 9M16.5 7.5l-9 9"/></svg>',
  };

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) {}
  }
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const toast = (message, options) => (typeof window.showStatusToast === 'function' ? window.showStatusToast(message, options) : null);

  // ---------------- 数据 ----------------
  function load() {
    const stored = readJson(CATEGORY_KEY, null);
    const loadedCategories = T.normalizeCategories(stored, readJson(LEGACY_NAMES_KEY, {}));
    if (!Array.isArray(stored)) {
      try {
        const raw = localStorage.getItem(DATA_KEY);
        if (raw !== null && localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, raw);
      } catch (error) {}
      write(CATEGORY_KEY, loadedCategories);
    }
    return { categories: loadedCategories, data: T.normalizeData(readJson(DATA_KEY, {}), loadedCategories) };
  }

  let { categories, data } = load();
  let doing = readJson(DOING_KEY, null);

  const allEntries = () => categories.flatMap((category) => (data[category.id] || []).map((item) => ({ item, categoryId: category.id })));
  const categoryOf = (id) => categories.find((category) => category.id === id) || null;
  function find(id) {
    for (const category of categories) {
      const list = data[category.id] || [];
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) return { item: list[index], list, index, categoryId: category.id };
    }
    return null;
  }

  function scheduleReminders() {
    const items = allEntries().map(({ item }) => ({ ...item, remindMin: T.remindLead(item) }));
    api().scheduleTodoReminders?.(items)?.catch?.(() => {});
  }

  function persist(options = {}) {
    const doingEntry = doing && find(doing.id);
    if (!doingEntry || doingEntry.item.done) doing = null;
    write(DATA_KEY, data);
    write(CATEGORY_KEY, categories);
    write(LEGACY_NAMES_KEY, Object.fromEntries(categories.filter((category) => /^P[0-3]$/.test(category.id)).map((category) => [category.id, category.name])));
    if (doing) write(DOING_KEY, doing);
    else try { localStorage.removeItem(DOING_KEY); } catch (error) {}
    scheduleReminders();
    document.dispatchEvent(new CustomEvent('notch:todos-changed'));
    if (options.render !== false) render();
  }

  function addItem(categoryId, text, deadline, extra = {}) {
    const category = categoryOf(categoryId) || categories[0];
    const at = Date.parse(String(deadline || '')) || Number(deadline) || T.defaultDeadline();
    const item = T.normalizeItem({
      id: uid('todo'),
      text,
      createdAt: Date.now(),
      deadline: new Date(at).toISOString(),
      repeat: extra.repeat,
      remindMin: T.REMIND_OPTIONS.includes(extra.remindMin) ? extra.remindMin : T.DEFAULT_REMIND_MIN,
    });
    if (!item) return '';
    data[category.id].push(item);
    enteringId = item.id;
    persist();
    return item.id;
  }

  // 完成：原条目进入已完成；重复待办同时生成下一次。返回撤销用的信息。
  function completeItem(id) {
    const entry = find(id);
    if (!entry || entry.item.done) return null;
    entry.item.done = true;
    entry.item.completedAt = Date.now();
    let spawnedId = '';
    if (entry.item.repeat && entry.item.deadline) {
      const next = T.nextOccurrence(entry.item.deadline, entry.item.repeat, Date.now());
      if (next) {
        const copy = T.normalizeItem({ id: uid('todo'), text: entry.item.text, createdAt: Date.now(), deadline: next, repeat: entry.item.repeat, remindMin: entry.item.remindMin });
        if (copy) {
          entry.list.push(copy);
          spawnedId = copy.id;
        }
      }
    }
    if (doing && doing.id === id) doing = null;
    api().recordTodoDone?.(1)?.catch?.(() => {});
    persist();
    return { id, spawnedId };
  }

  function reopenItem(id, spawnedId = '') {
    const entry = find(id);
    if (!entry || !entry.item.done) return;
    entry.item.done = false;
    delete entry.item.completedAt;
    if (spawnedId) {
      const spawned = find(spawnedId);
      if (spawned && !spawned.item.done) spawned.list.splice(spawned.index, 1);
    }
    api().recordTodoDone?.(-1)?.catch?.(() => {});
    persist();
  }

  function removeItem(id) {
    const entry = find(id);
    if (!entry) return;
    const [removed] = entry.list.splice(entry.index, 1);
    persist();
    const summary = removed.text.length > 18 ? `${removed.text.slice(0, 18)}…` : removed.text;
    toast(`已删除「${summary}」`, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => {
        const list = data[entry.categoryId] || data[categories[0].id];
        if (find(removed.id)) return;
        list.splice(Math.min(entry.index, list.length), 0, removed);
        persist();
      },
    });
  }

  function setDoing(id) {
    doing = id && (!doing || doing.id !== id) ? { id, since: Date.now() } : null;
    persist();
  }

  // 「待办挪到明天」：今天到期和已逾期、还没完成的待办，截止改到明天的同一钟点。
  function moveDueToTomorrow(now = Date.now()) {
    const base = new Date(now);
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1).getTime();
    let moved = 0;
    allEntries().forEach(({ item }) => {
      const due = Date.parse(item.deadline);
      if (item.done || !Number.isFinite(due) || due >= end) return;
      const at = new Date(due);
      item.deadline = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, at.getHours(), at.getMinutes()).toISOString();
      item.remindedAt = 0;
      moved += 1;
    });
    if (moved) persist();
    return moved;
  }

  // ---------------- 页面状态 ----------------
  let filter = 'all';
  let query = '';
  let editingId = '';
  let enteringId = '';
  const expandedDone = new Set();
  const drafts = new Map(); // 分类 id → { at（手动选的截止）, repeat, remindMin, unparsed }
  const draftOf = (categoryId) => {
    if (!drafts.has(categoryId)) drafts.set(categoryId, { at: null, repeat: null, remindMin: T.DEFAULT_REMIND_MIN, unparsed: false });
    return drafts.get(categoryId);
  };

  // ---------------- 渲染 ----------------
  function cardFor(categoryId) {
    return grid.querySelector(`.task-card[data-category="${CSS.escape(categoryId)}"]`);
  }

  function buildCard(category, index) {
    const card = document.createElement('section');
    card.className = 'task-card tile';
    card.dataset.category = category.id;
    card.innerHTML = `
      <header class="task-head">
        <i class="task-dot" aria-hidden="true"></i>
        <b class="task-name" data-action="rename" title="双击改名"></b>
        <span class="task-count"></span>
        <span class="task-flex"></span>
        <button class="task-icon" type="button" data-action="menu" aria-label="分类选项">${ICON.more}</button>
      </header>
      <div class="task-body"></div>
      <form class="task-add" autocomplete="off">
        <label class="task-field">${ICON.plus}<input class="task-add-input" type="text" maxlength="200" /><span class="task-parse" hidden><span></span><button type="button" data-action="unparse" aria-label="不识别日期">${ICON.x}</button></span></label>
        <button class="task-date" type="button" data-action="add-date">${ICON.cal}<span></span></button>
      </form>`;
    card.querySelector('.task-add-input').placeholder = index === 0 ? '添加待办，如「周五前 交稿」' : '添加待办';
    return card;
  }

  function syncCards() {
    const shape = T.gridShape(categories.length);
    grid.style.setProperty('--task-columns', String(shape.columns));
    grid.style.setProperty('--task-rows', String(shape.rows));
    const keep = new Set(categories.map((category) => category.id));
    grid.querySelectorAll('.task-card').forEach((card) => { if (!keep.has(card.dataset.category)) card.remove(); });
    categories.forEach((category, index) => {
      let card = cardFor(category.id);
      if (!card) card = buildCard(category, index);
      if (grid.children[index] !== card) grid.insertBefore(card, grid.children[index] || null);
      card.dataset.color = category.color;
      const name = card.querySelector('.task-name');
      if (name && !name.isContentEditable) name.textContent = category.name;
      card.querySelector('.task-add-input').setAttribute('aria-label', `添加到「${category.name}」`);
      card.querySelector('.task-add-input').placeholder = index === 0 ? '添加待办，如「周五前 交稿」' : '添加待办';
    });
  }

  function rowHtml(item, now) {
    const done = item.done;
    const isDoing = !done && doing && doing.id === item.id;
    const label = done
      ? { text: `${T.shortDate(item.completedAt || item.createdAt, now)} 完成`, tone: 'done' }
      : T.dueLabel(item.deadline, now);
    const li = document.createElement('li');
    li.className = `task-row${done ? ' done' : ''}${isDoing ? ' doing' : ''}${item.id === enteringId ? ' enter' : ''}`;
    li.dataset.id = item.id;
    li.innerHTML = `
      <button class="task-check" type="button" data-action="toggle" aria-pressed="${done}">${ICON.check}</button>
      ${editingId === item.id ? '<input class="task-edit" type="text" maxlength="200" />' : '<button class="task-text" type="button" data-action="edit"></button>'}
      ${item.repeat ? `<span class="task-rep">${ICON.repeat}</span>` : ''}
      ${isDoing ? `<span class="task-chip">${ICON.target}在做</span>` : ''}
      <button class="task-time" type="button" data-action="date"></button>
      <span class="task-acts">
        ${done ? '' : `<button class="task-icon" type="button" data-action="doing">${isDoing ? ICON.stop : ICON.play}</button>`}
        <button class="task-icon" type="button" data-action="delete" aria-label="删除">${ICON.trash}</button>
      </span>`;
    li.querySelector('.task-check').setAttribute('aria-label', done ? `恢复未完成：${item.text}` : `完成：${item.text}`);
    const text = li.querySelector('.task-text');
    if (text) { text.textContent = item.text; text.title = item.text; }
    const edit = li.querySelector('.task-edit');
    if (edit) edit.value = item.text;
    const rep = li.querySelector('.task-rep');
    if (rep) rep.title = T.repeatLabel(item.repeat, item.deadline);
    const time = li.querySelector('.task-time');
    time.textContent = label.text;
    time.dataset.tone = label.tone;
    time.title = T.describe(item);
    if (done) time.disabled = true;
    const doingButton = li.querySelector('[data-action="doing"]');
    if (doingButton) doingButton.setAttribute('aria-label', isDoing ? '取消在做' : '设为在做');
    return li;
  }

  const EMPTY = { all: '还没有待办', today: '今天没有到期的', overdue: '没有逾期', done: '还没有完成的' };

  function renderBody(category, now) {
    const card = cardFor(category.id);
    if (!card) return;
    const body = card.querySelector('.task-body');
    const items = data[category.id] || [];
    const visible = (item) => T.matchesSearch(item, query);
    const pending = T.sortPending(items.filter((item) => !item.done && T.matches(item, filter === 'done' ? 'all' : filter, now) && visible(item)));
    const done = T.sortDone(items.filter((item) => item.done && visible(item)));
    card.querySelector('.task-count').textContent = String(items.filter((item) => !item.done).length);
    body.replaceChildren();
    const list = document.createElement('ul');
    list.className = 'task-list';
    const shownPending = filter === 'done' ? [] : pending;
    shownPending.forEach((item) => list.append(rowHtml(item, now)));
    const showDoneRows = filter === 'done' || (filter === 'all' && expandedDone.has(category.id));
    if (shownPending.length) body.append(list);
    else if (!query && filter === 'all' && done.length) {
      const allDone = document.createElement('p');
      allDone.className = 'task-empty';
      allDone.textContent = '都完成了';
      body.append(allDone);
    }
    if (filter === 'all' && done.length) {
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'task-fold';
      fold.dataset.action = 'fold';
      fold.setAttribute('aria-expanded', String(showDoneRows));
      fold.innerHTML = `${ICON.chevron}<span></span>`;
      fold.querySelector('span').textContent = `已完成 ${done.length}`;
      body.append(fold);
    }
    if (showDoneRows && done.length) {
      const doneList = document.createElement('ul');
      doneList.className = 'task-list task-done-list';
      done.forEach((item) => doneList.append(rowHtml(item, now)));
      body.append(doneList);
    }
    if (!shownPending.length && !(filter === 'done' && done.length) && !(filter === 'all' && done.length)) {
      const empty = document.createElement('p');
      empty.className = 'task-empty';
      empty.textContent = query ? '没有找到' : EMPTY[filter];
      body.append(empty);
    }
    refreshAddRow(category.id, now);
  }

  function renderFilters(now) {
    const counts = T.counts(data, now);
    els.filters?.querySelectorAll('[data-filter]').forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.filter === filter));
      const badge = button.querySelector('b');
      if (badge) badge.textContent = String(counts[button.dataset.filter]);
    });
  }

  function render() {
    const now = Date.now();
    syncCards();
    categories.forEach((category) => renderBody(category, now));
    renderFilters(now);
    enteringId = '';
    const edit = grid.querySelector('.task-edit');
    if (edit && document.activeElement !== edit) {
      edit.focus({ preventScroll: true });
      edit.select();
    }
    if (!els.manager.hidden) renderManager();
  }

  // 只刷新时间标签与计数，不重建行（每 30 秒、日期变化时）。
  function refreshLabels() {
    const now = Date.now();
    grid.querySelectorAll('.task-row:not(.done)').forEach((row) => {
      const entry = find(row.dataset.id);
      const time = row.querySelector('.task-time');
      if (!entry || !time) return;
      const label = T.dueLabel(entry.item.deadline, now);
      time.textContent = label.text;
      time.dataset.tone = label.tone;
    });
    categories.forEach((category) => refreshAddRow(category.id, now));
    renderFilters(now);
  }

  // 添加行：输入里识别到日期时显示解析标签；日期按钮显示这一条会用的截止时间。
  function draftDeadline(categoryId, now = Date.now()) {
    const card = cardFor(categoryId);
    const draft = draftOf(categoryId);
    const input = card?.querySelector('.task-add-input');
    const parsed = input && !draft.unparsed ? T.parseAddInput(input.value, now) : { at: null };
    if (parsed.at) return { at: parsed.at, parsed };
    if (draft.at && draft.at > now) return { at: draft.at, parsed };
    return { at: T.defaultDeadline(now), parsed };
  }

  function refreshAddRow(categoryId, now = Date.now()) {
    const card = cardFor(categoryId);
    if (!card) return;
    const { at, parsed } = draftDeadline(categoryId, now);
    const chip = card.querySelector('.task-parse');
    chip.hidden = !parsed.at;
    if (parsed.at) chip.querySelector('span').textContent = parsed.label;
    const dateButton = card.querySelector('.task-date');
    dateButton.querySelector('span').textContent = T.shortDate(at, now);
    dateButton.dataset.manual = String(Boolean(parsed.at || draftOf(categoryId).at));
    const draft = draftOf(categoryId);
    dateButton.title = [T.fullDate(new Date(at).toISOString()), draft.repeat ? T.repeatLabel(draft.repeat, new Date(at).toISOString()) : '', T.remindLabel(draft.remindMin)].filter(Boolean).join(' · ');
  }

  function submitAdd(categoryId) {
    const card = cardFor(categoryId);
    const input = card?.querySelector('.task-add-input');
    if (!input || !input.value.trim()) return;
    const now = Date.now();
    const draft = draftOf(categoryId);
    const { at, parsed } = draftDeadline(categoryId, now);
    const text = parsed.at ? parsed.text : input.value.trim();
    const id = addItem(categoryId, text, at, { repeat: draft.repeat, remindMin: draft.remindMin });
    if (!id) return;
    input.value = '';
    drafts.delete(categoryId);
    if (picker.mode === 'add' && picker.categoryId === categoryId) closePicker();
    refreshAddRow(categoryId);
    input.focus({ preventScroll: true });
    requestAnimationFrame(() => grid.querySelector(`.task-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }

  // ---------------- 勾选、编辑 ----------------
  function toggleRow(row) {
    const id = row.dataset.id;
    const entry = find(id);
    if (!entry) return;
    if (entry.item.done) {
      reopenItem(id);
      return;
    }
    if (row.classList.contains('completing')) return;
    row.classList.add('completing');
    setTimeout(() => {
      const result = completeItem(id);
      if (!result) return;
      toast(`已完成「${entry.item.text}」${result.spawnedId ? ' · 已排好下一次' : ''}`, {
        actionLabel: '撤销',
        duration: 5000,
        onAction: () => reopenItem(result.id, result.spawnedId),
      });
    }, reduceMotion() ? 0 : COMPLETE_DELAY_MS);
  }

  function startEdit(id) {
    editingId = id;
    render();
  }

  function finishEdit(save) {
    const input = grid.querySelector('.task-edit');
    const id = editingId;
    editingId = '';
    if (save && input) {
      const entry = find(id);
      const text = input.value.replace(/\s+/g, ' ').trim();
      if (entry && text && text !== entry.item.text) {
        entry.item.text = text.slice(0, 200);
        persist();
        return;
      }
    }
    render();
  }

  // ---------------- 截止时间选择器 ----------------
  const picker = { mode: '', categoryId: '', id: '', anchor: null, year: 0, month: 0, date: null, repeat: null, remindMin: T.DEFAULT_REMIND_MIN };

  function fillPickerOptions() {
    if (els.pickerHour && !els.pickerHour.options.length) {
      for (let hour = 0; hour < 24; hour += 1) els.pickerHour.add(new Option(String(hour).padStart(2, '0'), String(hour)));
    }
    if (els.pickerRemind && !els.pickerRemind.options.length) {
      T.REMIND_OPTIONS.forEach((minutes) => els.pickerRemind.add(new Option(T.remindLabel(minutes), String(minutes))));
    }
  }

  function fillMinutes(selected) {
    const minutes = new Set(Array.from({ length: 12 }, (_, index) => index * 5));
    minutes.add(selected);
    els.pickerMinute.replaceChildren(...[...minutes].sort((a, b) => a - b).map((minute) => new Option(String(minute).padStart(2, '0'), String(minute))));
    els.pickerMinute.value = String(selected);
  }

  function repeatValue(rule) {
    return rule ? rule.kind : 'none';
  }

  function fillRepeat() {
    const iso = picker.date.toISOString();
    const options = [
      ['none', '不重复'],
      ['daily', '每天'],
      ['weekdays', '工作日'],
      ['weekly', T.repeatLabel({ kind: 'weekly' }, iso)],
      ['monthly', T.repeatLabel({ kind: 'monthly', day: picker.date.getDate() }, iso)],
      ['custom', '自定义…'],
    ];
    els.pickerRepeat.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    els.pickerRepeat.value = repeatValue(picker.repeat);
    els.pickerCustom.hidden = !picker.repeat || picker.repeat.kind !== 'custom';
    if (picker.repeat && picker.repeat.kind === 'custom') {
      els.pickerEvery.value = String(picker.repeat.every);
      els.pickerUnit.value = picker.repeat.unit;
    }
  }

  function renderPicker() {
    const now = new Date();
    els.pickerMonth.textContent = `${picker.year} 年 ${picker.month + 1} 月`;
    els.pickerQuick.replaceChildren(...T.quickDates(now).map(({ label, date }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.quick = String(date.getTime());
      button.setAttribute('aria-pressed', String(T.dayOffset(date.getTime(), picker.date.getTime()) === 0));
      return button;
    }));
    const cells = T.monthGrid(picker.year, picker.month);
    els.pickerGrid.replaceChildren(
      ...['一', '二', '三', '四', '五', '六', '日'].map((day) => {
        const span = document.createElement('span');
        span.className = 'task-cal-week';
        span.textContent = day;
        return span;
      }),
      ...cells.map(({ date, outside }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = String(date.getDate());
        button.dataset.day = String(date.getTime());
        if (outside) button.classList.add('outside');
        if (T.dayOffset(date.getTime(), now.getTime()) === 0) button.classList.add('today');
        if (T.dayOffset(date.getTime(), picker.date.getTime()) === 0) button.setAttribute('aria-pressed', 'true');
        return button;
      }),
    );
    els.pickerHour.value = String(picker.date.getHours());
    fillMinutes(picker.date.getMinutes());
    fillRepeat();
    els.pickerRemind.value = String(picker.remindMin);
    const valid = picker.date.getTime() > Date.now();
    els.pickerError.textContent = valid ? '' : '选一个晚于现在的时间';
    els.picker.querySelector('[data-pick="ok"]').disabled = !valid;
  }

  function positionPopover(pop, anchor, placement = 'above') {
    const box = page.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    pop.style.visibility = 'hidden';
    pop.hidden = false;
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    let left = rect.right - box.left - width;
    left = Math.max(0, Math.min(left, box.width - width));
    let top = placement === 'below' ? rect.bottom - box.top + 6 : rect.top - box.top - height - 8;
    if (placement === 'above' && top < 0) top = rect.bottom - box.top + 6;
    top = Math.max(0, Math.min(top, box.height - height));
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
    pop.style.visibility = '';
  }

  function openPicker(mode, categoryId, id, anchor) {
    closeMenus();
    fillPickerOptions();
    let at;
    if (mode === 'edit') {
      const entry = find(id);
      if (!entry) return;
      at = Date.parse(entry.item.deadline) || T.defaultDeadline();
      picker.repeat = entry.item.repeat ? { ...entry.item.repeat } : null;
      picker.remindMin = T.remindLead(entry.item);
    } else {
      const draft = draftOf(categoryId);
      at = draftDeadline(categoryId).at;
      picker.repeat = draft.repeat ? { ...draft.repeat } : null;
      picker.remindMin = draft.remindMin;
    }
    Object.assign(picker, { mode, categoryId, id, anchor, date: new Date(at) });
    picker.year = picker.date.getFullYear();
    picker.month = picker.date.getMonth();
    renderPicker();
    positionPopover(els.picker, anchor, 'above');
    anchor.setAttribute('aria-expanded', 'true');
  }

  function closePicker() {
    if (els.picker.hidden) return false;
    els.picker.hidden = true;
    picker.anchor?.setAttribute('aria-expanded', 'false');
    picker.mode = '';
    return true;
  }

  // 添加模式：改动直接用到这一条草稿上（日期按钮立刻变）；编辑模式：点「确定」才保存。
  function pickerChanged() {
    renderPicker();
    if (picker.mode !== 'add' || picker.date.getTime() <= Date.now()) return;
    const draft = draftOf(picker.categoryId);
    draft.at = picker.date.getTime();
    draft.unparsed = true;
    draft.repeat = picker.repeat;
    draft.remindMin = picker.remindMin;
    refreshAddRow(picker.categoryId);
  }

  function setPickerDay(time) {
    const day = new Date(Number(time));
    picker.date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), picker.date.getHours(), picker.date.getMinutes());
    picker.year = picker.date.getFullYear();
    picker.month = picker.date.getMonth();
    if (picker.repeat && (picker.repeat.kind === 'monthly' || (picker.repeat.kind === 'custom' && picker.repeat.unit === 'month'))) picker.repeat.day = picker.date.getDate();
    pickerChanged();
  }

  function commitPicker() {
    if (picker.date.getTime() <= Date.now()) return;
    if (picker.mode === 'edit') {
      const entry = find(picker.id);
      if (entry) {
        const deadline = picker.date.toISOString();
        if (deadline !== entry.item.deadline) entry.item.remindedAt = 0;
        entry.item.deadline = deadline;
        if (picker.repeat) entry.item.repeat = T.normalizeRepeat(picker.repeat);
        else delete entry.item.repeat;
        entry.item.remindMin = picker.remindMin;
        persist();
      }
    } else {
      pickerChanged();
    }
    const { anchor, mode } = picker;
    closePicker();
    if (mode === 'add') anchor?.closest('.task-card')?.querySelector('.task-add-input')?.focus({ preventScroll: true });
  }

  function clearPicker() {
    if (picker.mode === 'add') {
      drafts.delete(picker.categoryId);
      refreshAddRow(picker.categoryId);
      closePicker();
      return;
    }
    picker.date = new Date(T.defaultDeadline());
    picker.year = picker.date.getFullYear();
    picker.month = picker.date.getMonth();
    picker.repeat = null;
    picker.remindMin = T.DEFAULT_REMIND_MIN;
    renderPicker();
  }

  els.picker.addEventListener('click', (event) => {
    const quick = event.target.closest('[data-quick]');
    if (quick) return setPickerDay(quick.dataset.quick);
    const day = event.target.closest('[data-day]');
    if (day) return setPickerDay(day.dataset.day);
    const action = event.target.closest('[data-pick]')?.dataset.pick;
    if (action === 'prev' || action === 'next') {
      const shifted = new Date(picker.year, picker.month + (action === 'next' ? 1 : -1), 1);
      picker.year = shifted.getFullYear();
      picker.month = shifted.getMonth();
      renderPicker();
    } else if (action === 'ok') commitPicker();
    else if (action === 'clear') clearPicker();
  });
  els.pickerHour.addEventListener('change', () => { picker.date.setHours(Number(els.pickerHour.value)); pickerChanged(); });
  els.pickerMinute.addEventListener('change', () => { picker.date.setMinutes(Number(els.pickerMinute.value)); pickerChanged(); });
  els.pickerRemind.addEventListener('change', () => { picker.remindMin = Number(els.pickerRemind.value); pickerChanged(); });
  els.pickerRepeat.addEventListener('change', () => {
    const kind = els.pickerRepeat.value;
    picker.repeat = kind === 'none' ? null
      : kind === 'monthly' ? { kind, day: picker.date.getDate() }
        : kind === 'custom' ? { kind, every: 2, unit: 'week' }
          : { kind };
    pickerChanged();
  });
  const customChanged = () => {
    const unit = els.pickerUnit.value;
    picker.repeat = T.normalizeRepeat({ kind: 'custom', every: els.pickerEvery.value, unit, day: picker.date.getDate() });
    pickerChanged();
  };
  els.pickerEvery.addEventListener('change', customChanged);
  els.pickerUnit.addEventListener('change', customChanged);
  els.picker.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && event.target.tagName !== 'SELECT') {
      event.preventDefault();
      commitPicker();
    }
  });

  // ---------------- 分类：重命名、菜单、管理 ----------------
  function renameCategory(id, name) {
    const category = categoryOf(id);
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!category || !clean || clean === category.name) return false;
    category.name = clean;
    persist();
    return true;
  }

  function startRename(card) {
    const name = card.querySelector('.task-name');
    const category = categoryOf(card.dataset.category);
    if (!name || !category || name.isContentEditable) return;
    name.contentEditable = 'plaintext-only';
    name.spellcheck = false;
    name.focus();
    document.getSelection()?.selectAllChildren(name);
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      name.removeEventListener('blur', onBlur);
      name.removeEventListener('keydown', onKey);
      name.contentEditable = 'false';
      name.removeAttribute('contenteditable');
      if (!(save && renameCategory(category.id, name.textContent))) name.textContent = category.name;
    };
    const onBlur = () => finish(true);
    const onKey = (event) => {
      if (event.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); finish(true); }
    };
    name.addEventListener('blur', onBlur);
    name.addEventListener('keydown', onKey);
    name._cancelRename = () => finish(false);
  }

  function moveCategory(id, direction) {
    const index = categories.findIndex((category) => category.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= categories.length) return;
    [categories[index], categories[target]] = [categories[target], categories[index]];
    persist();
  }

  function recolor(id, color) {
    const category = categoryOf(id);
    if (!category || !T.COLORS.includes(color)) return;
    category.color = color;
    persist();
  }

  function addCategory(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!clean || categories.length >= T.MAX_CATEGORIES) return false;
    const category = { id: uid('c'), name: clean, color: T.nextColor(categories) };
    categories.push(category);
    data[category.id] = [];
    persist();
    return true;
  }

  // 删除分类：空分类直接删；有待办要先选一个分类合并过去。至少保留一个分类。
  function removeCategory(id, mergeInto = '') {
    if (categories.length <= 1) return false;
    const items = data[id] || [];
    if (items.length && !categoryOf(mergeInto)) return false;
    if (items.length) data[mergeInto].push(...items);
    delete data[id];
    categories = categories.filter((category) => category.id !== id);
    drafts.delete(id);
    expandedDone.delete(id);
    persist();
    return true;
  }

  let menuCategory = '';
  function openMenu(card, anchor) {
    closePicker();
    els.manager.hidden = true;
    menuCategory = card.dataset.category;
    const category = categoryOf(menuCategory);
    const index = categories.indexOf(category);
    els.menuSwatches.replaceChildren(...T.COLORS.map((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'task-swatch';
      swatch.dataset.color = color;
      swatch.setAttribute('aria-label', '换成这个颜色');
      swatch.setAttribute('aria-pressed', String(color === category.color));
      return swatch;
    }));
    els.menu.querySelector('[data-menu="up"]').disabled = index === 0;
    els.menu.querySelector('[data-menu="down"]').disabled = index === categories.length - 1;
    els.menu.querySelector('[data-menu="remove"]').disabled = categories.length <= 1;
    positionPopover(els.menu, anchor, 'below');
  }

  els.menu.addEventListener('click', (event) => {
    const swatch = event.target.closest('.task-swatch');
    if (swatch) {
      recolor(menuCategory, swatch.dataset.color);
      els.menu.hidden = true;
      return;
    }
    const action = event.target.closest('[data-menu]')?.dataset.menu;
    if (!action) return;
    els.menu.hidden = true;
    if (action === 'rename') startRename(cardFor(menuCategory));
    else if (action === 'up') moveCategory(menuCategory, -1);
    else if (action === 'down') moveCategory(menuCategory, 1);
    else if (action === 'remove') openManager(menuCategory);
  });

  let removingId = '';
  function renderManager() {
    els.managerCount.textContent = `${categories.length} / ${T.MAX_CATEGORIES}`;
    els.managerAdd.hidden = categories.length >= T.MAX_CATEGORIES;
    els.managerList.replaceChildren(...categories.map((category, index) => {
      const li = document.createElement('li');
      li.className = 'task-manager-row';
      li.dataset.id = category.id;
      li.draggable = true;
      li.dataset.color = category.color;
      const count = (data[category.id] || []).length;
      li.innerHTML = `
        <button class="task-swatch" type="button" data-manage="color" aria-label="换颜色"></button>
        <input class="task-manager-name" maxlength="24" aria-label="分类名称" />
        <span class="task-manager-meta"></span>
        <button class="task-icon" type="button" data-manage="up" aria-label="上移"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg></button>
        <button class="task-icon" type="button" data-manage="down" aria-label="下移"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
        <button class="task-icon" type="button" data-manage="remove" aria-label="删除分类">${ICON.trash}</button>`;
      li.querySelector('.task-manager-name').value = category.name;
      li.querySelector('.task-manager-meta').textContent = count ? `${count} 条` : '空';
      li.querySelector('[data-manage="up"]').disabled = index === 0;
      li.querySelector('[data-manage="down"]').disabled = index === categories.length - 1;
      li.querySelector('[data-manage="remove"]').disabled = categories.length <= 1;
      if (removingId === category.id) {
        const confirm = document.createElement('div');
        confirm.className = 'task-manager-confirm';
        if (count) {
          const others = categories.filter((other) => other.id !== category.id);
          confirm.innerHTML = '<span></span><select aria-label="合并到"></select><button class="task-danger" type="button" data-manage="merge">合并并删除</button><button class="task-ghost" type="button" data-manage="cancel">取消</button>';
          confirm.querySelector('span').textContent = `${count} 条待办合并到`;
          confirm.querySelector('select').replaceChildren(...others.map((other) => new Option(other.name, other.id)));
        } else {
          confirm.innerHTML = '<span>删除这个空分类？</span><button class="task-danger" type="button" data-manage="confirm">删除</button><button class="task-ghost" type="button" data-manage="cancel">取消</button>';
        }
        li.append(confirm);
      }
      return li;
    }));
  }

  function openManager(removeId = '') {
    closePicker();
    els.menu.hidden = true;
    removingId = removeId;
    renderManager();
    positionPopover(els.manager, els.manage, 'below');
    els.manage.setAttribute('aria-expanded', 'true');
  }

  function closeManager() {
    if (els.manager.hidden) return false;
    els.manager.hidden = true;
    removingId = '';
    els.manage.setAttribute('aria-expanded', 'false');
    return true;
  }

  els.manage?.addEventListener('click', () => (els.manager.hidden ? openManager() : closeManager()));
  els.managerList.addEventListener('click', (event) => {
    const row = event.target.closest('.task-manager-row');
    const action = event.target.closest('[data-manage]')?.dataset.manage;
    if (!row || !action) return;
    const id = row.dataset.id;
    if (action === 'color') {
      const category = categoryOf(id);
      const used = new Set(categories.map((item) => item.color));
      const order = T.COLORS.slice(T.COLORS.indexOf(category.color) + 1).concat(T.COLORS);
      recolor(id, order.find((color) => !used.has(color)) || order[0]);
    } else if (action === 'up') moveCategory(id, -1);
    else if (action === 'down') moveCategory(id, 1);
    else if (action === 'remove') { removingId = id; renderManager(); }
    else if (action === 'cancel') { removingId = ''; renderManager(); }
    else if (action === 'confirm' || action === 'merge') {
      const target = row.querySelector('.task-manager-confirm select')?.value || '';
      const name = categoryOf(id)?.name || '';
      const merged = categoryOf(target)?.name || '';
      removingId = '';
      if (removeCategory(id, target)) toast(merged ? `已删除「${name}」，待办并入「${merged}」` : `已删除「${name}」`);
    }
  });
  els.managerList.addEventListener('change', (event) => {
    const input = event.target.closest('.task-manager-name');
    if (input && !renameCategory(input.closest('.task-manager-row').dataset.id, input.value)) renderManager();
  });
  els.managerList.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.matches('.task-manager-name') && !event.isComposing) event.target.blur();
  });
  let draggedId = '';
  els.managerList.addEventListener('dragstart', (event) => {
    draggedId = event.target.closest('.task-manager-row')?.dataset.id || '';
    event.dataTransfer?.setData('text/plain', draggedId);
  });
  els.managerList.addEventListener('dragover', (event) => {
    if (draggedId) event.preventDefault();
  });
  els.managerList.addEventListener('drop', (event) => {
    event.preventDefault();
    const target = event.target.closest('.task-manager-row')?.dataset.id;
    if (!draggedId || !target || target === draggedId) return;
    const from = categories.findIndex((category) => category.id === draggedId);
    const [moved] = categories.splice(from, 1);
    categories.splice(categories.findIndex((category) => category.id === target) + (from <= categories.findIndex((category) => category.id === target) ? 1 : 0), 0, moved);
    draggedId = '';
    persist();
  });
  els.managerAdd.addEventListener('submit', (event) => {
    event.preventDefault();
    if (addCategory(els.managerName.value)) els.managerName.value = '';
  });

  function closeMenus() {
    const closed = !els.menu.hidden;
    els.menu.hidden = true;
    return closeManager() || closed;
  }

  // ---------------- 事件 ----------------
  grid.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const card = target.closest('.task-card');
    const row = target.closest('.task-row');
    const action = target.dataset.action;
    if (action === 'toggle' && row) toggleRow(row);
    else if (action === 'edit' && row) startEdit(row.dataset.id);
    else if (action === 'date' && row) openPicker('edit', card.dataset.category, row.dataset.id, target);
    else if (action === 'doing' && row) setDoing(row.dataset.id);
    else if (action === 'delete' && row) removeItem(row.dataset.id);
    else if (action === 'fold' && card) {
      if (expandedDone.has(card.dataset.category)) expandedDone.delete(card.dataset.category);
      else expandedDone.add(card.dataset.category);
      renderBody(categoryOf(card.dataset.category), Date.now());
    } else if (action === 'menu' && card) openMenu(card, target);
    else if (action === 'add-date' && card) {
      if (picker.mode === 'add' && picker.categoryId === card.dataset.category) closePicker();
      else openPicker('add', card.dataset.category, '', target);
    } else if (action === 'unparse' && card) {
      draftOf(card.dataset.category).unparsed = true;
      refreshAddRow(card.dataset.category);
      card.querySelector('.task-add-input').focus({ preventScroll: true });
    }
  });
  grid.addEventListener('dblclick', (event) => {
    const name = event.target.closest('.task-name');
    if (name) startRename(name.closest('.task-card'));
  });
  grid.addEventListener('input', (event) => {
    const input = event.target.closest('.task-add-input');
    if (!input) return;
    const categoryId = input.closest('.task-card').dataset.category;
    if (!input.value.trim()) draftOf(categoryId).unparsed = false;
    refreshAddRow(categoryId);
  });
  grid.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const add = event.target.closest('.task-add-input');
    if (add) {
      const categoryId = add.closest('.task-card').dataset.category;
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) submitAdd(categoryId);
      } else if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        openPicker('add', categoryId, '', add.closest('.task-card').querySelector('.task-date'));
      }
      return;
    }
    if (event.target.closest('.task-edit')) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finishEdit(true);
      }
    }
  });
  grid.addEventListener('focusout', (event) => {
    if (event.target.closest('.task-edit') && editingId) finishEdit(true);
  });
  grid.addEventListener('submit', (event) => event.preventDefault());

  els.filters?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    filter = button.dataset.filter;
    render();
  });
  els.search?.addEventListener('input', () => {
    query = els.search.value;
    render();
  });

  // 点到浮层外面就收起（捕获阶段：面板会阻止冒泡）。
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : document.body;
    if (!els.picker.hidden && !els.picker.contains(target) && !target.closest('[data-action="add-date"], [data-action="date"]')) closePicker();
    if (!els.menu.hidden && !els.menu.contains(target) && !target.closest('[data-action="menu"]')) els.menu.hidden = true;
    if (!els.manager.hidden && !els.manager.contains(target) && !target.closest('#task-manage')) closeManager();
  }, true);

  // Esc（由主进程转发）：先收起浮层，再退出行内编辑。
  function escape() {
    if (closePicker() || closeMenus()) return true;
    const renaming = grid.querySelector('.task-name[contenteditable]');
    if (renaming?._cancelRename) { renaming._cancelRename(); return true; }
    if (editingId) { finishEdit(false); return true; }
    return false;
  }

  api().onTodoReminder?.((payload) => {
    if (!payload || !payload.id) return;
    const entry = find(payload.id);
    if (!entry || String(entry.item.deadline) !== String(payload.deadline || '')) return;
    entry.item.remindedAt = Math.max(0, Number(payload.remindedAt) || Date.now());
    persist({ render: false });
  });

  let dayKey = new Date().toDateString();
  setInterval(() => {
    const key = new Date().toDateString();
    if (key !== dayKey) {
      dayKey = key;
      render();
    } else {
      refreshLabels();
    }
  }, 30_000);
  document.addEventListener('notch:tabchange', (event) => { if (event.detail?.tab === 'todo') refreshLabels(); });

  async function focusItem(id) {
    const entry = find(id);
    if (typeof window.setActiveTab === 'function') await window.setActiveTab('todo');
    if (!entry) return;
    query = '';
    if (els.search) els.search.value = '';
    if (entry.item.done) {
      if (filter !== 'done') expandedDone.add(entry.categoryId);
      if (filter !== 'all' && filter !== 'done') filter = 'all';
    } else if (!T.matches(entry.item, filter === 'done' ? 'all' : filter) || filter === 'done') filter = 'all';
    render();
    requestAnimationFrame(() => {
      const row = grid.querySelector(`.task-row[data-id="${CSS.escape(String(id))}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'nearest' });
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1300);
    });
  }

  window.NotchTodos = {
    items: () => data,
    list: () => allEntries().map(({ item, categoryId }) => ({ ...item, categoryId })),
    categories: () => categories.map((category) => ({ ...category })),
    categoryName: (id) => categoryOf(id)?.name || '',
    categoryColor: (id) => categoryOf(id)?.color || 'cat-4',
    add: (categoryId, text, deadline, extra) => addItem(categoryId, text, deadline, extra),
    complete: (id) => Boolean(completeItem(id)),
    reopen: (id) => reopenItem(id),
    remove: (id) => removeItem(id),
    doing: () => {
      const entry = doing && find(doing.id);
      return entry && !entry.item.done ? { ...entry.item, categoryId: entry.categoryId, since: doing.since } : null;
    },
    setDoing,
    moveDueToTomorrow,
    focus: focusItem,
    open: () => window.setActiveTab?.('todo'),
  };
  window.NotchTodoPage = { render, escape, state: () => ({ filter, query, expanded: [...expandedDone] }) };

  persist({ render: false });
  render();
})();
