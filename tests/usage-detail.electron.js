const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Usage detail renderer timed out'); app.exit(1); }, 40000);

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
  await win.webContents.executeJavaScript(`localStorage.setItem('notch-ai-subscriptions-v1', JSON.stringify([
    { id: 'codex', plan: 'Plus', renewalDay: 12, enabled: true },
    { id: 'claude', plan: 'Max', enabled: true },
    { id: 'manual-grok', name: 'Grok', plan: 'SuperGrok', enabled: true },
  ])); true`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const run = (script) => win.webContents.executeJavaScript(`(async () => { ${script} })()`);
  const shot = async (name) => {
    if (!process.env.SOLODOCK_USAGE_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(process.env.SOLODOCK_USAGE_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };

  const result = await run(`
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const card = () => $('usage-pop-card');
    const text = (selector) => [...card().querySelectorAll(selector)].map((node) => node.textContent);
    const now = Date.now();
    await setMode(true);
    await setActiveTab('home');
    await settle(150);
    const out = {};

    // Not connected yet: one empty-state component with a primary action.
    $('home-usage').click();
    await settle();
    out.empty = { open: !$('usage-pop').hidden, tabs: text('.usage-pop-tabs button'), selected: text('.usage-pop-tabs [aria-selected="true"]'), title: text('.usage-pop-empty b'), action: text('.usage-pop-primary'), renewal: text('.usage-pop-renewal b') };

    // Connecting reads Codex: weekly first, low window in amber with an estimate, reset cards, renewal.
    window.notchAPI.getCodexUsage = async () => ({ ok: true, updatedAt: Date.now(), resetCredits: 1, buckets: [{ id: 'codex', name: 'codex', windows: [
      { key: 'primary', remainingPercent: 70, durationMinutes: 300, resetsAt: now + 2 * 3600000 },
      { key: 'secondary', remainingPercent: 18, durationMinutes: 10080, resetsAt: now + 2 * 86400000 },
    ] }] });
    card().querySelector('.usage-pop-primary').click();
    await settle(200);
    out.codex = {
      windows: [...card().querySelectorAll('.usage-win')].map((node) => [node.querySelector('.usage-win-top span').textContent, node.querySelector('strong').textContent, node.dataset.level, Boolean(node.querySelector('em')), node.querySelector('.usage-win-eta')?.textContent || '']),
      credits: text('.usage-pop-credits strong'),
      renewal: text('.usage-pop-renewal small'),
      meta: text('.usage-pop-meta small'),
      sync: text('.usage-pop-sync'),
    };
    await (${JSON.stringify(Boolean(process.env.SOLODOCK_USAGE_SCREENSHOT_DIR))} ? settle(10) : Promise.resolve());
    return out;
  `);
  await shot('usage-codex');

  const more = await run(`
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const card = () => $('usage-pop-card');
    const text = (selector) => [...card().querySelectorAll(selector)].map((node) => node.textContent);
    const now = Date.now();
    const out = {};
    // Claude: usage is read automatically through the local Claude Code; a missing sign-in offers one button.
    window.__claudeReads = [];
    window.notchAPI.getClaudeUsage = async (options) => { window.__claudeReads.push(options || {}); return { ok: false, error: 'login_required' }; };
    window.notchAPI.claudeLogin = async () => ({ ok: true });
    await window.NotchAiUsageState.refreshClaude();
    [...card().querySelectorAll('.usage-pop-tabs button')].find((node) => node.textContent.includes('Claude')).click();
    await settle();
    out.claudeBefore = [...text('.usage-pop-empty b'), ...text('.usage-pop-empty .usage-pop-primary')];
    window.notchAPI.getClaudeUsage = async (options) => {
      window.__claudeReads.push(options || {});
      return { ok: true, source: 'cli', receivedAt: Date.now(), fiveHour: { usedPercent: 96, resetsAt: now + 3600000 }, sevenDay: { usedPercent: 30, resetsAt: now + 4 * 86400000 } };
    };
    card().querySelector('.usage-pop-empty .usage-pop-primary').click();
    await settle(250);
    out.forced = window.__claudeReads.at(-1).force === true;
    out.claude = [...card().querySelectorAll('.usage-win')].map((node) => [node.querySelector('.usage-win-top span').textContent, node.querySelector('strong').textContent, node.dataset.level]);
    // A manual subscription only shows its plan and renewal.
    [...card().querySelectorAll('.usage-pop-tabs button')].find((node) => node.textContent.includes('Grok')).click();
    await settle();
    out.manual = { note: text('.usage-pop-note')[0], renewal: text('.usage-pop-renewal b'), link: text('.usage-pop-renewal button'), sync: card().querySelectorAll('.usage-pop-sync').length };
    // It stays inside the panel, Escape closes it, and clicking a column opens that subscription.
    const panel = document.querySelector('.panel').getBoundingClientRect();
    const box = card().getBoundingClientRect();
    out.inside = box.left >= panel.left && box.right <= panel.right && box.top >= panel.top && box.bottom <= panel.bottom && Math.round(box.width) === 460;
    out.escape = [window.NotchUsageDetail.close(), $('usage-pop').hidden];
    document.querySelector('#usage-columns [data-subscription="claude"] .usage-widget-body').click();
    await settle();
    out.column = window.NotchUsageDetail.state();
    document.getElementById('tab-home').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    out.outside = $('usage-pop').hidden;
    return out;
  `);

  assert.deepEqual(result.empty, { open: true, tabs: ['CxCodex', 'CClaude', 'GGrok'], selected: ['CxCodex'], title: ['还没连接 Codex'], action: ['连接并读取'], renewal: [result.empty.renewal[0]] });
  assert.match(result.empty.renewal[0], /^(\d+月\d+日 · 还有 \d+ 天|今天续费)$/);
  assert.deepEqual(result.codex.windows.map((row) => row.slice(0, 4)), [['本周', '18%', 'low', true], ['5 小时', '70%', 'normal', false]]);
  assert.match(result.codex.windows[0][4], /^按当前速度，(约\S.* 用完|撑得到重置)$/);
  assert.deepEqual(result.codex.credits, ['1']);
  assert.deepEqual(result.codex.renewal, ['由你设置']);
  assert.deepEqual(result.codex.meta, ['刚刚同步']);
  assert.deepEqual(result.codex.sync, ['立即同步']);
  assert.deepEqual(more.claudeBefore, ['登录一次 Claude Code', '登录 Claude']);
  assert.equal(more.forced, true, 'after signing in it reads right away');
  assert.deepEqual(more.claude, [['本周', '70%', 'normal'], ['5 小时', '4%', 'critical']]);
  assert.match(more.manual.note, /^Grok 没有可读取的额度接口/);
  assert.deepEqual(more.manual.renewal, ['没有可读取的续费日']);
  assert.deepEqual(more.manual.link, ['设置续费日']);
  assert.equal(more.manual.sync, 0);
  assert.equal(more.inside, true);
  assert.deepEqual(more.escape, [true, true]);
  assert.deepEqual(more.column, { open: true, selected: 'claude' });
  assert.equal(more.outside, true);
  assert.deepEqual(errors, []);
  console.log('Usage detail checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
