const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Onboarding renderer timed out'); app.exit(1); }, 40000);

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
  const run = (script) => win.webContents.executeJavaScript(`(async () => { ${script} })()`);
  const shot = async (name) => {
    if (!process.env.SOLODOCK_ONBOARD_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(process.env.SOLODOCK_ONBOARD_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const reload = async () => {
    await win.webContents.reload();
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  };

  // Main marks a fresh install as pending; the first expansion shows step 1 with the real shortcuts.
  const first = await run(`
    const $ = (id) => document.getElementById(id);
    const base = await window.notchAPI.getAppSettings();
    window.__onboarding = { pending: true, finished: 0 };
    window.notchAPI.getAppSettings = async () => ({ ...base, onboardingPending: window.__onboarding.pending });
    window.notchAPI.finishOnboarding = async () => { window.__onboarding.pending = false; window.__onboarding.finished += 1; return { ok: true }; };
    await setMode(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    return {
      open: !$('onboard').hidden,
      step: window.NotchOnboarding.state().step,
      bars: [...document.querySelectorAll('.onboard-progress i')].map((bar) => bar.classList.contains('on')),
      prevDisabled: document.querySelector('[data-onboard="prev"]').disabled,
      keys: [$('onboard-summon-key').textContent, $('onboard-capture-key').textContent],
      focus: document.activeElement?.dataset.onboard,
    };
  `);
  assert.equal(first.open, true);
  assert.equal(first.step, 1);
  assert.deepEqual(first.bars, [true, false, false]);
  assert.equal(first.prevDisabled, true);
  assert.deepEqual(first.keys, ['悬停刘海 + 空格', '⌥⇧N 随手记']);
  assert.equal(first.focus, 'next');
  await shot('onboard-1');

  // Step 2: clipboard history starts off; choices are written only when leaving the step.
  const picks = await run(`
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    window.__features = [];
    window.notchAPI.setFeature = async (id, enabled) => { window.__features.push([id, enabled]); return { ok: true }; };
    document.querySelector('[data-onboard="next"]').click();
    await settle();
    const buttons = () => [...document.querySelectorAll('#onboard-picks button')];
    const out = {
      step: window.NotchOnboarding.state().step,
      picks: buttons().map((button) => [button.querySelector('span').textContent, button.getAttribute('aria-pressed'), Boolean(button.querySelector('svg'))]),
    };
    document.querySelector('#onboard-picks [data-feature="clip"]').click();
    document.querySelector('#onboard-picks [data-feature="life"]').click();
    out.beforeLeaving = window.__features.slice();
    return out;
  `);
  assert.equal(picks.step, 2);
  assert.deepEqual(picks.picks, [
    ['待办', 'true', true], ['笔记', 'true', true], ['链接', 'true', true], ['密钥', 'true', true],
    ['剪贴板', 'false', true], ['录制', 'true', true], ['时间', 'true', true], ['生活', 'true', true],
  ]);
  assert.deepEqual(picks.beforeLeaving, []);
  await shot('onboard-2');

  // Step 3: detected tools get a primary copy button; nothing is written to their config.
  const ai = await run(`
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    window.__copied = [];
    window.notchAPI.getAiIntegrationStatus = async () => ({ claude: { installed: true, connected: false }, codex: { installed: false, connected: false } });
    window.notchAPI.getAiIntegrationSetup = async (tool) => ({ ok: true, file: '~/.claude/settings.json', snippet: '"hooks": {}' });
    window.notchAPI.writeClipboard = async (entry) => { window.__copied.push(entry); return true; };
    document.querySelector('[data-onboard="next"]').click();
    await settle(150);
    const rows = [...document.querySelectorAll('.onboard-ai-row')].map((row) => [row.querySelector('b').textContent, row.querySelector('small').textContent, row.querySelector('button')?.className || '']);
    const out = { features: window.__features.slice(), step: window.NotchOnboarding.state().step, next: document.querySelector('[data-onboard="next"]').textContent, rows };
    document.querySelector('[data-setup="claude"]').click();
    await settle();
    out.copied = window.__copied.slice();
    out.note = document.querySelector('#onboard-ai-note span').textContent;
    // Going back keeps the choices and does not write them twice.
    document.querySelector('[data-onboard="prev"]').click();
    await settle();
    out.back = [window.NotchOnboarding.state().step, document.querySelector('#onboard-picks [data-feature="clip"]').getAttribute('aria-pressed')];
    document.querySelector('[data-onboard="next"]').click();
    await settle(150);
    out.featuresAfter = window.__features.slice();
    return out;
  `);
  assert.deepEqual(ai.features, [['clip', true], ['life', false]]);
  assert.equal(ai.step, 3);
  assert.equal(ai.next, '完成');
  assert.deepEqual(ai.rows, [['Claude Code', '已检测到', 'onboard-primary'], ['Codex', '没有检测到，装好后可以在这里接入', 'onboard-secondary']]);
  assert.deepEqual(ai.copied, [{ type: 'text', text: '"hooks": {}' }]);
  assert.match(ai.note, /^已复制 · 粘贴进 ~\/\.claude\/settings\.json 的最外层/);
  assert.deepEqual(ai.back, [2, 'true']);
  assert.deepEqual(ai.featuresAfter, [['clip', true], ['life', false]]);
  await shot('onboard-3');

  // 完成 lands on the home page, tells main, and never shows again on its own.
  const done = await run(`
    document.querySelector('[data-onboard="next"]').click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const out = { open: !document.getElementById('onboard').hidden, finished: window.__onboarding.finished, tab: document.querySelector('.tab.active')?.dataset.tab };
    await setMode(false);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return out;
  `);
  assert.deepEqual(done, { open: false, finished: 1, tab: 'home' });
  const again = await run(`
    await setMode(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const out = { open: !document.getElementById('onboard').hidden };
    // It can be reopened from 设置 → 关于, and Escape closes it.
    document.getElementById('settings-onboarding').click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    out.reopened = [!document.getElementById('onboard').hidden, window.NotchOnboarding.state().step];
    out.escape = window.NotchOnboarding.escape();
    out.closed = document.getElementById('onboard').hidden;
    return out;
  `);
  assert.deepEqual(again, { open: false, reopened: [true, 1], escape: true, closed: true });

  // Without main's pending flag (an upgrade, or any other window) nothing appears.
  await reload();
  const plain = await run(`
    await setMode(true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    return !document.getElementById('onboard').hidden;
  `);
  assert.equal(plain, false);

  assert.deepEqual(errors, []);
  console.log('Onboarding checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
