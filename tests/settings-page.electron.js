const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Settings page renderer timed out'); app.exit(1); }, 40000);

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
  const run = (script) => win.webContents.executeJavaScript(script);
  const first = await run(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    await setMode(true);
    await setActiveTab('settings');
    await settle(150);
    const visible = () => [...$('settings-pane-body').children].filter((card) => getComputedStyle(card).display !== 'none').map((card) => card.id || card.className.match(/settings-[a-z-]+-card/)[0]);
    const out = {};
    out.nav = [...document.querySelectorAll('#settings-nav button')].map((button) => button.textContent.trim());
    out.general = [$('settings-pane-title').textContent, visible()];
    const groups = {};
    for (const button of document.querySelectorAll('#settings-nav button')) {
      button.click();
      groups[button.dataset.settingsGroup] = visible();
    }
    out.groups = groups;
    out.selected = document.querySelector('#settings-nav [aria-pressed="true"]').dataset.settingsGroup;
    // Another module asks to show the vault card: the page switches group first.
    out.reveal = [window.NotchSettings.reveal('settings-vault-card'), window.NotchSettings.current(), $('settings-pane-title').textContent];
    // The About links open in the browser.
    window.NotchSettings.select('about');
    document.querySelector('[data-settings-link$="/issues"]').click();
    out.link = window.__calls.filter((call) => call[0] === 'open-external').map((call) => call[1]);
    return out;
  })()`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const remembered = await run(`window.NotchSettings.current()`);

  assert.deepEqual(first.nav, ['常规', '首页', '身体与作息', '功能', 'AI 与 API', '隐私与安全', '数据', '关于']);
  assert.equal(first.general[0], '常规');
  assert.deepEqual(first.groups, {
    general: ['settings-device-card'],
    home: ['settings-home-modules-card', 'settings-frame-card'],
    body: ['settings-body-card'],
    feat: ['settings-features-card'],
    ai: ['settings-api-card', 'settings-ai-card', 'settings-usage-card'],
    privacy: ['settings-vault-card', 'settings-cloud-card'],
    data: ['settings-data-card'],
    about: ['settings-about-card'],
  });
  assert.equal(first.selected, 'about');
  assert.deepEqual(first.reveal, [true, 'privacy', '隐私与安全']);
  assert.deepEqual(first.link, ['https://github.com/mrwuhoo/SoloDock/issues']);
  assert.equal(remembered, 'about', 'the last group is remembered');
  assert.deepEqual(errors, []);
  console.log('Settings page checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
