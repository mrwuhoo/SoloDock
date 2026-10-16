const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
// Breaks that start on their own, through the real main process: a finished focus brings the cat without a click,
// the card only offers not resting, and 让它走 ends a break you did not ask for (but not one you did).
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.mkdirSync(path.join(profile, 'home'), { recursive: true });
app.setPath('home', path.join(profile, 'home'));
// Not a fresh install: no guide, and no login item for this throwaway copy.
fs.writeFileSync(path.join(profile, '.first-run-done'), '');
fs.writeFileSync(path.join(profile, 'app-settings.json'), JSON.stringify({ onboardingPending: false }));
setTimeout(() => { console.error('Automatic break timed out'); app.exit(1); }, 60000);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const find = (page) => BrowserWindow.getAllWindows().find((win) => !win.isDestroyed() && win.webContents.getURL().endsWith(`/renderer/${page}`));
async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  let value = await check();
  while (!value && Date.now() < end) {
    await wait(100);
    value = await check();
  }
  return value;
}
// The cat is in: its window is up and the arrival clip is playing.
const catIn = () => until(async () => {
  const win = find('break-cat.html');
  if (!win || !win.isVisible()) return false;
  return win.webContents.executeJavaScript(`!document.getElementById('break-cat').hidden && document.getElementById('break-cat-arrive').currentTime > 0`).catch(() => false);
});
const catGone = () => until(() => !find('break-cat.html'), 4000);
// The reminder card currently on screen, once it shows the given title.
const card = (title) => until(async () => {
  const win = find('notification.html');
  if (!win) return null;
  const shown = await win.webContents.executeJavaScript(`document.getElementById('notification-shell')?.classList.contains('is-visible') && document.getElementById('notification-title').textContent === ${JSON.stringify(title)}
    ? { detail: document.getElementById('notification-detail').textContent, actions: [...document.querySelectorAll('.notification-action')].map((button) => button.dataset.actionId) }
    : null`).catch(() => null);
  return shown ? { win, ...shown } : null;
});

app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', async () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    const js = (code) => contents.executeJavaScript(code);
    const pomodoro = () => js('window.NotchPomodoro.state()');
    try {
      await wait(1500);
      assert.deepEqual((await js('window.notchAPI.getAppSettings()')).body.cat, { enabled: true });

      // A focus session finishes: the break starts by itself and the cat walks in.
      await js(`window.NotchPomodoro.start(1, 'focus'); true`);
      const done = await card('专注完成');
      assert.ok(done, 'the focus-complete card shows');
      assert.deepEqual(done.actions, ['focus-5', 'dismiss'], 'no 休息 5 分钟 button: the break has already started');
      assert.match(done.detail, /休息 5 分钟/);
      const resting = await pomodoro();
      assert.deepEqual([resting.running, resting.mode, resting.session], [true, 'break', 300]);
      assert.ok(await catIn(), 'the cat comes without a click');

      // 「再专注 5 分钟」 on the card: back to work, the cat leaves.
      await done.win.webContents.executeJavaScript(`document.querySelector('[data-action-id="focus-5"]').click()`);
      assert.ok(await until(async () => (await pomodoro()).mode === 'focus'), 'a 5-minute focus starts');
      assert.equal((await pomodoro()).session, 300);
      assert.ok(await catGone(), 'and the cat leaves');
      await js(`window.NotchPomodoro.finish(); true`);

      // Next time: 「让它走」 means "not now" and ends a break that started by itself.
      await js(`window.NotchPomodoro.start(1, 'focus'); true`);
      assert.ok(await card('专注完成'));
      assert.ok(await catIn());
      await find('break-cat.html').webContents.executeJavaScript(`document.getElementById('break-cat-leave').click()`);
      assert.ok(await until(async () => !(await pomodoro()).started), 'the automatic break ends');
      assert.ok(await catGone());

      // A break you chose on the home card: 「让它走」 only sends the cat away, the break keeps counting.
      await wait(7000); // let the last card go
      await js(`document.getElementById('energy-rest').click(); true`);
      assert.ok(await catIn());
      await find('break-cat.html').webContents.executeJavaScript(`document.getElementById('break-cat-leave').click()`);
      assert.ok(await catGone());
      const chosen = await pomodoro();
      assert.deepEqual([chosen.running, chosen.mode], [true, 'break'], 'your own break goes on');
      await js(`window.NotchPomodoro.finish(); true`);

      // With reminders paused nothing starts by itself.
      assert.equal((await js(`window.notchAPI.pauseReminders('30m')`)).ok, true);
      await js(`window.NotchPomodoro.start(1, 'focus'); true`);
      await until(async () => !(await pomodoro()).started, 4000);
      await wait(800);
      assert.equal((await pomodoro()).started, false, 'paused reminders: no automatic break');
      assert.equal(find('break-cat.html'), undefined);
      await js(`window.notchAPI.resumeReminders()`);

      // With the cat switched off, the card asks as before.
      assert.equal((await js(`window.notchAPI.setBodySettings({ cat: { enabled: false } })`)).ok, true);
      await wait(7000); // let the pause summary go
      await js(`window.NotchPomodoro.start(1, 'focus'); true`);
      const asked = await card('专注完成');
      assert.ok(asked);
      assert.deepEqual(asked.actions, ['break-5', 'focus-5', 'dismiss']);
      await wait(500);
      assert.equal((await pomodoro()).started, false, 'no break until you choose one');
      assert.equal(find('break-cat.html'), undefined);

      console.log('Automatic break checks passed');
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
require('../main.js');
