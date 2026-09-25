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

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 400,
    height: 132,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'notification-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'notification.html'));

  const show = async (data) => win.webContents.executeJavaScript(`(async () => {
    window.NotchNotification.show(${JSON.stringify(data)});
    await new Promise((resolve) => setTimeout(resolve, 600));
    const shell = document.getElementById('notification-shell');
    const glyph = shell.querySelector('.notification-glyph[data-glyph="' + shell.dataset.glyph + '"]');
    const box = document.documentElement.getBoundingClientRect();
    const actions = [...document.querySelectorAll('.notification-action')];
    return {
      height: getComputedStyle(document.documentElement).getPropertyValue('--notification-height').trim(),
      glyph: shell.dataset.glyph,
      glyphVisible: Number(getComputedStyle(glyph).opacity) === 1,
      actions: actions.map((button) => [button.textContent, button.classList.contains('primary')]),
      actionsHidden: document.getElementById('notification-actions').hidden,
      shortcut: document.querySelector('.notification-shortcut')?.textContent || '',
      ring: getComputedStyle(shell.querySelector('.notification-ring')).display,
      source: document.getElementById('notification-source').textContent,
      overflow: [...actions, document.querySelector('.notification-shortcut')].filter(Boolean).some((node) => {
        const r = node.getBoundingClientRect();
        return r.right > box.width - 8 || r.bottom > window.innerHeight - 4;
      }),
    };
  })()`);
  const shot = async (name, height) => {
    if (!process.env.SOLODOCK_NOTIFICATION_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
    fs.writeFileSync(path.join(process.env.SOLODOCK_NOTIFICATION_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage({ x: 0, y: 0, width: 400, height })).toPNG());
  };

  const pomodoro = await show(payload('pomodoro', '专注完成', '25 分钟专注完成，休息一下吧'));
  assert.deepEqual(pomodoro, {
    height: '132px', glyph: 'timer', glyphVisible: true,
    actions: [['休息 5 分钟', true], ['再专注 5 分钟', false], ['跳过', false]],
    actionsHidden: false, shortcut: '⌃⌥↩', ring: 'none', source: '专注', overflow: false,
  });
  await shot('pomodoro', 132);
  const clicked = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('[data-action-id="focus-5"]').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { calls: window.__calls.filter((call) => call[0] === 'action'), disabled: [...document.querySelectorAll('.notification-action')].every((button) => button.disabled) };
  })()`);
  assert.deepEqual(clicked, { calls: [['action', 'pomodoro-1', 'focus-5']], disabled: true });

  const sit = await show(payload('sit', '起来活动一下', '已经连续用电脑 50 分钟，站起来走走、喝口水'));
  assert.equal(sit.glyph, 'walk');
  assert.deepEqual(sit.actions, [['休息 5 分钟', true], ['10 分钟后', false], ['今天不再提醒', false]]);
  assert.equal(sit.overflow, false, 'three buttons and the shortcut hint fit in 400px');
  await shot('sit', 132);

  const eye = await show(payload('eye', '看看远处 20 秒', '眨眨眼，让眼睛歇一会儿'));
  assert.deepEqual([eye.height, eye.actionsHidden, eye.ring, eye.glyph, eye.shortcut], ['96px', true, 'block', 'eye', '']);
  await shot('eye', 96);

  const offwork = await show(payload('offwork', '到收工时间了', '22:30 · 把剩下的挪到明天，早点休息'));
  assert.deepEqual(offwork.actions, [['待办挪到明天', true], ['再工作 30 分钟', false]]);
  await shot('offwork', 132);

  const todo = await show(payload('todo', '交付封面终稿', '将在 1 小时内截止', { eventId: 'todo-1' }));
  assert.equal(todo.glyph, 'clock');
  const todoClick = await win.webContents.executeJavaScript(`(async () => {
    window.__calls.length = 0;
    document.getElementById('notification-body').click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    return window.__calls;
  })()`);
  assert.deepEqual(todoClick, [['action', 'todo-1', 'open-todo']], 'clicking a todo reminder opens the todo page');
  await shot('todo', 132);

  const codex = await show(payload('codex', '重构用量卡片', '已完成 · SoloDock', { eventId: 'codex-1' }));
  assert.deepEqual(codex.actions, [['跳回窗口', true], ['稍后提醒', false]]);
  const codexClick = await win.webContents.executeJavaScript(`(async () => {
    window.__calls.length = 0;
    document.getElementById('notification-body').click();
    await new Promise((resolve) => setTimeout(resolve, 700));
    return window.__calls.filter((call) => call[0] !== 'hover');
  })()`);
  assert.deepEqual(codexClick, [['activate', 'codex-1'], ['dismissed', 'codex-1']]);

  const summary = await show(payload('focus-summary', '专注期间完成了 3 个 AI 任务', '重构用量卡片、补测试、改文档'));
  assert.deepEqual([summary.height, summary.actionsHidden, summary.glyph], ['96px', true, 'timer']);
  await shot('focus-summary', 96);

  assert.deepEqual(errors, []);
  console.log('Notification checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
