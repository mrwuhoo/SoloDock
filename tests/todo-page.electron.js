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
  // Legacy data from before the redesign: P0–P3 plus renamed categories. P0–P2 become projects, P3 the daily one.
  const legacy = await win.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    const now = new Date();
    const at = (d, h, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, m).toISOString();
    const t = (id, text, deadline, extra = {}) => ({ id, text, deadline, done: false, createdAt: 1, remindedAt: 0, ...extra });
    const data = {
      P0: [t('overdue', '周报复盘', at(0, 0, 1)), t('future', '整理大纲', at(3, 10)), t('step', '做封面', '')],
      P1: [t('daily', '回复学员', at(0, 23, 59), { repeat: { kind: 'daily' } }), t('old', '旧任务', at(-1, 9), { done: true, completedAt: Date.now() - 3600000 }), t('later', '下个月的选题', at(10, 10))],
      P2: [t('review', '原型评审', at(0, 23, 58))],
      P3: [t('chore', '家里的杂事', '', { createdAt: 2 })],
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
    const col = (key) => document.querySelector('.task-col[data-col="' + key + '"]');
    const proj = (id) => document.querySelector('.task-proj[data-project="' + id + '"]');
    const rowsIn = (node) => [...node.querySelectorAll('.task-list:not(.task-done-list) .task-row .task-text')].map((el) => el.textContent);
    const rows = (key) => rowsIn(col(key));
    const row = (id, scope = document) => scope.querySelector('.task-row[data-id="' + id + '"]');
    const rowsOf = (id) => [...document.querySelectorAll('.task-row[data-id="' + id + '"]')];
    const addRow = (key) => document.querySelector('.task-add[data-add="' + key + '"]');
    const stored = () => JSON.parse(localStorage.getItem('notch-todo-data'));
    const entries = () => Object.entries(stored()).flatMap(([categoryId, items]) => items.map((item) => ({ ...item, categoryId })));
    const find = (text) => entries().find((item) => item.text === text);
    const type = (input, text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
    const enter = (input) => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const drag = (fromId, zone) => {
      const transfer = new DataTransfer();
      row(fromId).dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const over = zone.classList.contains('over');
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      $('task-board').dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }));
      return over;
    };
    window.notchAPI.scheduleTodoReminders = async (items) => { window.__reminders = items; return { ok: true }; };
    await setMode(true);
    await setActiveTab('todo');
    await settle(200);
    const T = window.NotchTodo;
    const out = {};

    // Migration: names, order and colours carried over, P3 flagged daily; the old data kept for rollback.
    out.migrated = {
      categories: JSON.parse(localStorage.getItem('notch-todo-categories-v1')),
      backup: localStorage.getItem('notch-todo-data-v1-backup'),
      keys: Object.keys(stored()),
      columns: [...document.querySelectorAll('.task-col')].map((node) => node.dataset.col),
      projects: [...document.querySelectorAll('.task-proj')].map((node) => [node.querySelector('.task-proj-name').textContent, node.dataset.color, node.dataset.open, node.querySelector('.task-proj-fact').textContent]),
      daily: window.NotchTodos.dailyCategory(),
    };

    // Where things sit: overdue and today in 今日 (undated daily todo last), tomorrow onwards in 本周, undated steps only inside their project.
    out.today = rows('today');
    out.week = rows('week');
    out.divider = [col('week').querySelector('.task-divider')?.textContent || '', [find('整理大纲'), find('下个月的选题')].map((item) => T.beyondThisWeek(item.deadline, Date.now()))];
    out.tags = [row('overdue').querySelector('.task-tag span')?.textContent, row('chore').querySelector('.task-tag') === null];
    out.stepHidden = [rowsOf('step').length, row('chore').querySelector('.task-time').dataset.tone, row('chore').querySelector('.task-time').textContent];
    out.counts = [col('today').querySelector('.task-count').textContent, col('week').querySelector('.task-count').textContent, col('projects').querySelector('.task-count').textContent];
    out.todayApi = window.NotchTodos.today().map((item) => item.text);

    // Readable time labels; old todos keep the one-hour reminder.
    out.labels = [row('overdue').querySelector('.task-time').dataset.tone, row('overdue').querySelector('.task-time').textContent, row('daily').querySelector('.task-rep') !== null];
    window.NotchTodos.setDoing('');
    await settle();
    out.leads = Object.fromEntries((window.__reminders || []).map((item) => [item.id, item.remindMin]));

    // Search looks through every column and opens the projects that match.
    type($('task-search'), '大纲');
    out.search = [rows('today'), col('today').querySelector('.task-empty')?.textContent, rows('week'), proj('P0').dataset.open, rowsIn(proj('P0')), proj('P1').dataset.open];
    type($('task-search'), '');
    // Completed items fold away under 今日 until opened.
    out.fold = [col('today').querySelector('.task-fold').textContent, col('today').querySelector('.task-done-list') === null];
    col('today').querySelector('.task-fold').click();
    await settle();
    out.unfolded = col('today').querySelectorAll('.task-done-list .task-row').length;

    // 今日 add row: a date in the text moves the todo to 本周 (with a hint); no date means no deadline, no pressure.
    const todayInput = addRow('today').querySelector('.task-add-input');
    type(todayInput, '明天下午3点 给会计打电话');
    out.chip = [addRow('today').querySelector('.task-parse').hidden, addRow('today').querySelector('.task-parse span').textContent, addRow('today').querySelector('.task-date').textContent.trim(), addRow('today').querySelector('.task-date').dataset.moves];
    enter(todayInput);
    await settle();
    const call = find('给会计打电话');
    const due = new Date(call.deadline);
    out.added = [call.categoryId, due.getHours(), due.getMinutes(), new Date(Date.now() + 86400000).getDate() === due.getDate(), call.remindMin, todayInput.value, addRow('today').querySelector('.task-date').textContent.trim(), rows('week').includes('给会计打电话'), addRow('today').querySelector('.task-parse').hidden];
    type(todayInput, '买猫粮');
    enter(todayInput);
    await settle();
    out.undated = [find('买猫粮').categoryId, find('买猫粮').deadline, rows('today').at(-1), row(find('买猫粮').id).querySelector('.task-time').dataset.tone, window.NotchTodos.today().some((item) => item.text === '买猫粮')];
    // × keeps the words as they are.
    type(todayInput, '周五前 交稿');
    addRow('today').querySelector('[data-action="unparse"]').click();
    out.unparseChip = addRow('today').querySelector('.task-parse').hidden;
    enter(todayInput);
    await settle();
    out.unparsed = [Boolean(find('周五前 交稿')), find('周五前 交稿')?.deadline];
    // Tab opens the picker; Esc (forwarded by the main process) closes it first.
    type(todayInput, '订机票');
    todayInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    out.tabOpens = [!$('task-picker').hidden, $('task-picker').querySelector('[data-pick="clear"]').textContent];
    window.__handlers.onEscape.forEach((callback) => callback());
    out.escape = [$('task-picker').hidden, document.getElementById('app').classList.contains('expanded')];
    type(todayInput, '');

    // 本周 add row: Sunday 23:30 by default; a time in the text sends it to 今日 instead.
    const weekInput = addRow('week').querySelector('.task-add-input');
    const weekEnd = new Date(T.weekEndDeadline(Date.now())).toISOString();
    out.weekDefault = addRow('week').querySelector('.task-date').textContent.trim() === T.shortDate(T.weekEndDeadline(Date.now()), Date.now());
    type(weekInput, '交房租');
    enter(weekInput);
    await settle();
    out.weekAdded = [find('交房租').categoryId, find('交房租').deadline === weekEnd, rows('week').includes('交房租')];
    type(weekInput, '半小时后 打电话给妈妈');
    out.weekPeek = [addRow('week').querySelector('.task-date').textContent.trim().endsWith(' → 今日'), addRow('week').querySelector('.task-date').dataset.moves];
    enter(weekInput);
    await settle();
    out.weekToToday = [rows('today').includes('打电话给妈妈'), rows('week').includes('打电话给妈妈')];

    // Projects: click to unfold, add a step inside; it stays out of 今日 / 本周 unless it has a date.
    proj('P0').querySelector('.task-proj-head').click();
    await settle();
    out.opened = [proj('P0').dataset.open, document.activeElement === addRow('proj:P0')?.querySelector('.task-add-input'), rowsIn(proj('P0')), addRow('proj:P0').querySelector('.task-date').textContent.trim()];
    const stepInput = addRow('proj:P0').querySelector('.task-add-input');
    type(stepInput, '整理会员方案');
    enter(stepInput);
    await settle();
    const plan = find('整理会员方案');
    out.step = [plan.categoryId, plan.deadline, rowsOf(plan.id).length, Boolean(row(plan.id, proj('P0'))), rows('today').includes('整理会员方案')];
    type(addRow('proj:P0').querySelector('.task-add-input'), '明天 做脚本');
    out.stepPeek = [addRow('proj:P0').querySelector('.task-date').textContent.trim(), addRow('proj:P0').querySelector('.task-date').title.includes(' · 也会排进本周计划 · ')];
    enter(addRow('proj:P0').querySelector('.task-add-input'));
    await settle();
    const script = find('做脚本');
    out.datedStep = [script.categoryId, new Date(script.deadline).getHours(), rowsOf(script.id).length, rows('week').includes('做脚本'), row(script.id, col('week')).querySelector('.task-tag span').textContent, row(script.id, proj('P0')).querySelector('.task-tag') === null];

    // The project tag on a 今日 / 本周 row switches the project or hands the todo back to daily.
    row(script.id, col('week')).querySelector('.task-tag').click();
    out.tagMenu = [!$('task-tagmenu').hidden, [...$('task-tagmenu').querySelectorAll('button')].map((button) => button.textContent), $('task-tagmenu').querySelector('[aria-checked="true"]')?.dataset.tag];
    $('task-tagmenu').querySelector('[data-tag="P1"]').click();
    await settle();
    out.retagged = [find('做脚本').categoryId, row(script.id, col('week')).querySelector('.task-tag span').textContent];
    row(script.id, col('week')).querySelector('.task-tag').click();
    $('task-tagmenu').querySelector('[data-tag=""]').click();
    await settle();
    out.backToDaily = [find('做脚本').categoryId, row(script.id, col('week')).querySelector('.task-tag') === null];

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
    // 「不定时间」 takes a project step out of 今日 and leaves it in the project only.
    row('review').querySelector('.task-time').click();
    out.clearLabel = picker.querySelector('[data-pick="clear"]').textContent;
    picker.querySelector('[data-pick="clear"]').click();
    await settle();
    out.cleared = [find('原型评审').deadline, rows('today').includes('原型评审'), proj('P2').querySelector('.task-proj-fact').textContent, rowsOf('review').length];

    // Completing a repeating todo schedules the next one; undo takes both back.
    row('daily').querySelector('[data-action="toggle"]').click();
    await settle(150);
    const copies = () => entries().filter((item) => item.text === '回复学员');
    out.repeat = [copies().length, copies().filter((item) => item.done).length, $('status-toast-message').textContent];
    $('status-toast-action').click();
    await settle();
    out.undo = [copies().length, copies()[0].done];

    // 在做: an undated step becomes today's first row with a chip, and the home 「现在」 task.
    proj('P2').querySelector('.task-proj-head').click();
    await settle();
    row('review', proj('P2')).querySelector('[data-action="doing"]').click();
    await settle();
    out.doing = [rows('today')[0], row('review', col('today')).classList.contains('doing'), row('review', col('today')).querySelector('.task-chip')?.textContent, window.NotchTodos.doing()?.text, document.getElementById('now-task-title')?.textContent];
    row('daily').querySelector('[data-action="doing"]').click();
    await settle();
    out.doingSwitch = [rows('today').includes('原型评审'), window.NotchTodos.doing()?.id];
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

    // Drag: a daily todo into 本周 (Sunday 23:30), never into a project; a step into 今日 keeps its clock; a step onto a project loses its date.
    out.dragWeek = [drag('chore', col('week')), find('家里的杂事').deadline === weekEnd, rows('week').includes('家里的杂事'), document.querySelector('.over') === null];
    out.dragRefused = [drag('chore', proj('P0')), find('家里的杂事').categoryId];
    const futureClock = new Date(find('整理大纲').deadline);
    out.dragToday = [drag('future', col('today')), rows('today').includes('整理大纲'), [new Date(find('整理大纲').deadline).getDate(), new Date(find('整理大纲').deadline).getHours()], futureClock.getHours()];
    out.dragProject = [drag('future', proj('P1')), find('整理大纲').categoryId, find('整理大纲').deadline, find('整理大纲').repeat, proj('P1').dataset.open, rowsOf('future').length, Boolean(row('future', proj('P1')))];

    // Manage projects: add one, merge a full one into daily, remove an empty one; the daily category is never listed.
    $('task-manage').click();
    out.managerCount = [$('task-manager-count').textContent, $('task-manager-list').querySelectorAll('.task-manager-row').length, $('task-manager-list').querySelector('.task-manager-row[data-id="P3"]') === null];
    $('task-manager-name').value = 'YouTube 变现';
    $('task-manager-add').requestSubmit();
    await settle();
    out.fourth = [document.querySelectorAll('.task-proj').length, $('task-manager-count').textContent, [...document.querySelectorAll('.task-proj-name')].at(-1).textContent];
    const managerRow = (id) => $('task-manager-list').querySelector('.task-manager-row[data-id="' + id + '"]');
    managerRow('P1').querySelector('[data-manage="remove"]').click();
    const select = managerRow('P1').querySelector('.task-manager-confirm select');
    out.mergePrompt = [managerRow('P1').querySelector('.task-manager-confirm span')?.textContent, [...select.options].map((option) => option.textContent)];
    select.value = 'P3';
    managerRow('P1').querySelector('[data-manage="merge"]').click();
    await settle();
    out.merged = [proj('P1') === null, stored().P3.some((item) => item.text === '整理大纲'), $('status-toast-message').textContent, rows('today').includes('整理大纲')];
    const tube = window.NotchTodos.projects().find((category) => category.name === 'YouTube 变现');
    managerRow(tube.id).querySelector('[data-manage="remove"]').click();
    managerRow(tube.id).querySelector('[data-manage="confirm"]').click();
    await settle();
    out.afterRemove = [window.NotchTodos.projects().map((category) => category.name), window.NotchTodos.categories().map((category) => category.name)];
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    // Nothing spills out of the page.
    const page = $('task-page').getBoundingClientRect();
    out.overflow = [...document.querySelectorAll('.task-col, .task-add, .task-date, .task-proj')].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.right > page.right + 1 || (!node.classList.contains('task-proj') && r.bottom > page.bottom + 1);
    }).map((node) => node.className);
    return out;
  })()`);

  assert.deepEqual(result.migrated.categories, [
    { id: 'P0', name: '学习', color: 'cat-1' }, { id: 'P1', name: '写作', color: 'cat-2' }, { id: 'P2', name: '编程', color: 'cat-3' }, { id: 'P3', name: '日常', color: 'cat-4', daily: true },
  ]);
  assert.equal(result.migrated.backup, legacy, 'the old data is kept as it was');
  assert.deepEqual(result.migrated.keys, ['P0', 'P1', 'P2', 'P3']);
  assert.deepEqual(result.migrated.columns, ['today', 'week', 'projects']);
  assert.deepEqual(result.migrated.projects, [['学习', 'cat-1', 'false', '3 步'], ['写作', 'cat-2', 'false', '2 步 · 完成 1'], ['编程', 'cat-3', 'false', '1 步']], 'every project listed, all folded');
  assert.equal(result.migrated.daily, 'P3');
  assert.deepEqual(result.today, ['周报复盘', '原型评审', '回复学员', '家里的杂事']);
  assert.deepEqual(result.week, ['整理大纲', '下个月的选题']);
  assert.equal(result.divider[0], result.divider[1].some(Boolean) ? '下周起' : '', 'dates after this Sunday sit under a divider');
  assert.deepEqual(result.tags, ['学习', true], 'project steps carry the project name; daily todos carry nothing');
  assert.deepEqual(result.stepHidden, [0, 'empty', '定时间'], 'an undated step is only inside its project');
  assert.deepEqual(result.counts, ['4 件', '2 件', '3 个']);
  assert.deepEqual(result.todayApi, ['周报复盘', '原型评审', '回复学员', '家里的杂事']);
  assert.equal(result.labels[0], 'overdue');
  assert.match(result.labels[1], /^逾期 /);
  assert.equal(result.labels[2], true);
  assert.deepEqual([result.leads.overdue, result.leads.daily], [60, 60]);
  assert.deepEqual(result.search, [[], '没有找到', ['整理大纲'], 'true', ['整理大纲'], 'false']);
  assert.deepEqual(result.fold, ['已完成 1', true]);
  assert.equal(result.unfolded, 1);
  assert.deepEqual(result.chip, [false, '明天 15:00', '明天 15:00 → 本周', 'true']);
  assert.deepEqual(result.added, ['P3', 15, 0, true, 15, '', '定时间', true, true], 'home-style input lands in the daily category, the date button resets');
  assert.deepEqual(result.undated, ['P3', '', '买猫粮', 'empty', true]);
  assert.equal(result.unparseChip, true);
  assert.deepEqual(result.unparsed, [true, '']);
  assert.deepEqual(result.tabOpens, [true, '清除']);
  assert.deepEqual(result.escape, [true, true], 'Esc closes the picker, not the panel');
  assert.equal(result.weekDefault, true, 'the week column starts from Sunday 23:30');
  assert.deepEqual(result.weekAdded, ['P3', true, true]);
  assert.deepEqual(result.weekPeek, [true, 'true']);
  assert.deepEqual(result.weekToToday, [true, false]);
  assert.deepEqual(result.opened, ['true', true, ['周报复盘', '整理大纲', '做封面'], '定时间']);
  assert.deepEqual(result.step, ['P0', '', 1, true, false], 'a new step without a date stays in the project');
  assert.deepEqual(result.stepPeek, ['明天 23:30 → 本周', true]);
  assert.deepEqual(result.datedStep, ['P0', 23, 2, true, '学习', true], 'a dated step shows in 本周 with its tag and inside the project without one');
  assert.deepEqual(result.tagMenu, [true, ['学习', '写作', '编程', '退回日常，不属于项目'], 'P0']);
  assert.deepEqual(result.retagged, ['P1', '写作']);
  assert.deepEqual(result.backToDaily, ['P3', true]);
  assert.deepEqual(result.edited, [{ kind: 'daily' }, -1, 9, true, true]);
  assert.equal(result.clearLabel, '不定时间');
  assert.deepEqual(result.cleared, ['', false, '1 步', 0]);
  assert.deepEqual(result.repeat.slice(0, 2), [2, 1]);
  assert.equal(result.repeat[2], '已完成「回复学员」 · 已排好下一次');
  assert.deepEqual(result.undo, [1, false]);
  assert.deepEqual(result.doing, ['原型评审', true, '在做', '原型评审', '原型评审']);
  assert.deepEqual(result.doingSwitch, [false, 'daily'], 'without 在做 the undated step leaves 今日 again');
  assert.equal(result.doingCleared, null, 'finishing the 在做 todo clears it');
  assert.equal(result.inlineEdit, true);
  assert.equal(result.deleted[0], true);
  assert.match(result.deleted[1], /^已删除「周报复盘（改）」/);
  assert.equal(result.restored, true);
  assert.deepEqual(result.dragWeek, [true, true, true, true]);
  assert.deepEqual(result.dragRefused, [false, 'P3'], 'daily todos never enter a project');
  assert.equal(result.dragToday[0], true);
  assert.equal(result.dragToday[1], true);
  assert.equal(result.dragToday[2][0], new Date().getDate());
  assert.equal(result.dragToday[2][1], new Date().getHours() < 9 ? 9 : 23, 'the clock is kept when it is still ahead, otherwise 23:30');
  assert.deepEqual(result.dragProject, [true, 'P1', '', undefined, 'true', 1, true], 'dropping on a project puts the step back in it, undated');
  assert.deepEqual(result.managerCount, ['3 / 5', 3, true]);
  assert.deepEqual(result.fourth, [4, '4 / 5', 'YouTube 变现']);
  assert.deepEqual(result.mergePrompt, ['5 条待办并到', ['学习', '编程', 'YouTube 变现', '日常（今日 / 本周）']]);
  assert.deepEqual(result.merged, [true, true, '已删除「写作」，待办并入「日常」', true], 'a dated step handed to daily shows in 今日 without a tag');
  assert.deepEqual(result.afterRemove, [['学习', '编程'], ['学习', '编程', '日常']]);
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
