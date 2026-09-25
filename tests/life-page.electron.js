const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Life page renderer timed out'); app.exit(1); }, 40000);

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
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const card = (id) => document.querySelector('.life-card[data-habit="' + id + '"]');
    await setMode(true);
    await setActiveTab('life');
    await settle(200);
    const out = {
      cards: [...document.querySelectorAll('.life-card')].map((node) => [node.querySelector('b').textContent, node.querySelector('.life-count strong').textContent, node.querySelector('.life-streak').textContent, node.querySelectorAll('.life-dot').length]),
      todayDots: document.querySelectorAll('.life-dot.today').length,
    };

    // Quick input fills the form; saving counts the run.
    card('exercise').querySelector('[data-log]').click();
    await settle();
    out.logTitle = $('life-log-title').textContent;
    const quick = $('life-log-quick');
    quick.value = '跑步 5km 32分钟';
    quick.dispatchEvent(new Event('input', { bubbles: true }));
    out.parsed = [document.querySelector('#life-log-items [aria-pressed="true"]')?.textContent, $('life-log-note').value];
    $('life-log-save').click();
    await settle();
    out.afterLog = {
      count: card('exercise').querySelector('.life-count strong').textContent,
      last: card('exercise').querySelector('.life-last').textContent,
      recent: document.querySelector('.life-row-main b')?.textContent,
      todayDot: document.querySelector('.life-day.today i b') !== null,
      popClosed: $('life-log').hidden,
    };

    // A dot on an earlier day this week: add, remove, undo.
    const past = card('exercise').querySelector('.life-dot:not(.future):not(.today)');
    out.hasPast = Boolean(past);
    if (past) {
      past.click();
      await settle();
      out.backfill = [card('exercise').querySelector('.life-count strong').textContent, $('status-toast-message').textContent];
      card('exercise').querySelector('.life-dot[data-day="' + past.dataset.day + '"]').click();
      await settle();
      out.removed = [card('exercise').querySelector('.life-count strong').textContent, $('status-toast-message').textContent];
      $('status-toast-action').click();
      await settle();
      out.undone = card('exercise').querySelector('.life-count strong').textContent;
    }

    // Reaching the weekly goal: a one-time glow and a note.
    const now = Date.now();
    while (window.NotchLifePage.state().records.filter((record) => record.habitId === 'exercise').length < 3) {
      window.NotchLifePage.addRecord({ habitId: 'exercise', at: now - 60000, item: '健身', minutes: 45, note: '' });
    }
    await settle();
    out.reached = { reached: card('exercise').classList.contains('reached'), celebrate: card('exercise').classList.contains('celebrate'), toast: $('status-toast-message').textContent, streak: card('exercise').querySelector('.life-streak').textContent };

    // Edit the newest record from the list.
    document.querySelector('.life-row-main').click();
    await settle();
    out.editTitle = $('life-log-title').textContent;
    out.deleteVisible = !$('life-log-delete').hidden;
    $('life-log-note').value = '10 组';
    $('life-log-save').click();
    await settle();
    out.edited = document.querySelector('.life-row-main b').textContent;

    // The month: click today to see that day, then back to recent.
    document.querySelector('.life-day.today').click();
    await settle();
    out.dayView = [$('life-recent-title').textContent, !$('life-recent-all').hidden];
    $('life-recent-all').click();
    await settle();
    out.backToRecent = $('life-recent-title').textContent;

    // Habit settings: raise a goal, add a habit, remove it with a second click.
    $('life-settings-open').click();
    await settle();
    out.settingsRows = document.querySelectorAll('.life-settings-row').length;
    document.querySelector('.life-settings-row[data-habit="meditate"] [data-goal="1"]').click();
    await settle();
    out.goal = document.querySelector('.life-settings-row[data-habit="meditate"] .life-goal span').textContent;
    $('life-settings-name').value = '早睡';
    $('life-settings-add').requestSubmit();
    await settle();
    out.cardsAfterAdd = [document.querySelectorAll('.life-card').length, getComputedStyle($('life-cards')).getPropertyValue('--count').trim()];
    const removeButton = document.querySelector('.life-settings-row:last-child [data-remove]');
    removeButton.click();
    out.confirmText = removeButton.textContent;
    removeButton.click();
    await settle();
    out.cardsAfterRemove = document.querySelectorAll('.life-card').length;

    // Reminder time: the queue for the next 7 days goes to main (its own list, not the timeline's).
    window.__habitQueues = [];
    window.notchAPI.scheduleHabitReminders = async (items) => { window.__habitQueues.push(items); return { ok: true }; };
    const remind = document.querySelector('.life-settings-row[data-habit="read"] [data-remind]');
    remind.value = '23:30';
    remind.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const lastQueue = () => window.__habitQueues.at(-1) || [];
    out.remind = {
      stored: JSON.parse(localStorage.getItem('notch-life-v1')).habits.find((habit) => habit.id === 'read').remindAt,
      toast: $('status-toast-message').textContent,
      queue: lastQueue().length > 0 && lastQueue().every((item) => item.habitId === 'read' && item.kind === 'habit' && item.at > Date.now()),
      note: $('life-settings-note').textContent,
    };
    // 19:00 is before 收工: only weekends until workdays are allowed.
    remind.value = '19:00';
    remind.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const weekdayCount = (queue) => queue.filter((item) => ![0, 6].includes(new Date(item.at).getDay())).length;
    out.beforeWorkdays = weekdayCount(lastQueue());
    $('life-remind-workdays').click();
    await settle();
    out.afterWorkdays = [weekdayCount(lastQueue()) > 0, JSON.parse(localStorage.getItem('notch-life-v1')).remindWorkdays, $('life-settings-note').textContent.includes('每天按时')];
    const remindAgain = document.querySelector('.life-settings-row[data-habit="read"] [data-remind]');
    remindAgain.value = '';
    remindAgain.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    out.cleared = [lastQueue().length, $('status-toast-message').textContent];

    // CSV export goes through main's save dialog.
    window.__csv = [];
    window.notchAPI.exportLifeCsv = async (csv) => { window.__csv.push(csv); return { ok: true }; };
    $('life-export').click();
    await settle();
    out.csv = [window.__csv.length, window.__csv[0]?.split('\\r\\n')[0], $('status-toast-message').textContent];

    document.querySelector('#tab-life').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    out.settingsClosed = $('life-settings').hidden;

    // 「记一笔」 on a habit reminder opens this habit's log form.
    await setActiveTab('home');
    window.__handlers.onLogHabit.forEach((callback) => callback({ habitId: 'meditate' }));
    await settle(200);
    out.fromReminder = [document.querySelector('.tab.active')?.dataset.tab, $('life-log').hidden, $('life-log-title').textContent];
    document.querySelector('#tab-life').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    out.stored = JSON.parse(localStorage.getItem('notch-life-v1')).records.length;
    out.workCalls = window.__calls.filter((call) => ['worklog', 'act', 'read-all'].includes(call[0])).length;
    const box = document.querySelector('.life-page').getBoundingClientRect();
    out.overflow = [...document.querySelectorAll('.life-card, .life-month, .life-recent, .life-day, .life-dot')].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.right > box.right + 1 || r.bottom > box.bottom + 1;
    }).map((node) => node.className);
    return out;
  })()`);

  assert.deepEqual(result.cards, [['运动', '0', '本周开始', 7], ['冥想', '0', '本周开始', 7], ['阅读', '0', '本周开始', 7]]);
  assert.equal(result.todayDots, 3);
  assert.equal(result.logTitle, '记一笔 · 运动');
  assert.deepEqual(result.parsed, ['跑步', '5km']);
  assert.equal(result.afterLog.count, '1');
  assert.match(result.afterLog.last, /^最近：今天 \d\d:\d\d 跑步 · 32 分钟 · 5km$/);
  assert.equal(result.afterLog.recent, '跑步 · 32 分钟 · 5km');
  assert.equal(result.afterLog.todayDot, true);
  assert.equal(result.afterLog.popClosed, true);
  if (result.hasPast) {
    assert.deepEqual(result.backfill, ['2', '已补记 · 运动']);
    assert.equal(result.removed[0], '1');
    assert.match(result.removed[1], /^已删除/);
    assert.equal(result.undone, '2');
  }
  assert.deepEqual([result.reached.reached, result.reached.celebrate], [true, true]);
  assert.match(result.reached.toast, /^运动本周目标达成 · 3 次$/);
  assert.equal(result.reached.streak, '连续 1 周');
  assert.equal(result.editTitle, '修改 · 运动');
  assert.equal(result.deleteVisible, true);
  assert.match(result.edited, /10 组$/);
  assert.match(result.dayView[0], /^\d+月\d+日的记录$/);
  assert.equal(result.dayView[1], true);
  assert.equal(result.backToRecent, '最近记录');
  assert.equal(result.settingsRows, 3);
  assert.equal(result.goal, '每周 6 次');
  assert.deepEqual(result.cardsAfterAdd, [4, '4']);
  assert.equal(result.confirmText, '连记录删？');
  assert.equal(result.remind.stored, '23:30');
  assert.equal(result.remind.toast, '「阅读」会在 23:30 提醒');
  assert.equal(result.remind.queue, true);
  assert.match(result.remind.note, /提醒默认只在收工（22:30）后与周末出现/);
  assert.equal(result.beforeWorkdays, 0);
  assert.deepEqual(result.afterWorkdays, [true, true, true]);
  assert.deepEqual(result.cleared, [0, '「阅读」不再提醒']);
  assert.deepEqual(result.csv, [1, '\ufeff日期,时间,习惯,项目,时长（分钟）,备注', '已导出 ' + result.stored + ' 条记录']);
  assert.deepEqual(result.fromReminder, ['life', false, '记一笔 · 冥想']);
  assert.equal(result.cardsAfterRemove, 3);
  assert.equal(result.settingsClosed, true);
  assert.ok(result.stored >= 3);
  assert.equal(result.workCalls, 0, 'life data never touches work statistics or notices');
  assert.deepEqual(result.overflow, []);

  if (process.env.SOLODOCK_LIFE_SCREENSHOT_DIR) {
    // A realistic few weeks for the screenshot.
    await win.webContents.executeJavaScript(`(() => {
      const L = window.NotchLife;
      const now = Date.now();
      const records = [];
      const plan = [['exercise', [1, 3, 5, 8, 10, 12, 15, 17, 19, 22]], ['meditate', [0, 1, 2, 4, 5, 6, 8, 9, 11, 12, 13, 15, 16]], ['read', [0, 2, 3, 6, 9, 10, 13, 16, 18]]];
      const items = { exercise: ['跑步', '健身', '骑行'], meditate: ['呼吸', '睡前冥想'], read: ['纸书', '电子书'] };
      const notes = { exercise: ['5km', '胸背', '20km'], meditate: ['', ''], read: ['三体 第 3 章', '长文章'] };
      plan.forEach(([habitId, daysAgo]) => daysAgo.forEach((ago, index) => {
        records.push({ id: habitId + index, habitId, at: now - ago * 86400000 - (index % 3) * 3600000, item: items[habitId][index % items[habitId].length], minutes: [30, 45, 20, 60][index % 4], note: notes[habitId][index % notes[habitId].length] });
      }));
      localStorage.setItem('notch-life-v1', JSON.stringify({ habits: L.normalizeLife({}).habits, records }));
      document.dispatchEvent(new CustomEvent('notch:tabchange', { detail: { tab: 'life' } }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('tab-life').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_LIFE_SCREENSHOT_DIR, 'life-page.png'), (await win.webContents.capturePage(rect)).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Life page checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
