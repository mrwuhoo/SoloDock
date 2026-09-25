const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Todo page renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1240,
    height: 616,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'panel-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Legacy data from before the redesign: P0–P3 plus renamed categories.
  const legacy = await win.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    const now = new Date();
    const at = (d, h, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, m).toISOString();
    const t = (id, text, deadline, extra = {}) => ({ id, text, deadline, done: false, createdAt: 1, remindedAt: 0, ...extra });
    const data = {
      P0: [t('overdue', '周报复盘', at(0, 0, 1)), t('future', '整理大纲', at(3, 10))],
      P1: [t('daily', '回复学员', at(0, 23, 59), { repeat: { kind: 'daily' } }), t('old', '旧任务', at(-1, 9), { done: true, completedAt: Date.now() - 3600000 })],
      P2: [t('review', '原型评审', at(0, 23, 58))],
      P3: [],
    };
    localStorage.setItem('notch-todo-data', JSON.stringify(data));
    localStorage.setItem('notch-todo-category-names-v1', JSON.stringify({ P0: '学习', P1: '写作', P2: '编程', P3: '日常' }));
    return JSON.stringify(data);
  })()`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const card = (id) => document.querySelector('.task-card[data-category="' + id + '"]');
    const row = (id) => document.querySelector('.task-row[data-id="' + id + '"]');
    const rows = (id) => [...card(id).querySelectorAll('.task-list:not(.task-done-list) .task-row .task-text')].map((node) => node.textContent);
    const stored = () => JSON.parse(localStorage.getItem('notch-todo-data'));
    const find = (text) => Object.values(stored()).flat().find((item) => item.text === text);
    const type = (input, text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
    const enter = (input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    window.notchAPI.scheduleTodoReminders = async (items) => { window.__reminders = items; return { ok: true }; };
    await setMode(true);
    await setActiveTab('todo');
    await settle(200);
    const out = {};

    // Migration: names, order and colours carried over; the old data kept for rollback.
    out.migrated = {
      categories: JSON.parse(localStorage.getItem('notch-todo-categories-v1')),
      backup: localStorage.getItem('notch-todo-data-v1-backup'),
      keys: Object.keys(stored()),
      cards: [...document.querySelectorAll('.task-card')].map((node) => [node.querySelector('.task-name').textContent, node.dataset.color]),
      grid: [getComputedStyle($('task-grid')).gridTemplateColumns.split(' ').length, getComputedStyle($('task-grid')).gridTemplateRows.split(' ').length],
    };

    // Readable time labels; old todos keep the one-hour reminder.
    out.labels = [row('overdue').querySelector('.task-time').dataset.tone, row('overdue').querySelector('.task-time').textContent, row('daily').querySelector('.task-rep') !== null];
    window.NotchTodos.setDoing('');
    await settle();
    out.leads = Object.fromEntries((window.__reminders || []).map((item) => [item.id, item.remindMin]));

    // Filters with live counts; search needs every word.
    const counts = () => [...$('task-filters').querySelectorAll('button')].map((button) => button.textContent.replace(/\\s+/g, ''));
    out.counts = counts();
    $('task-filters').querySelector('[data-filter="overdue"]').click();
    out.overdue = rows('P0');
    $('task-filters').querySelector('[data-filter="done"]').click();
    out.doneFilter = [...card('P1').querySelectorAll('.task-done-list .task-text')].map((node) => node.textContent);
    $('task-filters').querySelector('[data-filter="all"]').click();
    type($('task-search'), '大纲');
    out.search = [rows('P0'), card('P1').querySelector('.task-empty')?.textContent];
    type($('task-search'), '');
    // Completed items fold away until opened.
    out.fold = [card('P1').querySelector('.task-fold').textContent, card('P1').querySelector('.task-done-list') === null];
    card('P1').querySelector('.task-fold').click();
    out.unfolded = card('P1').querySelectorAll('.task-done-list .task-row').length;

    // Natural language in the add row: a chip, the date button follows, the date words leave the text.
    const input = card('P3').querySelector('.task-add-input');
    type(input, '明天下午3点 给会计打电话');
    out.chip = [card('P3').querySelector('.task-parse').hidden, card('P3').querySelector('.task-parse span').textContent, card('P3').querySelector('.task-date').textContent.trim()];
    enter(input);
    await settle();
    const call = find('给会计打电话');
    const due = new Date(call.deadline);
    out.added = [due.getHours(), due.getMinutes(), new Date(Date.now() + 86400000).getDate() === due.getDate(), call.remindMin, input.value, card('P3').querySelector('.task-date').textContent.trim()];
    // × keeps the words as they are.
    type(input, '周五前 交稿');
    card('P3').querySelector('[data-action="unparse"]').click();
    enter(input);
    await settle();
    out.unparsed = [Boolean(find('周五前 交稿')), find('周五前 交稿')?.deadline === new Date(window.NotchTodo.defaultDeadline()).toISOString()];
    // Tab opens the picker; Esc (forwarded by the main process) closes it first.
    type(input, '订机票');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    out.tabOpens = !$('task-picker').hidden;
    window.__handlers.onEscape.forEach((callback) => callback());
    out.escape = [$('task-picker').hidden, document.getElementById('app').classList.contains('expanded')];
    type(input, '');

    // Edit a deadline: daily repeat, no reminder, 9 o'clock.
    row('future').querySelector('.task-time').click();
    const picker = $('task-picker');
    $('task-picker-repeat').value = 'daily';
    $('task-picker-repeat').dispatchEvent(new Event('change'));
    $('task-picker-remind').value = '-1';
    $('task-picker-remind').dispatchEvent(new Event('change'));
    $('task-picker-hour').value = '9';
    $('task-picker-hour').dispatchEvent(new Event('change'));
    picker.querySelector('[data-pick="ok"]').click();
    await settle();
    const future = find('整理大纲');
    out.edited = [future.repeat, future.remindMin, new Date(future.deadline).getHours(), picker.hidden, row('future').querySelector('.task-rep') !== null];

    // Completing a repeating todo schedules the next one; undo takes both back.
    row('daily').querySelector('[data-action="toggle"]').click();
    await settle(150);
    const copies = () => Object.values(stored()).flat().filter((item) => item.text === '回复学员');
    out.repeat = [copies().length, copies().filter((item) => item.done).length, $('status-toast-message').textContent];
    $('status-toast-action').click();
    await settle();
    out.undo = [copies().length, copies()[0].done];

    // 在做: one at a time, a chip on the row and on the home card.
    row('review').querySelector('[data-action="doing"]').click();
    await settle();
    out.doing = [row('review').classList.contains('doing'), row('review').querySelector('.task-chip')?.textContent, window.NotchTodos.doing()?.text, document.querySelector('.today-item.doing .today-doing')?.textContent];
    row('daily').querySelector('[data-action="doing"]').click();
    await settle();
    out.doingSwitch = [row('review').classList.contains('doing'), window.NotchTodos.doing()?.id];
    row('daily').querySelector('[data-action="toggle"]').click();
    await settle(150);
    out.doingCleared = window.NotchTodos.doing();

    // Inline edit and delete with undo.
    row('overdue').querySelector('[data-action="edit"]').click();
    await settle();
    const edit = row('overdue').querySelector('.task-edit');
    edit.value = '周报复盘（改）';
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    out.inlineEdit = find('周报复盘（改）') !== undefined;
    row('overdue').querySelector('[data-action="delete"]').click();
    await settle();
    out.deleted = [row('overdue') === null, $('status-toast-message').textContent];
    $('status-toast-action').click();
    await settle();
    out.restored = row('overdue') !== null;

    // Rename by double click; the old name key follows for rollback.
    const name = card('P2').querySelector('.task-name');
    name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    name.textContent = 'Vibe coding';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    out.renamed = [card('P2').querySelector('.task-name').textContent, JSON.parse(localStorage.getItem('notch-todo-category-names-v1')).P2];

    // Colour from the ⋯ menu.
    card('P1').querySelector('[data-action="menu"]').click();
    $('task-menu').querySelector('.task-swatch[data-color="cat-6"]').click();
    await settle();
    out.recolored = card('P1').dataset.color;

    // Manage: add a category (3×2), remove a full one by merging, remove an empty one.
    $('task-manage').click();
    $('task-manager-name').value = '家里';
    $('task-manager-add').requestSubmit();
    await settle();
    out.fifth = [document.querySelectorAll('.task-card').length, getComputedStyle($('task-grid')).gridTemplateColumns.split(' ').length, $('task-manager-count').textContent];
    const managerRow = (id) => $('task-manager-list').querySelector('.task-manager-row[data-id="' + id + '"]');
    managerRow('P3').querySelector('[data-manage="remove"]').click();
    out.mergePrompt = managerRow('P3').querySelector('.task-manager-confirm span')?.textContent;
    managerRow('P3').querySelector('.task-manager-confirm select').value = 'P0';
    managerRow('P3').querySelector('[data-manage="merge"]').click();
    await settle();
    out.merged = [Boolean(card('P3')), stored().P0.some((item) => item.text === '给会计打电话'), $('status-toast-message').textContent];
    const home = window.NotchTodos.categories().find((category) => category.name === '家里');
    managerRow(home.id).querySelector('[data-manage="remove"]').click();
    managerRow(home.id).querySelector('[data-manage="confirm"]').click();
    await settle();
    out.afterRemove = window.NotchTodos.categories().map((category) => category.name);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    // Nothing spills out of its card.
    const page = $('task-page').getBoundingClientRect();
    out.overflow = [...document.querySelectorAll('.task-card, .task-add, .task-date')].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.right > page.right + 1 || r.bottom > page.bottom + 1;
    }).map((node) => node.className);
    return out;
  })()`);

  assert.deepEqual(result.migrated.categories, [
    { id: 'P0', name: '学习', color: 'cat-1' }, { id: 'P1', name: '写作', color: 'cat-2' }, { id: 'P2', name: '编程', color: 'cat-3' }, { id: 'P3', name: '日常', color: 'cat-4' },
  ]);
  assert.equal(result.migrated.backup, legacy, 'the old data is kept as it was');
  assert.deepEqual(result.migrated.keys, ['P0', 'P1', 'P2', 'P3']);
  assert.deepEqual(result.migrated.cards, [['学习', 'cat-1'], ['写作', 'cat-2'], ['编程', 'cat-3'], ['日常', 'cat-4']]);
  assert.deepEqual(result.migrated.grid, [2, 2]);
  assert.equal(result.labels[0], 'overdue');
  assert.match(result.labels[1], /^逾期 /);
  assert.equal(result.labels[2], true);
  assert.deepEqual([result.leads.overdue, result.leads.daily], [60, 60]);
  assert.deepEqual(result.counts, ['全部4', '今天3', '逾期1', '已完成1']);
  assert.deepEqual(result.overdue, ['周报复盘']);
  assert.deepEqual(result.doneFilter, ['旧任务']);
  assert.deepEqual(result.search, [['整理大纲'], '没有找到']);
  assert.deepEqual(result.fold, ['已完成 1', true]);
  assert.equal(result.unfolded, 1);
  assert.deepEqual(result.chip, [false, '明天 15:00', '明天 15:00']);
  assert.deepEqual(result.added.slice(0, 5), [15, 0, true, 15, '']);
  assert.match(result.added[5], /^(今天|明天) 23:30$/, 'the next one starts from the default again');
  assert.deepEqual(result.unparsed, [true, true]);
  assert.equal(result.tabOpens, true);
  assert.deepEqual(result.escape, [true, true], 'Esc closes the picker, not the panel');
  assert.deepEqual(result.edited, [{ kind: 'daily' }, -1, 9, true, true]);
  assert.deepEqual(result.repeat.slice(0, 2), [2, 1]);
  assert.equal(result.repeat[2], '已完成「回复学员」 · 已排好下一次');
  assert.deepEqual(result.undo, [1, false]);
  assert.deepEqual(result.doing, [true, '在做', '原型评审', '在做']);
  assert.deepEqual(result.doingSwitch, [false, 'daily']);
  assert.equal(result.doingCleared, null, 'finishing the 在做 todo clears it');
  assert.equal(result.inlineEdit, true);
  assert.equal(result.deleted[0], true);
  assert.match(result.deleted[1], /^已删除「周报复盘（改）」/);
  assert.equal(result.restored, true);
  assert.deepEqual(result.renamed, ['Vibe coding', 'Vibe coding']);
  assert.equal(result.recolored, 'cat-6');
  assert.deepEqual(result.fifth, [5, 3, '5 / 6']);
  assert.equal(result.mergePrompt, '2 条待办合并到');
  assert.deepEqual(result.merged, [false, true, '已删除「日常」，待办并入「学习」']);
  assert.deepEqual(result.afterRemove, ['学习', '写作', 'Vibe coding']);
  assert.deepEqual(result.overflow, []);

  if (process.env.SOLODOCK_TODO_SCREENSHOT_DIR) {
    fs.writeFileSync(path.join(process.env.SOLODOCK_TODO_SCREENSHOT_DIR, 'todo-page.png'), (await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Todo page checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
