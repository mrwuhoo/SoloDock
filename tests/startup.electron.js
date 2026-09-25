const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-recordings':JSON.stringify([{id:'startup-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/retained.webm',mimeType:'audio/webm',title:'Saved recording',category:'未分类'}]),
}}));
const errors = [];
let indexLoads = 0;
let firstLoadAt = 0;
setTimeout(() => { console.error('Production startup timed out', errors); app.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.on('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    indexLoads += 1;
    if (!firstLoadAt) firstLoadAt = Date.now();
  });
  contents.once('did-finish-load', async () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    // Recovery imports workspace.json asynchronously and then reloads the page.
    // Poll across that reload instead of assuming it finishes within a fixed delay.
    const expected = {home:true,workspace:true,note:'Recovered workspace note',recordings:1};
    const deadline = Date.now() + 20000;
    let state = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (contents.isDestroyed()) break;
      try {
        state = await contents.executeJavaScript(`({home:!!window.NotchHome,workspace:!!window.NotchWorkspace,note:document.getElementById('home-note')?.value ?? '',recordings:document.querySelectorAll('.recording-item').length})`);
      } catch (error) { continue; }
      if (JSON.stringify(state) === JSON.stringify(expected)) break;
    }
    try {
      // Give the recovered page a moment so late console errors are still caught.
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual(errors, []);
      assert.deepEqual(state, expected);
      // The preload hydrates the workspace before page scripts run, so recovery must not reload the page.
      assert.equal(indexLoads, 1, `workspace recovery reloaded the page (${indexLoads} loads)`);
      console.log(`Workspace visible ${Date.now() - firstLoadAt}ms after first load`);

      // The real main process enforces the vault lock (master-password path; no Touch ID prompt in tests).
      const vault = await contents.executeJavaScript(`(async () => {
        const api = window.notchAPI;
        const out = { initial: await api.getVaultStatus() };
        out.openList = (await api.listCredentials()).locked;
        out.configured = await api.configureVault({ enabled: true, password: 'startup-pass' });
        await api.lockVault();
        const lockedList = await api.listCredentials();
        out.locked = {
          locked: lockedList.locked,
          items: lockedList.items.length,
          copy: await api.copyCredential('missing', 'password'),
          save: (await api.saveCredential({ service: 'a', account: 'b', password: 'c' })).error,
          get: (await api.getCredential('missing')).error,
        };
        out.wrong = await api.unlockVault('password', 'nope');
        out.right = await api.unlockVault('password', 'startup-pass');
        out.afterUnlock = (await api.listCredentials()).locked;
        await api.lockVault();
        out.system = await api.unlockVault('system');
        out.afterSystem = (await api.listCredentials()).locked;
        return out;
      })()`);
      const panel = require('electron').BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html'));
      assert.deepEqual(vault.system, { ok: true });
      assert.equal(vault.afterSystem, false);
      assert.deepEqual(touchIdPrompts, [{ reason: '解锁 SoloDock 密钥', onTop: false }], 'the panel drops below the Touch ID sheet');
      assert.equal(panel.isAlwaysOnTop(), true, 'and returns to its layer afterwards');
      assert.equal(vault.initial.enabled, false, 'the lock is off until the user turns it on');
      assert.equal(vault.initial.locked, false);
      assert.equal(vault.openList, false);
      assert.deepEqual(vault.configured, { ok: true });
      assert.deepEqual(vault.locked, { locked: true, items: 0, copy: false, save: 'locked', get: 'locked' });
      assert.deepEqual(vault.wrong, { ok: false, error: 'wrong', attemptsLeft: 4 });
      assert.deepEqual(vault.right, { ok: true });
      assert.equal(vault.afterUnlock, false);
      assert.doesNotMatch(fs.readFileSync(path.join(profile, 'vault-lock.json'), 'utf8'), /startup-pass/);

      // Body reminder settings persist, and other settings writes keep them.
      const body = await contents.executeJavaScript(`(async () => {
        const api = window.notchAPI;
        const initial = (await api.getAppSettings()).body;
        const saved = await api.setBodySettings({ sit: { minutes: 45 }, eye: { enabled: true } });
        await api.setFeature('resets', false);
        await api.setFeature('resets', true);
        return { initial, saved, after: (await api.getAppSettings()).body };
      })()`);
      assert.deepEqual(body.initial, { sit: { enabled: true, minutes: 50 }, eye: { enabled: false, minutes: 20 }, offwork: { enabled: true, time: '22:30' }, worklog: { enabled: true } });
      assert.equal(body.saved.ok, true);
      assert.deepEqual(body.after, { sit: { enabled: true, minutes: 45 }, eye: { enabled: true, minutes: 20 }, offwork: { enabled: true, time: '22:30' }, worklog: { enabled: true } });

      // A pomodoro reminder shows its buttons; "再专注 5 分钟" starts a 5-minute focus in the panel.
      const { BrowserWindow: Windows, globalShortcut } = require('electron');
      await contents.executeJavaScript(`window.notchAPI.notifyPomodoro({ minutes: 25, mode: 'focus' })`);
      let reminderWindow = null;
      let reminder = null;
      for (let attempt = 0; attempt < 40 && !reminder; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        reminderWindow = Windows.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/notification.html'));
        if (!reminderWindow) continue;
        reminder = await reminderWindow.webContents.executeJavaScript(`document.getElementById('notification-shell')?.classList.contains('is-visible') ? [...document.querySelectorAll('.notification-action')].map((button) => button.dataset.actionId) : null`).catch(() => null);
      }
      assert.deepEqual(reminder, ['break-5', 'focus-5', 'dismiss']);
      const reminderBounds = reminderWindow.getBounds();
      const reminderDisplay = require('electron').screen.getDisplayMatching(reminderBounds);
      assert.deepEqual([reminderBounds.width, reminderBounds.height], [436, 172]);
      assert.equal(reminderBounds.y, reminderDisplay.workArea.y, 'the card sits right below the menu bar, never over it');
      assert.equal(globalShortcut.isRegistered('Control+Alt+Return'), true, '⌃⌥↩ is live while the reminder is up');
      await reminderWindow.webContents.executeJavaScript(`document.querySelector('[data-action-id="focus-5"]').click()`);
      let pomodoro = null;
      for (let attempt = 0; attempt < 20 && !(pomodoro && pomodoro.running); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        pomodoro = await contents.executeJavaScript('window.NotchPomodoro.state()');
      }
      assert.equal(pomodoro.running, true);
      assert.equal(pomodoro.mode, 'focus');
      assert.equal(pomodoro.session, 300);
      await new Promise((resolve) => setTimeout(resolve, 700));
      assert.equal(globalShortcut.isRegistered('Control+Alt+Return'), false, 'and released once it is dismissed');
      const notices = await contents.executeJavaScript('window.notchAPI.listNotices()');
      const pomodoroNotice = notices.items.find((item) => item.source === 'pomodoro');
      assert.equal(pomodoroNotice && pomodoroNotice.handled, true, 'the reminder is kept in the notice center, marked handled');
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(fs.existsSync(path.join(profile, 'notices.json')), true, 'notices are saved for 7 days');
      await contents.executeJavaScript(`document.getElementById('pomodoro-reset').click()`);

      // The collapsed notch grows 24pt downward for a status and keeps its 200pt width.
      const panelWindow = Windows.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html'));
      await contents.executeJavaScript(`window.NotchNotchStatus.setOffwork({ enabled: false }); true`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const idleBounds = panelWindow.getBounds();
      await contents.executeJavaScript('window.notchAPI.setNotchStatus(true)');
      const statusBounds = panelWindow.getBounds();
      await contents.executeJavaScript('window.notchAPI.setNotchStatus(false)');
      const restoredBounds = panelWindow.getBounds();
      assert.equal(idleBounds.width, 200);
      assert.deepEqual([statusBounds.width, statusBounds.height - idleBounds.height, statusBounds.x, statusBounds.y], [200, 24, idleBounds.x, idleBounds.y]);
      assert.deepEqual(restoredBounds, idleBounds);

      // Quick capture: a hidden panel window is ready ahead of time; what it submits lands in the panel;
      // no other window can submit on its behalf.
      let captureWindow = null;
      for (let attempt = 0; attempt < 40 && !captureWindow; attempt += 1) {
        captureWindow = Windows.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/capture.html'));
        if (!captureWindow) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(captureWindow, 'the capture window is created ahead of time');
      assert.equal(captureWindow.isVisible(), false);
      assert.equal(captureWindow.isAlwaysOnTop(), true);
      assert.equal(captureWindow.getBounds().width, 600);
      const captureSettings = await contents.executeJavaScript('window.notchAPI.getAppSettings()');
      assert.equal(captureSettings.captureShortcut, 'Alt+Shift+N');
      assert.equal(captureSettings.captureShortcutRegistered, globalShortcut.isRegistered('Alt+Shift+N'));
      assert.deepEqual(await contents.executeJavaScript(`window.notchAPI.submitCapture({ text: '面板不能冒充随手记' })`), { ok: false });
      assert.deepEqual(await captureWindow.webContents.executeJavaScript(`window.notchAPI.submitCapture({ text: '明天下午3点 给王总回电话', type: 'todo', category: 'P1' })`), { ok: true });
      let captured = '';
      for (let attempt = 0; attempt < 30 && !captured; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        captured = await contents.executeJavaScript(`window.NotchTodos.items().P1.find((item) => item.text === '给王总回电话')?.deadline || ''`);
      }
      assert.equal(new Date(captured).getHours(), 15, 'the panel parsed and stored the todo');
      const changed = await contents.executeJavaScript(`window.notchAPI.setCaptureShortcut('Control+Alt+Shift+F19')`);
      assert.deepEqual(changed, { ok: true, shortcut: 'Control+Alt+Shift+F19' });
      assert.equal(globalShortcut.isRegistered('Control+Alt+Shift+F19'), true);
      assert.equal(globalShortcut.isRegistered('Alt+Shift+N'), false, 'the old shortcut is released');
      assert.deepEqual(await contents.executeJavaScript(`window.notchAPI.setCaptureShortcut('Space')`), { ok: false, error: 'invalid' });
      assert.deepEqual(await contents.executeJavaScript(`window.notchAPI.setCaptureShortcut('')`), { ok: true, shortcut: '' });
      assert.equal(globalShortcut.isRegistered('Control+Alt+Shift+F19'), false);
      assert.equal((await contents.executeJavaScript('window.notchAPI.getAppSettings()')).captureShortcut, '', 'off stays off');
      const restored = await contents.executeJavaScript(`window.notchAPI.setCaptureShortcut('Alt+Shift+N')`);
      assert.equal(restored.ok, captureSettings.captureShortcutRegistered);

      // 暂停提醒: reminders still land in the notice center but don't pop up; the pause survives other
      // settings writes; resuming sums up what was missed in one line.
      const noticeCount = async () => (await contents.executeJavaScript('window.notchAPI.listNotices()')).items.length;
      const shownTitle = async () => {
        const win = Windows.getAllWindows().find((item) => !item.isDestroyed() && item.webContents.getURL().endsWith('/renderer/notification.html'));
        if (!win) return '';
        return win.webContents.executeJavaScript(`document.getElementById('notification-shell')?.classList.contains('is-visible') ? document.getElementById('notification-title').textContent : ''`).catch(() => '');
      };
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.deepEqual(await contents.executeJavaScript(`window.notchAPI.pauseReminders('forever')`), { ok: false, error: 'invalid' });
      const paused = await contents.executeJavaScript(`window.notchAPI.pauseReminders('30m')`);
      assert.equal(paused.ok, true);
      assert.ok(Math.abs(paused.until - Date.now() - 30 * 60000) < 5000);
      const beforeNotices = await noticeCount();
      await contents.executeJavaScript(`window.notchAPI.notifyPomodoro({ minutes: 25, mode: 'focus' })`);
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal(await shownTitle(), '', 'nothing pops up while paused');
      assert.equal(await noticeCount(), beforeNotices + 1, 'but it is kept in the notice center');
      await contents.executeJavaScript(`window.notchAPI.setFeature('resets', false).then(() => window.notchAPI.setFeature('resets', true))`);
      assert.equal((await contents.executeJavaScript('window.notchAPI.getAppSettings()')).remindersPausedUntil, paused.until, 'other settings writes keep the pause');
      assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'app-settings.json'), 'utf8')).remindersPausedUntil, paused.until);
      assert.deepEqual(await contents.executeJavaScript('window.notchAPI.resumeReminders()'), { ok: true });
      let summaryTitle = '';
      for (let attempt = 0; attempt < 20 && !summaryTitle; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        summaryTitle = await shownTitle();
      }
      assert.equal(summaryTitle, '暂停期间有 1 条提醒');
      assert.equal(await noticeCount(), beforeNotices + 1, 'the summary is not another notice');
      assert.equal((await contents.executeJavaScript('window.notchAPI.getAppSettings()')).remindersPausedUntil, 0);
      assert.deepEqual(errors, []);
      console.log('Production workspace recovery checks passed');
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
// Stand-in for the Touch ID sheet: record whether the panel still sat above system windows while it was up.
const touchIdPrompts = [];
require('electron').systemPreferences.promptTouchID = async (reason) => {
  const panel = require('electron').BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/renderer/index.html'));
  touchIdPrompts.push({ reason, onTop: panel ? panel.isAlwaysOnTop() : null });
};
require('../main.js');
