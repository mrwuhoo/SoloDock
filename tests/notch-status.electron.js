const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Notch status renderer timed out'); app.exit(1); }, 40000);

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

  const shot = async (name) => {
    if (!process.env.SOLODOCK_NOTCH_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
    fs.writeFileSync(path.join(process.env.SOLODOCK_NOTCH_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage({ x: 500, y: 0, width: 240, height: 76 })).toPNG());
  };
  const read = () => win.webContents.executeJavaScript(`(async () => {
    window.NotchNotchStatus.tick();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const app = document.getElementById('app');
    const view = document.getElementById('notch-status');
    const notch = document.getElementById('notch').getBoundingClientRect();
    return {
      shown: app.classList.contains('has-notch-status'),
      kind: view.dataset.kind || '',
      icon: view.dataset.icon || '',
      text: document.getElementById('notch-status-text').textContent,
      detail: document.getElementById('notch-status-detail').textContent,
      progress: view.dataset.progress,
      tone: app.dataset.notchTone || '',
      width: Math.round(notch.width),
      height: Math.round(notch.height),
      label: document.getElementById('notch').getAttribute('aria-label'),
      statusCalls: window.__calls.filter((call) => call[0] === 'status').map((call) => call[1]),
    };
  })()`);

  const idle = await read();
  assert.deepEqual([idle.shown, idle.width, idle.height, idle.statusCalls], [false, 200, 37, []], 'idle: the notch stays exactly the notch');

  // Focus: the lip grows 24pt downward, width unchanged, with a progress line.
  await win.webContents.executeJavaScript(`window.NotchPomodoro.start(1500, 'focus')`);
  const focus = await read();
  assert.deepEqual([focus.shown, focus.kind, focus.icon, focus.text, focus.detail, focus.progress], [true, 'focus', 'timer', '专注中', '25:00', 'true']);
  assert.deepEqual([focus.width, focus.height], [200, 61], 'only grows downward');
  assert.deepEqual(focus.statusCalls, [true], 'the native window grows first');
  assert.match(focus.label, /专注中 25:00/);
  await shot('notch-focus');

  // "Claude needs you" outranks focus and turns the notch amber.
  await win.webContents.executeJavaScript(`window.__handlers.onNeedsYou.forEach((callback) => callback({ title: 'Claude 需要你确认', agent: 'claude' }))`);
  const needs = await read();
  assert.deepEqual([needs.kind, needs.text, needs.tone, needs.icon], ['needs-you', 'Claude 需要你确认', 'needs', 'alert']);
  await shot('notch-needs-you');
  await win.webContents.executeJavaScript(`window.__handlers.onNeedsYou.forEach((callback) => callback(null))`);
  assert.equal((await read()).kind, 'focus');

  // Recording outranks focus; clicking the lip opens the recordings page.
  await win.webContents.executeJavaScript(`window.NotchWorkspace.recordingState = () => ({ status: 'recording', durationMs: 192000 }); true`);
  const recording = await read();
  assert.deepEqual([recording.kind, recording.text, recording.detail, recording.icon], ['recording', '录音中', '03:12', 'dot']);
  await shot('notch-recording');
  const routed = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('notch').click();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const tab = document.querySelector('#tab-recordings.active') !== null;
    await setMode(false);
    await new Promise((resolve) => setTimeout(resolve, 600));
    return tab;
  })()`);
  assert.equal(routed, true, 'clicking the recording status lands on the recordings page');
  await win.webContents.executeJavaScript(`window.NotchWorkspace.recordingState = () => ({ status: 'idle', durationMs: 0 }); true`);

  // Right-click: the native menu gets the current context; menu actions work.
  const menu = await win.webContents.executeJavaScript(`(async () => {
    document.getElementById('notch').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    window.__handlers.onNotchMenuAction.forEach((callback) => callback({ action: 'pomodoro-toggle' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    const paused = window.NotchPomodoro.state();
    window.__handlers.onNotchMenuAction.forEach((callback) => callback({ action: 'later', value: '30' }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { menu: window.__calls.filter((call) => call[0] === 'menu').map((call) => call[1]), paused: [paused.started, paused.running], info: window.__calls.filter((call) => call[0] === 'info').map((call) => call[1].title) };
  })()`);
  assert.deepEqual(menu.menu, [{ pomodoro: 'running', recording: false }]);
  assert.deepEqual(menu.paused, [true, false], '暂停专注 from the menu');
  assert.equal(menu.info.length, 1);
  assert.match(menu.info[0], /^将在 \d\d:\d\d 提醒你$/);
  const pausedStatus = await read();
  assert.equal(pausedStatus.text, '专注已暂停');
  assert.match(pausedStatus.detail, /^2[45]:\d\d$/, 'the remaining time, frozen while paused');

  // With focus over, the later reminder shows; then off-work quietly shows the time.
  await win.webContents.executeJavaScript(`document.getElementById('pomodoro-reset').click()`);
  const later = await read();
  assert.deepEqual([later.kind, later.icon], ['later', 'bell']);
  assert.match(later.detail, /^\d\d:\d\d$/);
  await shot('notch-later');

  // Clearing everything shrinks the lip, then the native window.
  const cleared = await win.webContents.executeJavaScript(`(async () => {
    localStorage.setItem('notch-later-v1', '[]');
    window.NotchTodayStrip.later().forEach(() => {});
    return true;
  })()`);
  assert.equal(cleared, true);
  const offwork = await win.webContents.executeJavaScript(`(async () => {
    const lateNight = new Date(); lateNight.setHours(23, 12, 0, 0);
    return window.NotchStatus.pickNotchStatus({ offwork: { enabled: true, time: '22:30' } }, lateNight.getTime());
  })()`);
  assert.deepEqual([offwork.kind, offwork.detail], ['offwork', '23:12']);

  assert.deepEqual(errors, []);
  console.log('Notch status checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
