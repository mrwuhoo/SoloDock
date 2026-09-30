const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Body settings renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    let body = { sit: { enabled: true, minutes: 50 }, eye: { enabled: false, minutes: 20 }, offwork: { enabled: true, time: '22:30' } };
    window.__patches = []; window.__focus = []; window.__info = [];
    window.notchAPI = {
      getAppSettings: async () => ({ features: {}, body }),
      setBodySettings: async (patch) => {
        window.__patches.push(patch);
        body = { sit: { ...body.sit, ...(patch.sit || {}) }, eye: { ...body.eye, ...(patch.eye || {}) }, offwork: { ...body.offwork, ...(patch.offwork || {}) } };
        return { ok: true, body };
      },
      setFocusState: (state) => window.__focus.push(state),
      notifyPomodoro: async () => ({ ok: true }),
      notifyReminderInfo: async (info) => { window.__info.push(info); return true; },
      scheduleTodoReminders: async () => ({ ok: true }),
    };
    await setMode(true);
    await setActiveTab('settings');
    await window.NotchBodySettings.load();
    const out = {
      initial: [$('settings-body-sit').checked, $('settings-body-eye').checked, $('settings-body-offwork').checked, $('settings-body-sit-minutes').value, $('settings-body-offwork-time').value],
      sitHint: $('settings-body-sit-hint').textContent,
    };
    $('settings-body-eye').checked = true;
    $('settings-body-eye').dispatchEvent(new Event('change', { bubbles: true }));
    $('settings-body-sit-minutes').value = '45';
    $('settings-body-sit-minutes').dispatchEvent(new Event('change', { bubbles: true }));
    $('settings-body-offwork-time').value = '21:45';
    $('settings-body-offwork-time').dispatchEvent(new Event('change', { bubbles: true }));
    $('settings-body-offwork').checked = false;
    $('settings-body-offwork').dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    out.patches = window.__patches;
    out.after = { sitHint: $('settings-body-sit-hint').textContent, offworkHint: $('settings-body-offwork-hint').textContent, timeDisabled: $('settings-body-offwork-time').disabled };

    // "休息 5 分钟" from a reminder: the home card shows a break, and the main process hears it is not focus.
    await setActiveTab('home');
    window.NotchPomodoro.start(300, 'break');
    await settle();
    const card = $('home-now');
    out.breakCard = { state: card.dataset.state, label: $('now-label').textContent, finish: $('now-finish').textContent };
    out.focusReports = window.__focus.map((state) => [state.running, state.mode, state.endsAt > Date.now()]);
    $('now-finish').click();
    await settle();
    out.afterReset = { state: card.dataset.state, label: $('now-label').textContent, last: window.__focus.at(-1) };

    // "待办挪到明天" moves today's and overdue undone todos, keeping the clock time.
    const today = new Date();
    const at = (dayOffset, hour) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayOffset, hour, 30).toISOString();
    const data = window.NotchTodos.items();
    data.P0.push({ id: 'due-today', text: '交付', done: false, createdAt: 1, deadline: at(0, 18), remindedAt: 5 });
    data.P1.push({ id: 'overdue', text: '回复', done: false, createdAt: 1, deadline: at(-2, 9), remindedAt: 0 });
    data.P2.push({ id: 'done', text: '已完成', done: true, createdAt: 1, deadline: at(0, 10), remindedAt: 0 });
    data.P3.push({ id: 'later', text: '下周', done: false, createdAt: 1, deadline: at(3, 11), remindedAt: 0 });
    const moved = window.NotchReminderActions.moveDueTodosToTomorrow();
    const find = (id) => ['P0', 'P1', 'P2', 'P3'].flatMap((key) => data[key]).find((todo) => todo.id === id);
    out.moved = { count: moved, today: find('due-today').deadline === at(1, 18), overdue: find('overdue').deadline === at(1, 9), untouched: find('done').deadline === at(0, 10) && find('later').deadline === at(3, 11), reminded: find('due-today').remindedAt };
    out.completed = [window.NotchReminderActions.completeTodoById('due-today'), find('due-today').done, window.NotchReminderActions.completeTodoById('due-today')];
    return out;
  })()`);

  assert.deepEqual(result.initial, [true, false, true, '50', '22:30']);
  assert.equal(result.sitHint, '连续用电脑 50 分钟，提醒起来活动');
  assert.deepEqual(result.patches, [{ eye: { enabled: true } }, { sit: { minutes: 45 } }, { offwork: { time: '21:45' } }, { offwork: { enabled: false } }]);
  assert.deepEqual(result.after, { sitHint: '连续用电脑 45 分钟，提醒起来活动', offworkHint: '21:45 还在用电脑时，提醒把剩下的挪到明天', timeDisabled: true });
  assert.deepEqual(result.breakCard, { state: 'break', label: '休息中', finish: '结束休息' });
  assert.deepEqual(result.focusReports, [[true, 'break', true]]);
  assert.deepEqual(result.afterReset, { state: 'idle', label: '现在', last: { running: false, mode: 'focus', endsAt: 0 } });
  assert.deepEqual(result.moved, { count: 2, today: true, overdue: true, untouched: true, reminded: 0 });
  assert.deepEqual(result.completed, [true, true, false], 'completing twice does not reopen the todo');

  if (process.env.SOLODOCK_BODY_SCREENSHOT_DIR) {
    await win.webContents.executeJavaScript(`(async () => { await setActiveTab('settings'); document.getElementById('settings-body-card').scrollIntoView({ block: 'start' }); })()`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('settings-body-card').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_BODY_SCREENSHOT_DIR, 'body-settings.png'), (await win.webContents.capturePage(rect)).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Body settings checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
