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
      assert.deepEqual(body.initial, { sit: { enabled: true, minutes: 50 }, eye: { enabled: false, minutes: 20 }, offwork: { enabled: true, time: '22:30' } });
      assert.equal(body.saved.ok, true);
      assert.deepEqual(body.after, { sit: { enabled: true, minutes: 45 }, eye: { enabled: true, minutes: 20 }, offwork: { enabled: true, time: '22:30' } });

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
      await contents.executeJavaScript(`document.getElementById('pomodoro-reset').click()`);
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
