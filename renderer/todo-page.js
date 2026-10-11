// 待办页：三栏——今日待办 · 本周计划 · 重点项目。前两栏按时间归属（日常待办，加上定了日期的项目步骤），各有自己的添加行；
// 第三栏列出所有重点项目，点一个才展开它的步骤与「加下一步」。管理项目、截止时间选择器、在做、重复、拖动换栏都在这里。
// 数据归这里：`notch-todo-data`（分类 id → 待办数组）、`notch-todo-categories-v1`（其中 daily: true 的那个是日常，其余是项目）、`notch-todo-doing-v1`。
// 第一次升级时把旧数据原样备份到 `notch-todo-data-v1-backup`，P0–P3 的名字同时写回旧键，方便回滚。
(function bootstrapTodoPage() {
  'use strict';

  const T = window.NotchTodo;
  const $ = (id) => document.getElementById(id);
  const page = $('task-page');
  const board = $('task-board');
  if (!T || !page || !board) return;

  const DATA_KEY = 'notch-todo-data';
  const CATEGORY_KEY = 'notch-todo-categories-v1';
  const LEGACY_NAMES_KEY = 'notch-todo-category-names-v1';
  const BACKUP_KEY = 'notch-todo-data-v1-backup';
  const DOING_KEY = 'notch-todo-doing-v1';
  const COMPLETE_DELAY_MS = 300;
  const PROJECT_PREFIX = 'proj:';
  const api = () => window.notchAPI || {};
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    search: $('task-search'),
    manage: $('task-manage'),
    projects: $('task-projects'),
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
    pickerClear: $('task-picker')?.querySelector('[data-pick="clear"]'),
    manager: $('task-manager'),
    managerList: $('task-manager-list'),
    managerCount: $('task-manager-count'),
    managerAdd: $('task-manager-add'),
    managerName: $('task-manager-name'),
    tagMenu: $('task-tagmenu'),
  };

  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.6 3.6 7.4-8"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="5.5" width="15" height="14" rx="3"/><path d="M4.5 10h15M9 3.5v4M15 3.5v4"/></svg>',
    repeat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11a6.5 6.5 0 0 1 11.4-4.3L18.5 9"/><path d="M18.5 4.5V9H14"/><path d="M19 13a6.5 6.5 0 0 1-11.4 4.3L5.5 15"/><path d="M5.5 19.5V15H10"/></svg>',
    target: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="3"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 6.5v11l9-5.5Z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="7.5" width="9" height="9" rx="1.5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 7.5h13M10 7.5V5.5h4v2M7.5 7.5l.8 11h7.4l.8-11"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7.5 7.5 9 9M16.5 7.5l-9 9"/></svg>',
  };

  const PLACEHOLDER = {
    today: '添加到今天，如「下午3点 回邮件」',
    week: '加到本周，如「周五 交房租」',
    project: '加下一步，写「周五前」会排进本周',
  };
  const EMPTY = { today: '今天还没有安排', week: '这周没有别的' };

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

  const dailyId = () => T.dailyCategory(categories).id;
  const projectList = () => T.projects(categories);
  const isProject = (categoryId) => categoryId !== dailyId();
  const isDoing = (id) => Boolean(doing && doing.id === id);
  const allEntries = () => categories.flatMap((category) => (data[category.id] || []).map((item) => ({ item, categoryId: category.id })));
  const categoryOf = (id) => categories.find((category) => category.id === id) || null;
  const bucketOf = (entry, now) => T.bucketOf(entry.item, { now, daily: !isProject(entry.categoryId), doing: isDoing(entry.item.id) });
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

  // 截止时间可以为空：日常待办没有日期就在今日，项目的一步没有日期就只留在项目里。
  function addItem(categoryId, text, deadline, extra = {}) {
    const category = categoryOf(categoryId) || T.dailyCategory(categories);
    const at = Date.parse(String(deadline || '')) || Number(deadline) || 0;
    const item = T.normalizeItem({
      id: uid('todo'),
      text,
      createdAt: Date.now(),
      deadline: at > 0 ? new Date(at).toISOString() : '',
      repeat: at > 0 ? extra.repeat : undefined,
      remindMin: T.REMIND_OPTIONS.includes(extra.remindMin) ? extra.remindMin : T.DEFAULT_REMIND_MIN,
    });
    if (!item) return '';
    data[category.id].push(item);
    enteringId = item.id;
    persist();
    return item.id;
  }

  function setDeadline(id, at) {
    const entry = find(id);
    if (!entry) return;
    const deadline = Number(at) > 0 ? new Date(Number(at)).toISOString() : '';
    if (deadline !== entry.item.deadline) entry.item.remindedAt = 0;
    entry.item.deadline = deadline;
    if (!deadline) delete entry.item.repeat;
  }

  function moveToCategory(id, categoryId) {
    const entry = find(id);
    const target = categoryOf(categoryId);
    if (!entry || !target || entry.categoryId === target.id) return false;
    entry.list.splice(entry.index, 1);
    data[target.id].push(entry.item);
    return true;
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
        const list = data[entry.categoryId] || data[dailyId()];
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
  let query = '';
  let editingId = '';
  let enteringId = '';
  let focusKey = ''; // 渲染完要聚焦的添加行
  const expandedDone = new Set(); // 'today' | 'proj:<项目 id>'
  const openProjects = new Set();
  // 添加行草稿：key 是 'today' / 'week' / 'proj:<项目 id>'。项目栏的添加行每次渲染都重建，所以文字也存这里。
  const drafts = new Map();
  const draftOf = (key) => {
    if (!drafts.has(key)) drafts.set(key, { text: '', at: null, repeat: null, remindMin: T.DEFAULT_REMIND_MIN, unparsed: false });
    return drafts.get(key);
  };
  const projectOfKey = (key) => (key.startsWith(PROJECT_PREFIX) ? key.slice(PROJECT_PREFIX.length) : '');
  const columnEl = (key) => board.querySelector(`.task-col[data-col="${CSS.escape(key)}"]`);
  const projectEl = (id) => els.projects.querySelector(`.task-proj[data-project="${CSS.escape(id)}"]`);
  const addRowFor = (key) => board.querySelector(`.task-add[data-add="${CSS.escape(key)}"]`);

  // ---------------- 渲染 ----------------
  function sortEntries(entries) {
    const order = new Map(T.sortPending(entries.map((entry) => entry.item)).map((item, index) => [item.id, index]));
    return [...entries].sort((left, right) => (Number(isDoing(right.item.id)) - Number(isDoing(left.item.id))) || (order.get(left.item.id) - order.get(right.item.id)));
  }

  function rowHtml(entry, now, inProject) {
    const { item, categoryId } = entry;
    const done = item.done;
    const doingRow = !done && isDoing(item.id);
    const label = done
      ? { text: `${T.shortDate(item.completedAt || item.createdAt, now)} 完成`, tone: 'done' }
      : item.deadline ? T.dueLabel(item.deadline, now) : { text: '定时间', tone: 'empty' };
    const project = !inProject && isProject(categoryId) ? categoryOf(categoryId) : null;
    const li = document.createElement('li');
    li.className = `task-row${done ? ' done' : ''}${doingRow ? ' doing' : ''}${item.id === enteringId ? ' enter' : ''}`;
    li.dataset.id = item.id;
    li.dataset.color = categoryOf(categoryId)?.color || 'cat-4';
    li.draggable = !done && editingId !== item.id;
    li.innerHTML = `
      <button class="task-check" type="button" data-action="toggle" aria-pressed="${done}">${ICON.check}</button>
      ${editingId === item.id ? '<input class="task-edit" type="text" maxlength="200" />' : '<button class="task-text" type="button" data-action="edit"></button>'}
      ${item.repeat ? `<span class="task-rep">${ICON.repeat}</span>` : ''}
      ${doingRow ? `<span class="task-chip">${ICON.target}在做</span>` : ''}
      ${project ? '<button class="task-tag" type="button" data-action="tag" title="点一下换项目，或退回日常"><i></i><span></span></button>' : ''}
      <button class="task-time" type="button" data-action="date"></button>
      <span class="task-acts">
        ${done ? '' : `<button class="task-icon" type="button" data-action="doing">${doingRow ? ICON.stop : ICON.play}</button>`}
        <button class="task-icon" type="button" data-action="delete" aria-label="删除">${ICON.trash}</button>
      </span>`;
    li.querySelector('.task-check').setAttribute('aria-label', done ? `恢复未完成：${item.text}` : `完成：${item.text}`);
    const text = li.querySelector('.task-text');
    if (text) { text.textContent = item.text; text.title = item.text; }
    const edit = li.querySelector('.task-edit');
    if (edit) edit.value = item.text;
    const rep = li.querySelector('.task-rep');
    if (rep) rep.title = T.repeatLabel(item.repeat, item.deadline);
    if (project) li.querySelector('.task-tag span').textContent = project.name;
    const time = li.querySelector('.task-time');
    time.textContent = label.text;
    time.dataset.tone = label.tone;
    time.title = item.deadline ? T.describe(item) : '定一个截止时间';
    if (done) time.disabled = true;
    const doingButton = li.querySelector('[data-action="doing"]');
    if (doingButton) doingButton.setAttribute('aria-label', doingRow ? '取消在做' : '设为在做');
    return li;
  }

  function buildList(entries, now, inProject, className = 'task-list') {
    const list = document.createElement('ul');
    list.className = className;
    entries.forEach((entry) => list.append(rowHtml(entry, now, inProject)));
    return list;
  }

  function buildFold(key, count) {
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'task-fold';
    fold.dataset.action = 'fold';
    fold.dataset.key = key;
    fold.setAttribute('aria-expanded', String(expandedDone.has(key)));
    fold.innerHTML = `${ICON.chevron}<span></span>`;
    fold.querySelector('span').textContent = `已完成 ${count}`;
    return fold;
  }

  function buildEmpty(text) {
    const empty = document.createElement('p');
    empty.className = 'task-empty';
    empty.textContent = text;
    return empty;
  }

  function buildAddRow(key) {
    const form = document.createElement('form');
    form.className = 'task-add';
    form.dataset.add = key;
    form.autocomplete = 'off';
    form.innerHTML = `
      <label class="task-field">${ICON.plus}<input class="task-add-input" type="text" maxlength="200" /><span class="task-parse" hidden><span></span><button type="button" data-action="unparse" aria-label="不识别日期">${ICON.x}</button></span></label>
      <button class="task-date" type="button" data-action="add-date" aria-expanded="false">${ICON.cal}<span></span></button>`;
    const project = projectOfKey(key);
    const input = form.querySelector('.task-add-input');
    input.placeholder = project ? PLACEHOLDER.project : PLACEHOLDER[key];
    input.setAttribute('aria-label', project ? `给「${categoryOf(project)?.name || ''}」加下一步` : `添加到${T.bucketLabel(key)}`);
    input.value = draftOf(key).text;
    return form;
  }

  const visible = (item) => T.matchesSearch(item, query);

  function renderColumn(key, now) {
    const column = columnEl(key);
    const body = column.querySelector('.task-body');
    const entries = sortEntries(allEntries().filter((entry) => !entry.item.done && visible(entry.item) && bucketOf(entry, now) === key));
    column.querySelector('.task-count').textContent = entries.length ? `${entries.length} 件` : '';
    body.replaceChildren();
    if (entries.length) {
      const list = document.createElement('ul');
      list.className = 'task-list';
      let divided = false;
      entries.forEach((entry) => {
        if (key === 'week' && !divided && T.beyondThisWeek(entry.item.deadline, now)) {
          divided = true;
          const divider = document.createElement('li');
          divider.className = 'task-divider';
          divider.textContent = '下周起';
          list.append(divider);
        }
        list.append(rowHtml(entry, now, false));
      });
      body.append(list);
    } else {
      body.append(buildEmpty(query ? '没有找到' : EMPTY[key]));
    }
    if (key === 'today') {
      const done = allEntries().filter((entry) => entry.item.done && visible(entry.item));
      const sorted = T.sortDone(done.map((entry) => entry.item)).map((item) => done.find((entry) => entry.item === item));
      if (sorted.length) {
        body.append(buildFold('today', sorted.length));
        if (expandedDone.has('today')) body.append(buildList(sorted, now, false, 'task-list task-done-list'));
      }
    }
    if (!addRowFor(key)) column.append(buildAddRow(key));
    refreshAddRow(key, now);
  }

  function renderProjects(now) {
    const list = projectList();
    board.querySelector('.task-col[data-col="projects"] .task-count').textContent = list.length ? `${list.length} 个` : '';
    els.projects.replaceChildren();
    if (!list.length) {
      els.projects.append(buildEmpty('还没有重点项目，在「管理项目」里加一个'));
      return;
    }
    list.forEach((project) => {
      const items = data[project.id] || [];
      const pending = sortEntries(items.filter((item) => !item.done && visible(item)).map((item) => ({ item, categoryId: project.id })));
      const done = T.sortDone(items.filter((item) => item.done && visible(item))).map((item) => ({ item, categoryId: project.id }));
      const open = query ? pending.length + done.length > 0 : openProjects.has(project.id);
      const card = document.createElement('section');
      card.className = 'task-proj';
      card.dataset.project = project.id;
      card.dataset.color = project.color;
      card.dataset.open = String(open);
      card.innerHTML = `<button class="task-proj-head" type="button" data-action="project" aria-expanded="${open}">${ICON.chevron}<i class="task-dot" aria-hidden="true"></i><b class="task-proj-name"></b><span class="task-proj-fact"></span></button>`;
      card.querySelector('.task-proj-name').textContent = project.name;
      const left = items.filter((item) => !item.done).length;
      const finished = items.length - left;
      card.querySelector('.task-proj-fact').textContent = [left ? `${left} 步` : '没有下一步', finished ? `完成 ${finished}` : ''].filter(Boolean).join(' · ');
      if (open) {
        const body = document.createElement('div');
        body.className = 'task-proj-body';
        if (pending.length) body.append(buildList(pending, now, true));
        else if (query) body.append(buildEmpty('没有找到'));
        const key = `${PROJECT_PREFIX}${project.id}`;
        if (done.length) {
          body.append(buildFold(key, done.length));
          if (expandedDone.has(key)) body.append(buildList(done, now, true, 'task-list task-done-list'));
        }
        body.append(buildAddRow(key));
        card.append(body);
      }
      els.projects.append(card);
    });
    list.forEach((project) => { if (addRowFor(`${PROJECT_PREFIX}${project.id}`)) refreshAddRow(`${PROJECT_PREFIX}${project.id}`, now); });
  }

  function render() {
    const now = Date.now();
    renderColumn('today', now);
    renderColumn('week', now);
    renderProjects(now);
    enteringId = '';
    const edit = board.querySelector('.task-edit');
    if (edit && document.activeElement !== edit) {
      edit.focus({ preventScroll: true });
      edit.select();
    }
    if (focusKey) {
      addRowFor(focusKey)?.querySelector('.task-add-input')?.focus({ preventScroll: true });
      focusKey = '';
    }
    if (!els.manager.hidden) renderManager();
  }

  // 只刷新时间标签与添加行，不重建行（每 30 秒、日期变化时）。
  function refreshLabels() {
    const now = Date.now();
    board.querySelectorAll('.task-row:not(.done)').forEach((row) => {
      const entry = find(row.dataset.id);
      const time = row.querySelector('.task-time');
      if (!entry || !time || !entry.item.deadline) return;
      const label = T.dueLabel(entry.item.deadline, now);
      time.textContent = label.text;
      time.dataset.tone = label.tone;
    });
    board.querySelectorAll('.task-add').forEach((form) => refreshAddRow(form.dataset.add, now));
  }

  function flashZone(zone) {
    if (!zone) return;
    zone.classList.remove('flash');
    void zone.offsetWidth;
    zone.classList.add('flash');
    setTimeout(() => zone.classList.remove('flash'), 800);
  }

  // ---------------- 添加行 ----------------
  // 今日和项目里默认不定时间；本周默认这周日 23:30。文字里认出日期就按日期走，并提示会落到哪一栏。
  const defaultFor = (key, now) => (key === 'week' ? T.weekEndDeadline(now) : 0);
  const bucketOfTime = (at, now) => T.bucketOf({ deadline: new Date(at).toISOString() }, { now });

  function draftDeadline(key, now = Date.now()) {
    const input = addRowFor(key)?.querySelector('.task-add-input');
    const draft = draftOf(key);
    const parsed = input && !draft.unparsed ? T.parseAddInput(input.value, now) : { at: null };
    if (parsed.at) return { at: parsed.at, parsed };
    if (draft.at && draft.at > now) return { at: draft.at, parsed };
    return { at: defaultFor(key, now), parsed };
  }

  function refreshAddRow(key, now = Date.now()) {
    const form = addRowFor(key);
    if (!form) return;
    const { at, parsed } = draftDeadline(key, now);
    const draft = draftOf(key);
    const chip = form.querySelector('.task-parse');
    chip.hidden = !parsed.at;
    if (parsed.at) chip.querySelector('span').textContent = parsed.label;
    // 时间决定落点：今日栏写了明天以后的时间会去本周，本周栏写了今天的时间会去今日，项目的下一步定了时间也会排进去。
    // 落点直接跟在时间后面（「明天 15:00 → 本周」），不另占输入框的宽度。
    const where = at ? bucketOfTime(at, now) : '';
    let moves = '';
    if (key === 'today' && where === 'week') moves = '本周';
    else if (key === 'week' && where === 'today') moves = '今日';
    else if (projectOfKey(key) && where) moves = where === 'today' ? '今日' : '本周';
    const dateButton = form.querySelector('.task-date');
    dateButton.querySelector('span').textContent = at ? `${T.shortDate(at, now)}${moves ? ` → ${moves}` : ''}` : '定时间';
    dateButton.dataset.manual = String(Boolean(parsed.at || draft.at));
    dateButton.dataset.empty = String(!at);
    dateButton.dataset.moves = String(Boolean(moves));
    dateButton.title = at
      ? [
        T.fullDate(new Date(at).toISOString()),
        moves ? (projectOfKey(key) ? `也会排进${T.bucketLabel(where)}` : `会放到${T.bucketLabel(where)}`) : '',
        draft.repeat ? T.repeatLabel(draft.repeat, new Date(at).toISOString()) : '',
        T.remindLabel(draft.remindMin),
      ].filter(Boolean).join(' · ')
      : '不定时间；点一下可以选';
  }

  function submitAdd(key) {
    const input = addRowFor(key)?.querySelector('.task-add-input');
    if (!input || !input.value.trim()) return;
    const now = Date.now();
    const draft = draftOf(key);
    const { at, parsed } = draftDeadline(key, now);
    const text = parsed.at ? parsed.text : input.value.trim();
    const project = projectOfKey(key);
    const categoryId = project || dailyId();
    input.value = '';
    drafts.delete(key);
    focusKey = key;
    if (picker.mode === 'add' && picker.key === key) closePicker();
    const id = addItem(categoryId, text, at, { repeat: draft.repeat, remindMin: draft.remindMin });
    if (!id) return;
    const entry = find(id);
    const landed = bucketOf(entry, now);
    const home = project ? projectEl(project) : columnEl(key);
    const target = landed === 'none' ? home : columnEl(landed);
    if (target !== home) flashZone(target);
    requestAnimationFrame(() => board.querySelector(`.task-row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' }));
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
    board.querySelectorAll(`.task-row[data-id="${CSS.escape(id)}"]`).forEach((node) => node.classList.add('completing'));
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
    const input = board.querySelector('.task-edit');
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
  const picker = { mode: '', key: '', id: '', anchor: null, year: 0, month: 0, date: null, repeat: null, remindMin: T.DEFAULT_REMIND_MIN };

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
    els.pickerRepeat.value = picker.repeat ? picker.repeat.kind : 'none';
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

  // mode 'add'：target 是添加行的 key；mode 'edit'：target 是待办 id。没有日期的从今天 23:30 起步。
  function openPicker(mode, target, anchor) {
    closeMenus();
    fillPickerOptions();
    let at;
    if (mode === 'edit') {
      const entry = find(target);
      if (!entry) return;
      at = Date.parse(entry.item.deadline) || T.todayDeadline();
      picker.repeat = entry.item.repeat ? { ...entry.item.repeat } : null;
      picker.remindMin = T.remindLead(entry.item);
    } else {
      const draft = draftOf(target);
      at = draftDeadline(target).at || T.todayDeadline();
      picker.repeat = draft.repeat ? { ...draft.repeat } : null;
      picker.remindMin = draft.remindMin;
    }
    Object.assign(picker, { mode, key: mode === 'add' ? target : '', id: mode === 'edit' ? target : '', anchor, date: new Date(at) });
    picker.year = picker.date.getFullYear();
    picker.month = picker.date.getMonth();
    if (els.pickerClear) els.pickerClear.textContent = mode === 'edit' ? '不定时间' : '清除';
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
    const draft = draftOf(picker.key);
    draft.at = picker.date.getTime();
    draft.unparsed = true;
    draft.repeat = picker.repeat;
    draft.remindMin = picker.remindMin;
    refreshAddRow(picker.key);
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
        setDeadline(picker.id, picker.date.getTime());
        if (picker.repeat) entry.item.repeat = T.normalizeRepeat(picker.repeat);
        else delete entry.item.repeat;
        entry.item.remindMin = picker.remindMin;
        persist();
      }
    } else {
      pickerChanged();
    }
    const { key, mode } = picker;
    closePicker();
    if (mode === 'add') addRowFor(key)?.querySelector('.task-add-input')?.focus({ preventScroll: true });
  }

  // 添加模式的「清除」回到这一栏的默认；编辑模式的「不定时间」去掉截止（日常待办回到今日，项目的一步只留在项目里）。
  function clearPicker() {
    if (picker.mode === 'add') {
      Object.assign(draftOf(picker.key), { at: null, repeat: null, remindMin: T.DEFAULT_REMIND_MIN, unparsed: false });
      refreshAddRow(picker.key);
      closePicker();
      return;
    }
    const id = picker.id;
    closePicker();
    if (!find(id)) return;
    setDeadline(id, 0);
    persist();
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
    picker.repeat = T.normalizeRepeat({ kind: 'custom', every: els.pickerEvery.value, unit: els.pickerUnit.value, day: picker.date.getDate() });
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

  // ---------------- 项目标签：换项目、退回日常 ----------------
  let tagItemId = '';
  function openTagMenu(id, anchor) {
    closePicker();
    closeManager();
    const entry = find(id);
    if (!entry) return;
    tagItemId = id;
    const buttons = projectList().map((project) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(project.id === entry.categoryId));
      button.dataset.tag = project.id;
      button.innerHTML = '<i class="task-dot" aria-hidden="true"></i><span></span>';
      button.dataset.color = project.color;
      button.querySelector('span').textContent = project.name;
      return button;
    });
    const separator = document.createElement('div');
    separator.className = 'task-sep';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'muted';
    back.setAttribute('role', 'menuitem');
    back.dataset.tag = '';
    back.textContent = '退回日常，不属于项目';
    els.tagMenu.replaceChildren(...buttons, separator, back);
    positionPopover(els.tagMenu, anchor, 'below');
  }

  function closeTagMenu() {
    if (els.tagMenu.hidden) return false;
    els.tagMenu.hidden = true;
    tagItemId = '';
    return true;
  }

  els.tagMenu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-tag]');
    if (!button) return;
    const id = tagItemId;
    const target = button.dataset.tag || dailyId();
    closeTagMenu();
    if (moveToCategory(id, target)) persist();
  });

  // ---------------- 拖动：换到今日 / 本周，或放回某个项目 ----------------
  let dragId = '';
  const zoneOf = (target) => {
    if (!(target instanceof Element)) return null;
    const project = target.closest('.task-proj');
    if (project) return project;
    const column = target.closest('.task-col');
    return column && column.dataset.col !== 'projects' ? column : null;
  };
  // 日常待办进不了项目；项目的一步可以换项目、也可以去今日 / 本周。
  function canDrop(zone) {
    const entry = dragId ? find(dragId) : null;
    if (!entry || !zone) return false;
    if (zone.classList.contains('task-proj')) return isProject(entry.categoryId);
    return true;
  }
  function clearDrag() {
    dragId = '';
    board.querySelectorAll('.dragging, .over').forEach((node) => node.classList.remove('dragging', 'over'));
  }
  function dropOn(zone) {
    const entry = find(dragId);
    if (!entry) return;
    const id = dragId;
    const now = Date.now();
    if (zone.classList.contains('task-proj')) {
      const project = zone.dataset.project;
      moveToCategory(id, project);
      setDeadline(id, 0);
      if (isDoing(id)) doing = null;
      openProjects.add(project);
      persist();
      flashZone(projectEl(project));
      return;
    }
    const key = zone.dataset.col;
    if (bucketOf(entry, now) === key) return;
    if (key === 'today') {
      // 本来有日期的，挪到今天的同一钟点（已经过了就是今天 23:30）；没有的定在今天 23:30。
      const due = Date.parse(entry.item.deadline);
      let at = T.todayDeadline(now);
      if (Number.isFinite(due)) {
        const base = new Date(now);
        const clock = new Date(due);
        const same = new Date(base.getFullYear(), base.getMonth(), base.getDate(), clock.getHours(), clock.getMinutes()).getTime();
        if (same > now) at = same;
      }
      setDeadline(id, at);
    } else {
      setDeadline(id, T.weekEndDeadline(now));
      if (isDoing(id)) doing = null;
    }
    persist();
    flashZone(columnEl(key));
  }
  board.addEventListener('dragstart', (event) => {
    const row = event.target instanceof Element ? event.target.closest('.task-row') : null;
    if (!row || row.classList.contains('done')) return;
    dragId = row.dataset.id;
    row.classList.add('dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      try { event.dataTransfer.setData('text/plain', dragId); } catch (error) {}
    }
  });
  board.addEventListener('dragover', (event) => {
    const zone = zoneOf(event.target);
    if (!canDrop(zone)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (!zone.classList.contains('over')) {
      board.querySelectorAll('.over').forEach((node) => node.classList.remove('over'));
      zone.classList.add('over');
    }
  });
  board.addEventListener('drop', (event) => {
    const zone = zoneOf(event.target);
    if (!canDrop(zone)) return;
    event.preventDefault();
    dropOn(zone);
    clearDrag();
  });
  board.addEventListener('dragend', clearDrag);

  // ---------------- 管理项目 ----------------
  const maxProjects = () => T.MAX_CATEGORIES - 1;

  function renameCategory(id, name) {
    const category = categoryOf(id);
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!category || !clean || clean === category.name) return false;
    category.name = clean;
    persist();
    return true;
  }

  // 项目的顺序只在项目之间调；日常那一类不参与排序。
  function reorderProjects(order) {
    const daily = T.dailyCategory(categories);
    categories = [...order, daily];
    persist();
  }

  function moveCategory(id, direction) {
    const order = projectList();
    const index = order.findIndex((category) => category.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    reorderProjects(order);
  }

  function recolor(id, color) {
    const category = categoryOf(id);
    if (!category || !T.COLORS.includes(color)) return;
    category.color = color;
    persist();
  }

  function addCategory(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!clean || projectList().length >= maxProjects()) return false;
    const category = { id: uid('c'), name: clean, color: T.nextColor(categories) };
    categories.push(category);
    data[category.id] = [];
    openProjects.add(category.id);
    persist();
    return true;
  }

  // 删除项目：空的直接删；有步骤的先选一个项目（或日常）并过去。日常那一类不能删。
  function removeCategory(id, mergeInto = '') {
    if (id === dailyId() || categories.length <= 1) return false;
    const items = data[id] || [];
    if (items.length && !categoryOf(mergeInto)) return false;
    if (items.length) data[mergeInto].push(...items);
    delete data[id];
    categories = categories.filter((category) => category.id !== id);
    drafts.delete(`${PROJECT_PREFIX}${id}`);
    expandedDone.delete(`${PROJECT_PREFIX}${id}`);
    openProjects.delete(id);
    persist();
    return true;
  }

  let removingId = '';
  function renderManager() {
    const list = projectList();
    els.managerCount.textContent = `${list.length} / ${maxProjects()}`;
    els.managerAdd.hidden = list.length >= maxProjects();
    els.managerList.replaceChildren(...list.map((category, index) => {
      const li = document.createElement('li');
      li.className = 'task-manager-row';
      li.dataset.id = category.id;
      li.draggable = true;
      li.dataset.color = category.color;
      const count = (data[category.id] || []).length;
      li.innerHTML = `
        <button class="task-swatch" type="button" data-manage="color" aria-label="换颜色"></button>
        <input class="task-manager-name" maxlength="24" aria-label="项目名称" />
        <span class="task-manager-meta"></span>
        <button class="task-icon" type="button" data-manage="up" aria-label="上移"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 14 5-5 5 5"/></svg></button>
        <button class="task-icon" type="button" data-manage="down" aria-label="下移"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>
        <button class="task-icon" type="button" data-manage="remove" aria-label="删除项目">${ICON.trash}</button>`;
      li.querySelector('.task-manager-name').value = category.name;
      li.querySelector('.task-manager-meta').textContent = count ? `${count} 条` : '空';
      li.querySelector('[data-manage="up"]').disabled = index === 0;
      li.querySelector('[data-manage="down"]').disabled = index === list.length - 1;
      if (removingId === category.id) {
        const confirm = document.createElement('div');
        confirm.className = 'task-manager-confirm';
        if (count) {
          const others = list.filter((other) => other.id !== category.id);
          confirm.innerHTML = '<span></span><select aria-label="并到"></select><button class="task-danger" type="button" data-manage="merge">并过去并删除</button><button class="task-ghost" type="button" data-manage="cancel">取消</button>';
          confirm.querySelector('span').textContent = `${count} 条待办并到`;
          confirm.querySelector('select').replaceChildren(...others.map((other) => new Option(other.name, other.id)), new Option('日常（今日 / 本周）', dailyId()));
        } else {
          confirm.innerHTML = '<span>删除这个空项目？</span><button class="task-danger" type="button" data-manage="confirm">删除</button><button class="task-ghost" type="button" data-manage="cancel">取消</button>';
        }
        li.append(confirm);
      }
      return li;
    }));
  }

  function openManager(removeId = '') {
    closePicker();
    closeTagMenu();
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
      const merged = target === dailyId() ? '日常' : categoryOf(target)?.name || '';
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
  let draggedCategory = '';
  els.managerList.addEventListener('dragstart', (event) => {
    draggedCategory = event.target.closest('.task-manager-row')?.dataset.id || '';
    event.dataTransfer?.setData('text/plain', draggedCategory);
  });
  els.managerList.addEventListener('dragover', (event) => {
    if (draggedCategory) event.preventDefault();
  });
  els.managerList.addEventListener('drop', (event) => {
    event.preventDefault();
    const target = event.target.closest('.task-manager-row')?.dataset.id;
    if (!draggedCategory || !target || target === draggedCategory) return;
    const order = projectList();
    const from = order.findIndex((category) => category.id === draggedCategory);
    const [moved] = order.splice(from, 1);
    const to = order.findIndex((category) => category.id === target);
    order.splice(to + (from <= to ? 1 : 0), 0, moved);
    draggedCategory = '';
    reorderProjects(order);
  });
  els.managerAdd.addEventListener('submit', (event) => {
    event.preventDefault();
    if (addCategory(els.managerName.value)) els.managerName.value = '';
  });

  function closeMenus() {
    const closedTag = closeTagMenu();
    return closeManager() || closedTag;
  }

  // ---------------- 事件 ----------------
  board.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const row = target.closest('.task-row');
    const form = target.closest('.task-add');
    const action = target.dataset.action;
    if (action === 'toggle' && row) toggleRow(row);
    else if (action === 'edit' && row) startEdit(row.dataset.id);
    else if (action === 'date' && row) openPicker('edit', row.dataset.id, target);
    else if (action === 'doing' && row) setDoing(row.dataset.id);
    else if (action === 'delete' && row) removeItem(row.dataset.id);
    else if (action === 'tag' && row) {
      if (tagItemId === row.dataset.id) closeTagMenu();
      else openTagMenu(row.dataset.id, target);
    } else if (action === 'fold') {
      const key = target.dataset.key;
      if (expandedDone.has(key)) expandedDone.delete(key);
      else expandedDone.add(key);
      render();
    } else if (action === 'project') {
      const id = target.closest('.task-proj')?.dataset.project;
      if (!id) return;
      if (openProjects.has(id)) openProjects.delete(id);
      else {
        openProjects.add(id);
        focusKey = `${PROJECT_PREFIX}${id}`;
      }
      render();
    } else if (action === 'add-date' && form) {
      const key = form.dataset.add;
      if (picker.mode === 'add' && picker.key === key) closePicker();
      else openPicker('add', key, target);
    } else if (action === 'unparse' && form) {
      draftOf(form.dataset.add).unparsed = true;
      refreshAddRow(form.dataset.add);
      form.querySelector('.task-add-input').focus({ preventScroll: true });
    }
  });
  board.addEventListener('input', (event) => {
    const input = event.target.closest('.task-add-input');
    if (!input) return;
    const key = input.closest('.task-add').dataset.add;
    const draft = draftOf(key);
    draft.text = input.value;
    if (!input.value.trim()) draft.unparsed = false;
    refreshAddRow(key);
  });
  board.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const add = event.target.closest('.task-add-input');
    if (add) {
      const form = add.closest('.task-add');
      if (event.key === 'Enter') {
        event.preventDefault();
        if (!event.repeat) submitAdd(form.dataset.add);
      } else if (event.key === 'Tab' && !event.shiftKey) {
        event.preventDefault();
        openPicker('add', form.dataset.add, form.querySelector('.task-date'));
      }
      return;
    }
    if (event.target.closest('.task-edit') && event.key === 'Enter') {
      event.preventDefault();
      finishEdit(true);
    }
  });
  board.addEventListener('focusout', (event) => {
    if (event.target.closest('.task-edit') && editingId) finishEdit(true);
  });
  board.addEventListener('submit', (event) => event.preventDefault());

  els.search?.addEventListener('input', () => {
    query = els.search.value;
    render();
  });

  // 点到浮层外面就收起（捕获阶段：面板会阻止冒泡）。
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : document.body;
    if (!els.picker.hidden && !els.picker.contains(target) && !target.closest('[data-action="add-date"], [data-action="date"]')) closePicker();
    if (!els.tagMenu.hidden && !els.tagMenu.contains(target) && !target.closest('[data-action="tag"]')) closeTagMenu();
    if (!els.manager.hidden && !els.manager.contains(target) && !target.closest('#task-manage')) closeManager();
  }, true);

  // Esc（由主进程转发）：先收起浮层，再退出行内编辑。
  function escape() {
    if (closePicker() || closeMenus()) return true;
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

  // 跳到某一条：在今日 / 本周栏里的就在那里闪一下；只留在项目里的先把项目展开。
  async function focusItem(id) {
    const entry = find(id);
    if (typeof window.setActiveTab === 'function') await window.setActiveTab('todo');
    if (!entry) return;
    query = '';
    if (els.search) els.search.value = '';
    if (entry.item.done) {
      expandedDone.add('today');
    } else if (bucketOf(entry, Date.now()) === 'none') {
      openProjects.add(entry.categoryId);
    }
    render();
    requestAnimationFrame(() => {
      const row = board.querySelector(`.task-row[data-id="${CSS.escape(String(id))}"]`);
      if (!row) return;
      row.scrollIntoView({ block: 'nearest' });
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 1300);
    });
  }

  const withCategory = ({ item, categoryId }) => ({ ...item, categoryId });
  window.NotchTodos = {
    items: () => data,
    list: () => allEntries().map(withCategory),
    today: () => sortEntries(allEntries().filter((entry) => !entry.item.done && bucketOf(entry, Date.now()) === 'today')).map(withCategory),
    categories: () => categories.map((category) => ({ ...category })),
    dailyCategory: () => dailyId(),
    projects: () => projectList().map((category) => ({ ...category })),
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
  window.NotchTodoPage = { render, escape, state: () => ({ query, open: [...openProjects], expanded: [...expandedDone] }) };

  persist({ render: false });
  render();
})();
