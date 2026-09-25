const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { reminderPresentation } = require('../reminder-rules');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Notification renderer timed out'); app.exit(1); }, 40000);

// The same shape the main process sends: copy + reminder-rules presentation.
const payload = (source, title, detail, extra = {}) => ({
  eventId: `${source}-1`, source, title, detail, ...reminderPresentation(source), style: reminderPresentation(source).style || 'standard', ...extra,
});
// Window sizes from main.js: 436 wide; 172 tall with buttons, 134 without.
const sizeFor = (data) => ({ width: 436, height: data.actions.length ? 172 : 134 });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 436,
    height: 172,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'notification-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'notification.html'));

  const show = async (data) => {
    win.setContentSize(sizeFor(data).width, sizeFor(data).height);
    return win.webContents.executeJavaScript(`(async () => {
      window.NotchNotification.show(${JSON.stringify(data)});
      await new Promise((resolve) => setTimeout(resolve, 600));
      const shell = document.getElementById('notification-shell');
      const card = shell.getBoundingClientRect();
      const glyph = shell.querySelector('.notification-glyph[data-glyph="' + shell.dataset.glyph + '"]');
      const actions = [...document.querySelectorAll('.notification-action')];
      const inside = (node) => {
        const r = node.getBoundingClientRect();
        return r.left >= card.left && r.right <= card.right - 8 && r.bottom <= card.bottom - 8;
      };
      return {
        glyph: shell.dataset.glyph,
        glyphVisible: Number(getComputedStyle(glyph).opacity) === 1,
        actions: actions.map((button) => [button.textContent, button.classList.contains('primary') ? 'primary' : button.classList.contains('quiet') ? 'quiet' : 'secondary']),
        actionsHidden: document.getElementById('notification-actions').hidden,
        actionsInside: actions.every(inside),
        actionsAlignWithText: actions.length ? Math.abs(actions[0].getBoundingClientRect().left - document.getElementById('notification-title').getBoundingClientRect().left) < 1 : true,
        ring: getComputedStyle(shell.querySelector('.notification-ring')).display,
        countdown: document.getElementById('notification-countdown').textContent,
        source: document.getElementById('notification-source').textContent,
        meta: document.getElementById('notification-queue').textContent,
        cardWidth: Math.round(card.width),
        cardFits: card.top >= 6 && card.bottom <= window.innerHeight - 30 && card.left >= 20 && card.right <= window.innerWidth - 20,
        tint: getComputedStyle(shell).getPropertyValue('--tint').trim(),
      };
    })()`);
  };
  const shot = async (name, data) => {
    if (!process.env.SOLODOCK_NOTIFICATION_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 1400)); // let the sheen finish
    const { width, height } = sizeFor(data);
    fs.writeFileSync(path.join(process.env.SOLODOCK_NOTIFICATION_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage({ x: 0, y: 0, width, height })).toPNG());
  };

  const pomodoroData = payload('pomodoro', '专注完成 · 25 分钟', '25 分钟专注完成，休息一下吧');
  const pomodoro = await show(pomodoroData);
  assert.deepEqual(pomodoro.actions, [['休息 5 分钟', 'primary'], ['再专注 5 分钟', 'secondary'], ['跳过', 'quiet']]);
  assert.equal(pomodoro.glyph, 'timer');
  assert.equal(pomodoro.glyphVisible, true);
  assert.equal(pomodoro.actionsInside, true);
  assert.equal(pomodoro.actionsAlignWithText, true, 'buttons line up with the text column');
  assert.equal(pomodoro.cardFits, true);
  assert.ok(pomodoro.cardWidth >= 292 && pomodoro.cardWidth <= 380, `card width ${pomodoro.cardWidth}`);
  assert.equal(pomodoro.source, '专注');
  assert.equal(pomodoro.meta, '刚刚');
  assert.equal(pomodoro.ring, 'none');
  await shot('pomodoro', pomodoroData);
  const clicked = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-action-id="focus-5"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { calls: window.__calls.filter((call) => call[0] === 'action'), disabled: [...document.querySelectorAll('.notification-action')].every((button) => button.disabled) };
  })()`);
  assert.deepEqual(clicked, { calls: [['action', 'pomodoro-1', 'focus-5']], disabled: true });

  const sitData = payload('sit', '起来活动一下', '已经连续用电脑 50 分钟，站起来走走、喝口水');
  const sit = await show(sitData);
  assert.equal(sit.glyph, 'walk');
  assert.deepEqual(sit.actions, [['休息 5 分钟', 'primary'], ['10 分钟后', 'secondary'], ['今天不再提醒', 'quiet']]);
  assert.equal(sit.actionsInside, true, 'three buttons fit inside the card');
  assert.equal(sit.cardFits, true);
  assert.equal(sit.tint, '#2e9a6a', 'health reminders use the success tint');
  await shot('sit', sitData);

  const eyeData = payload('eye', '看看远处 20 秒', '眨眨眼，让眼睛歇一会儿');
  const eye = await show(eyeData);
  assert.deepEqual([eye.actionsHidden, eye.ring, eye.countdown, eye.cardFits], [true, 'block', '20', true]);
  await shot('eye', eyeData);

  const offworkData = payload('offwork', '到收工时间了', '22:30 · 把剩下的挪到明天，早点休息');
  const offwork = await show(offworkData);
  assert.deepEqual(offwork.actions, [['待办挪到明天', 'primary'], ['再工作 30 分钟', 'secondary']]);
  assert.equal(offwork.glyph, 'moon');
  await shot('offwork', offworkData);

  const todoData = payload('todo', '交付封面终稿', '将在 1 小时内截止 · 自媒体&写作', { eventId: 'todo-1', pendingCount: 2 });
  const todo = await show(todoData);
  assert.equal(todo.glyph, 'clock');
  assert.equal(todo.meta, '还有 2 条');
  assert.equal(todo.tint, '#c7841f', 'a due todo uses the warning tint');
  assert.equal(await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.notification-stack')).opacity`), '1', 'a second card peeks out below');
  await shot('todo', todoData);
  const todoClick = await win.webContents.executeJavaScript(`(async () => {
    window.__calls.length = 0;
    document.getElementById('notification-body').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return window.__calls;
  })()`);
  assert.deepEqual(todoClick, [['action', 'todo-1', 'open-todo']], 'clicking a todo reminder opens the todo page');

  const codexData = payload('codex', '重构用量卡片', '已完成 · SoloDock', { eventId: 'codex-1' });
  const codex = await show(codexData);
  assert.deepEqual(codex.actions, [['跳回窗口', 'primary'], ['稍后提醒', 'secondary']]);
  await shot('codex', codexData);
  const codexClick = await win.webContents.executeJavaScript(`(async () => {
    window.__calls.length = 0;
    document.getElementById('notification-body').click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    return window.__calls.filter((call) => call[0] !== 'hover');
  })()`);
  assert.deepEqual(codexClick, [['activate', 'codex-1'], ['dismissed', 'codex-1']]);

  const summaryData = payload('focus-summary', '专注期间完成了 3 个 AI 任务', '重构用量卡片、补测试、改文档');
  const summary = await show(summaryData);
  assert.deepEqual([summary.actionsHidden, summary.glyph, summary.cardFits], [true, 'timer', true]);
  await shot('focus-summary', summaryData);

  assert.deepEqual(errors, []);
  console.log('Notification checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
