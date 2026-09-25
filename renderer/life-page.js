// 生活页：运动、冥想、阅读等习惯的次数与坚持。数据只在 LocalStorage notch-life-v1，和工作完全分开。
(function bootstrapLifePage() {
  'use strict';

  const L = window.NotchLife;
  const get = (id) => document.getElementById(id);
  const page = get('life-page');
  if (!L || !page) return;

  const STORAGE_KEY = 'notch-life-v1';
  const WEEKDAY = '日一二三四五六';
  const pad = (value) => String(value).padStart(2, '0');
  // 习惯名、项目、备注都是用户输入：拼进 HTML 前一律转义。
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const toast = (message, options) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message, options);
  };
  const ICONS = {
    run: '<circle cx="13" cy="4.8" r="1.8"/><path d="m10 21 2.3-6.2 2.7 2.4V21M8 12.5l2.4-4.3 3.6 1.2 2 3.3M12.3 14.8 11 9.5"/>',
    lotus: '<path d="M12 19c-4 0-7-2.2-7-5 2 0 4 .8 5 2 0-3 1-6 2-8 1 2 2 5 2 8 1-1.2 3-2 5-2 0 2.8-3 5-7 5Z"/>',
    book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5v13c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5Z"/><path d="M12 6v13.5"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
    drop: '<path d="M12 3.5c3 4 5.5 7 5.5 10a5.5 5.5 0 0 1-11 0c0-3 2.5-6 5.5-10Z"/>',
    leaf: '<path d="M5.5 18.5c0-7.5 5-12 13-12 0 8-4.5 13-12 13Z"/><path d="M5.5 18.5 13 11"/>',
  };

  let state = L.normalizeLife(read());
  let viewYear = 0;
  let viewMonth = 0;
  let selectedDay = '';
  let editing = null; // { habitId, recordId }
  let form = { item: '', minutes: 0 };

  function read() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (error) {
      return null;
    }
  }

  function save(next) {
    state = L.normalizeLife(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* keep session state */ }
    render();
  }

  const habitById = (id) => state.habits.find((habit) => habit.id === id);
  const icon = (habit) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[habit.icon] || ICONS.leaf}</svg>`;

  function clock(time) {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function whenLabel(time) {
    const key = L.dayKey(time);
    const today = L.dayKey(Date.now());
    const days = Math.round((L.dayStart(today) - L.dayStart(key)) / 86400000);
    const date = new Date(time);
    if (days === 0) return `今天 ${clock(time)}`;
    if (days === 1) return `昨天 ${clock(time)}`;
    if (days < 7) return `周${WEEKDAY[date.getDay()]} ${clock(time)}`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function recordText(record) {
    const habit = habitById(record.habitId);
    return [record.item || habit?.name || '', record.minutes ? `${record.minutes} 分钟` : '', record.note].filter(Boolean).join(' · ');
  }

  // ---------------- 习惯卡 ----------------
  function renderCards() {
    const cards = get('life-cards');
    const today = L.dayKey(Date.now());
    cards.style.setProperty('--count', String(state.habits.length));
    cards.replaceChildren(...state.habits.map((habit) => {
      const week = L.habitWeek(state, habit.id);
      const streak = L.streakWeeks(state, habit.id);
      const last = state.records.find((record) => record.habitId === habit.id);
      const card = document.createElement('section');
      card.className = `tile life-card${week.reached ? ' reached' : ''}`;
      card.dataset.habit = habit.id;
      card.dataset.color = habit.color;
      card.innerHTML = `
        <header class="life-card-head"><span class="life-icon">${icon(habit)}</span><b>${esc(habit.name)}</b><span class="life-streak">${streak ? `连续 ${streak} 周` : '本周开始'}</span></header>
        <div class="life-count"><strong>${week.count}</strong><span>/ ${habit.goal} 次 · 本周</span></div>
        <div class="life-dots" role="group" aria-label="本周每天"></div>
        <footer class="life-card-foot"><span class="life-last">${last ? `最近：${whenLabel(last.at)} ${esc(recordText(last))}` : '还没有记录'}</span><button class="life-log-button" type="button" data-log="${habit.id}">记一笔</button></footer>`;
      const dots = card.querySelector('.life-dots');
      week.days.forEach((key, index) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'life-dot';
        dot.dataset.day = key;
        dot.dataset.habit = habit.id;
        if (week.doneDays.includes(key)) dot.classList.add('done');
        if (key === today) dot.classList.add('today');
        if (key > today) { dot.classList.add('future'); dot.disabled = true; }
        const label = `周${'一二三四五六日'[index]}`;
        dot.innerHTML = `<i></i><span>${'一二三四五六日'[index]}</span>`;
        dot.setAttribute('aria-label', `${label}${week.doneDays.includes(key) ? '：已做，点一下删除最近一条' : '：点一下补记'}`);
        dots.append(dot);
      });
      return card;
    }));
  }

  // 本周达标：卡片出现一次轻微的完成光效。
  function celebrate(habitId) {
    const card = get('life-cards').querySelector(`[data-habit="${habitId}"]`);
    if (!card) return;
    card.classList.add('celebrate');
    setTimeout(() => card.classList.remove('celebrate'), 1400);
  }

  function addRecord(record) {
    const before = L.habitWeek(state, record.habitId).count;
    save(L.addRecord(state, { id: `life-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...record }));
    const week = L.habitWeek(state, record.habitId);
    if (before < week.goal && week.count >= week.goal) {
      celebrate(record.habitId);
      toast(`${habitById(record.habitId)?.name}本周目标达成 · ${week.count} 次`);
    }
  }

  function removeRecord(id) {
    const before = state;
    const removed = state.records.find((record) => record.id === id);
    save(L.removeRecord(state, id));
    toast(`已删除${removed ? `「${recordText(removed)}」` : ''}`, { actionLabel: '撤销', duration: 5000, onAction: () => save(before) });
  }

  // ---------------- 月历与最近记录 ----------------
  function renderMonth() {
    get('life-month-title').textContent = `${viewYear} 年 ${viewMonth} 月`;
    const today = L.dayKey(Date.now());
    const [ty, tm] = today.split('-').map(Number);
    get('life-month-next').disabled = viewYear > ty || (viewYear === ty && viewMonth >= tm);
    const dots = L.monthDots(state, viewYear, viewMonth);
    const first = new Date(viewYear, viewMonth - 1, 1);
    const leading = (first.getDay() + 6) % 7;
    const total = new Date(viewYear, viewMonth, 0).getDate();
    const grid = get('life-grid');
    grid.replaceChildren();
    for (let index = 0; index < leading; index += 1) grid.append(Object.assign(document.createElement('span'), { className: 'life-day empty' }));
    for (let date = 1; date <= total; date += 1) {
      const key = `${viewYear}-${pad(viewMonth)}-${pad(date)}`;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'life-day';
      cell.dataset.day = key;
      if (key === today) cell.classList.add('today');
      if (key === selectedDay) cell.classList.add('selected');
      if (key > today) { cell.classList.add('future'); cell.disabled = true; }
      const ids = dots[key] || [];
      cell.innerHTML = `<span>${date}</span><i>${ids.map((id) => `<b data-color="${habitById(id)?.color || ''}"></b>`).join('')}</i>`;
      cell.setAttribute('aria-label', `${viewMonth}月${date}日${ids.length ? `：${ids.map((id) => habitById(id)?.name).join('、')}` : ''}`);
      grid.append(cell);
    }
    get('life-legend').innerHTML = state.habits.map((habit) => `<span data-color="${habit.color}"><b></b>${esc(habit.name)}</span>`).join('');
  }

  function renderRecent() {
    const list = get('life-recent-list');
    const records = selectedDay ? state.records.filter((record) => L.dayKey(record.at) === selectedDay) : state.records.slice(0, 30);
    if (selectedDay) {
      const date = new Date(L.dayStart(selectedDay));
      get('life-recent-label').textContent = '当天';
      get('life-recent-title').textContent = `${date.getMonth() + 1}月${date.getDate()}日的记录`;
    } else {
      get('life-recent-label').textContent = '最近';
      get('life-recent-title').textContent = '最近记录';
    }
    get('life-recent-all').hidden = !selectedDay;
    list.replaceChildren(...records.map((record) => {
      const habit = habitById(record.habitId);
      const row = document.createElement('div');
      row.className = 'life-row';
      row.dataset.id = record.id;
      row.dataset.color = habit?.color || '';
      row.innerHTML = `<span class="life-icon small">${habit ? icon(habit) : ''}</span><button class="life-row-main" type="button" data-edit="${record.id}"><b>${esc(recordText(record))}</b><time>${whenLabel(record.at)}</time></button><button class="life-row-delete" type="button" data-delete="${record.id}" aria-label="删除这条记录">删除</button>`;
      return row;
    }));
    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'life-empty';
      empty.innerHTML = selectedDay ? '<b>这天没有记录</b><span>在习惯卡的圆点上点一下可以补记</span>' : '<b>还没有记录</b><span>点习惯卡上的「记一笔」开始</span>';
      list.append(empty);
    }
  }

  function render() {
    renderCards();
    renderMonth();
    renderRecent();
  }

  // ---------------- 记一笔 ----------------
  const log = get('life-log');
  function positionPop(pop, anchor) {
    const box = page.getBoundingClientRect();
    const target = anchor.getBoundingClientRect();
    const width = pop.offsetWidth || 340;
    pop.style.left = `${Math.round(Math.min(Math.max(8, target.left - box.left), box.width - width - 8))}px`;
    pop.style.top = `${Math.round(Math.min(target.bottom - box.top + 6, box.height - (pop.offsetHeight || 300) - 8))}px`;
  }

  function renderChips() {
    const habit = habitById(editing.habitId);
    const items = get('life-log-items');
    items.replaceChildren(...(habit?.items || []).map((item) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.dataset.item = item;
      chip.textContent = item;
      chip.setAttribute('aria-pressed', String(form.item === item));
      return chip;
    }));
    items.hidden = !(habit?.items || []).length;
    get('life-log-minutes').querySelectorAll('[data-minutes]').forEach((chip) => {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.minutes) === form.minutes));
    });
  }

  function openLog(habitId, anchor, record = null) {
    closePops();
    editing = { habitId, recordId: record ? record.id : '' };
    form = { item: record ? record.item : '', minutes: record ? record.minutes : 0 };
    const habit = habitById(habitId);
    const time = record ? record.at : Date.now();
    get('life-log-title').textContent = record ? `修改 · ${habit?.name}` : `记一笔 · ${habit?.name}`;
    get('life-log-quick').value = '';
    get('life-log-quick').hidden = Boolean(record);
    get('life-log-day').value = String(Math.max(0, Math.min(2, Math.round((L.dayStart(L.dayKey(Date.now())) - L.dayStart(L.dayKey(time))) / 86400000))));
    get('life-log-time').value = clock(time);
    get('life-log-note').value = record ? record.note : '';
    get('life-log-delete').hidden = !record;
    log.dataset.color = habit?.color || '';
    renderChips();
    log.hidden = false;
    positionPop(log, anchor);
    (record ? get('life-log-note') : get('life-log-quick')).focus();
  }

  function closePops() {
    log.hidden = true;
    get('life-settings').hidden = true;
    editing = null;
  }

  function logTime() {
    const [hour, minute] = String(get('life-log-time').value || '').split(':').map(Number);
    const today = new Date(L.dayStart(L.dayKey(Date.now())));
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(get('life-log-day').value));
    const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Number.isFinite(hour) ? hour : 20, Number.isFinite(minute) ? minute : 0).getTime();
    // 00:00–04:00 属于前一天：记在所选那天的深夜。
    return at < L.dayStart(L.dayKey(base.getTime() + 12 * 3600_000)) ? at + 86400000 : at;
  }

  function saveLog() {
    if (!editing) return;
    const record = { habitId: editing.habitId, at: logTime(), item: form.item, minutes: form.minutes, note: get('life-log-note').value };
    const habitId = editing.habitId;
    if (editing.recordId) {
      save(L.updateRecord(state, editing.recordId, record));
      toast('已更新');
    } else {
      addRecord(record);
      toast(`已记下 · ${habitById(habitId)?.name}`);
    }
    closePops();
  }

  get('life-log-quick').addEventListener('input', (event) => {
    const parsed = L.parseLifeInput(event.target.value, state);
    if (!parsed) return;
    if (parsed.habitId !== editing?.habitId) {
      editing = { habitId: parsed.habitId, recordId: '' };
      get('life-log-title').textContent = `记一笔 · ${habitById(parsed.habitId)?.name}`;
      log.dataset.color = habitById(parsed.habitId)?.color || '';
    }
    form = { item: parsed.item, minutes: parsed.minutes };
    get('life-log-note').value = parsed.note;
    renderChips();
  });
  get('life-log-items').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-item]');
    if (!chip) return;
    form.item = form.item === chip.dataset.item ? '' : chip.dataset.item;
    renderChips();
  });
  get('life-log-minutes').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-minutes]');
    if (!chip) return;
    form.minutes = Number(chip.dataset.minutes);
    renderChips();
  });
  get('life-log-save').addEventListener('click', saveLog);
  get('life-log-cancel').addEventListener('click', closePops);
  get('life-log-delete').addEventListener('click', () => {
    const id = editing?.recordId;
    closePops();
    if (id) removeRecord(id);
  });
  log.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && event.target.tagName === 'INPUT') {
      event.preventDefault();
      saveLog();
    }
  });

  // ---------------- 页面点击 ----------------
  page.addEventListener('click', (event) => {
    const logButton = event.target.closest('[data-log]');
    if (logButton) {
      openLog(logButton.dataset.log, logButton);
      return;
    }
    const dot = event.target.closest('.life-dot:not(.future)');
    if (dot) {
      // 圆点：已做就删最近那条（可撤销），没做就补记一条（那天 20:00，可再编辑）。
      const existing = state.records.find((record) => record.habitId === dot.dataset.habit && L.dayKey(record.at) === dot.dataset.day);
      if (existing) removeRecord(existing.id);
      else {
        const [year, month, day] = dot.dataset.day.split('-').map(Number);
        addRecord({ habitId: dot.dataset.habit, at: new Date(year, month - 1, day, 20).getTime(), item: '', minutes: 0, note: '' });
        toast(`已补记 · ${habitById(dot.dataset.habit)?.name}`);
      }
      return;
    }
    const day = event.target.closest('.life-day[data-day]:not(.future)');
    if (day) {
      selectedDay = selectedDay === day.dataset.day ? '' : day.dataset.day;
      renderMonth();
      renderRecent();
      return;
    }
    const edit = event.target.closest('[data-edit]');
    if (edit) {
      const record = state.records.find((item) => item.id === edit.dataset.edit);
      if (record) openLog(record.habitId, edit, record);
      return;
    }
    const remove = event.target.closest('[data-delete]');
    if (remove) removeRecord(remove.dataset.delete);
  });
  get('life-recent-all').addEventListener('click', () => {
    selectedDay = '';
    renderMonth();
    renderRecent();
  });
  get('life-month-prev').addEventListener('click', () => goMonth(-1));
  get('life-month-next').addEventListener('click', () => goMonth(1));
  document.addEventListener('pointerdown', (event) => {
    if ((log.hidden && get('life-settings').hidden) || event.target.closest('.life-pop, [data-log], #life-settings-open')) return;
    closePops();
  });

  function goMonth(delta) {
    const date = new Date(viewYear, viewMonth - 1 + delta, 1);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth() + 1;
    selectedDay = '';
    renderMonth();
    renderRecent();
  }

  // ---------------- 习惯设置 ----------------
  const settings = get('life-settings');
  function renderSettings() {
    const list = get('life-settings-list');
    list.replaceChildren(...state.habits.map((habit) => {
      const row = document.createElement('div');
      row.className = 'life-settings-row';
      row.dataset.habit = habit.id;
      row.dataset.color = habit.color;
      row.innerHTML = `<span class="life-icon small">${icon(habit)}</span><input value="${esc(habit.name)}" maxlength="12" aria-label="习惯名称" data-rename="${habit.id}" /><div class="life-goal"><button type="button" data-goal="-1" aria-label="减少目标">−</button><span>每周 ${habit.goal} 次</span><button type="button" data-goal="1" aria-label="增加目标">+</button></div><button class="life-remove" type="button" data-remove="${habit.id}" ${state.habits.length <= 1 ? 'disabled' : ''}>移除</button>`;
      return row;
    }));
    get('life-settings-add').hidden = state.habits.length >= L.MAX_HABITS;
  }
  get('life-settings-open').addEventListener('click', (event) => {
    const wasOpen = !settings.hidden;
    closePops();
    if (wasOpen) return;
    renderSettings();
    settings.hidden = false;
    const box = page.getBoundingClientRect();
    const anchor = event.currentTarget.getBoundingClientRect();
    settings.style.left = `${Math.round(anchor.right - box.left - (settings.offsetWidth || 360))}px`;
    settings.style.top = `${Math.round(anchor.bottom - box.top + 6)}px`;
  });
  settings.addEventListener('click', (event) => {
    const goal = event.target.closest('[data-goal]');
    if (goal) {
      const id = goal.closest('[data-habit]').dataset.habit;
      save(L.updateHabit(state, id, { goal: habitById(id).goal + Number(goal.dataset.goal) }));
      renderSettings();
      return;
    }
    const remove = event.target.closest('[data-remove]');
    if (remove) {
      // 移除会连同记录一起删：点两次确认。
      if (remove.dataset.confirm !== 'true') {
        remove.dataset.confirm = 'true';
        remove.textContent = '连记录一起删？';
        setTimeout(() => { if (remove.isConnected) { delete remove.dataset.confirm; remove.textContent = '移除'; } }, 3000);
        return;
      }
      const name = habitById(remove.dataset.remove)?.name;
      save(L.removeHabit(state, remove.dataset.remove));
      renderSettings();
      toast(`已移除「${name}」`);
    }
  });
  settings.addEventListener('change', (event) => {
    const input = event.target.closest('[data-rename]');
    if (input && input.value.trim()) save(L.updateHabit(state, input.dataset.rename, { name: input.value }));
  });
  get('life-settings-add').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = get('life-settings-name').value.trim();
    if (!name) return;
    save(L.addHabit(state, name));
    get('life-settings-name').value = '';
    renderSettings();
  });

  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'life') {
      state = L.normalizeLife(read());
      render();
    } else {
      closePops();
    }
  });

  const today = L.dayKey(Date.now()).split('-').map(Number);
  viewYear = today[0];
  viewMonth = today[1];
  render();

  window.NotchLifePage = { render, state: () => L.normalizeLife(state), openLog, addRecord };
})();
