const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('AI usage renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const shot = async (name) => {
    if (!process.env.SOLODOCK_AI_SCREENSHOT_DIR) return;
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('home-usage').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_AI_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  };

  const setup = await win.webContents.executeJavaScript(`(async () => {
    const now = Date.now();
    window.__claude = { ok: true, receivedAt: now - 60000,
      fiveHour: { usedPercent: 82, resetsAt: now + 2 * 3600000 },
      sevenDay: { usedPercent: 46, resetsAt: now + 3 * 86400000 } };
    window.__claudeCalls = 0;
    window.notchAPI = {
      getCodexUsage: async () => ({ ok: true, updatedAt: now, resetCredits: 1, buckets: [{ id: 'codex', name: 'codex', windows: [{ key: 'primary', remainingPercent: 68, durationMinutes: 10080, resetsAt: now + 2 * 86400000 }] }] }),
      getClaudeUsage: async () => { window.__claudeCalls += 1; return window.__claude; },
      getClaudeStatuslineSetup: async () => ({ snippet: '"statusLine": {}' }),
      writeClipboard: async () => true,
    };
    await setMode(true);
    await setActiveTab('home');
    document.getElementById('usage-connect').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { count: document.getElementById('home-usage').dataset.count };
  })()`);
  assert.equal(setup.count, '1', 'only Codex is on by default');
  await shot('usage-1');

  const measure = `(() => {
    const tile = document.getElementById('home-usage');
    const rect = tile.getBoundingClientRect();
    const cols = [...tile.querySelectorAll('.usage-col')].filter((col) => !col.hidden)
      .sort((a, b) => Number(a.style.order) - Number(b.style.order));
    const outside = [...tile.querySelectorAll('button, progress, .usage-bar, strong')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && (r.left < rect.left - 1 || r.right > rect.right + 1 || r.top < rect.top - 1 || r.bottom > rect.bottom + 1);
    }).map((el) => el.id || el.className || el.tagName);
    return {
      count: tile.dataset.count,
      providers: cols.map((col) => col.dataset.provider),
      numbers: cols.map((col) => col.querySelector('strong')?.textContent),
      outside,
    };
  })()`;

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const toggle = (id, on) => {
      const input = document.querySelector('.ai-sub-row[data-id="' + id + '"] [data-action="toggle"]');
      input.checked = on;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    toggle('claude', true);
    await window.NotchAiUsageState.refreshClaude();
    await settle();
    const two = ${measure};
    const name = document.getElementById('ai-sub-name');
    name.value = 'Grok';
    document.getElementById('ai-sub-plan').value = 'SuperGrok';
    document.getElementById('ai-sub-day').value = String(((new Date().getDate() + 5 - 1) % 28) + 1);
    document.getElementById('ai-sub-add').requestSubmit();
    await settle();
    const three = ${measure};
    // A fourth subscription stays in the list but is not shown on the home card.
    name.value = 'Kimi';
    document.getElementById('ai-sub-add').requestSubmit();
    await settle();
    const four = ${measure};
    const kimiNote = [...document.querySelectorAll('.ai-sub-row')].find((row) => row.textContent.includes('Kimi')).textContent;
    // Moving Claude to the top reorders the columns.
    document.querySelector('.ai-sub-row[data-id="claude"] [data-action="up"]').click();
    await settle();
    const reordered = ${measure};
    // Claude without data shows how to connect instead of an invented number.
    window.__claude = { ok: false, error: 'not_connected' };
    await window.NotchAiUsageState.refreshClaude();
    await settle();
    const disconnected = ${measure};
    return { two, three, four, kimiNote, reordered, disconnected };
  })()`);

  assert.deepEqual(result.two.providers, ['codex', 'claude']);
  assert.deepEqual(result.two.numbers, ['68%', '18%'], 'Claude shows the tightest window (5 hours, 18% left)');
  assert.deepEqual(result.two.outside, []);
  assert.deepEqual(result.three.providers, ['codex', 'claude', 'manual']);
  assert.equal(result.three.count, '3');
  assert.match(result.three.numbers[2], /^\d+$|^今天$/);
  assert.deepEqual(result.three.outside, []);
  assert.deepEqual(result.four.providers, ['codex', 'claude', 'manual']);
  assert.match(result.kimiNote, /不在首页/);
  assert.deepEqual(result.reordered.providers, ['claude', 'codex', 'manual']);
  assert.equal(result.disconnected.numbers[0], '—');
  assert.deepEqual(result.disconnected.outside, []);
  await shot('usage-3-disconnected');
  await win.webContents.executeJavaScript(`(async () => { window.__claude = { ok: true, receivedAt: Date.now(), fiveHour: { usedPercent: 82, resetsAt: Date.now() + 7200000 }, sevenDay: { usedPercent: 46, resetsAt: Date.now() + 259200000 } }; await window.NotchAiUsageState.refreshClaude(); })()`);
  await shot('usage-3');

  // Three rows fit next to the photo frame; with the frame hidden the card takes the whole column.
  const column = await win.webContents.executeJavaScript(`(async () => {
    const tile = document.getElementById('home-usage');
    const frame = document.getElementById('home-mirror');
    const before = { usage: tile.getBoundingClientRect().height, frame: frame.getBoundingClientRect().height, ...${measure} };
    window.NotchHome.setModuleVisible('mirror', false);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const side = document.getElementById('home-side').getBoundingClientRect().height;
    const after = { usage: tile.getBoundingClientRect().height, side, ...${measure} };
    window.NotchHome.setModuleVisible('mirror', true);
    return { before, after };
  })()`);
  assert.equal(column.before.providers.length, 3);
  assert.deepEqual(column.before.outside, []);
  assert.ok(column.before.frame >= 100, `the frame keeps a usable height: ${column.before.frame}`);
  assert.ok(Math.abs(column.after.usage - column.after.side) <= 1, JSON.stringify(column.after));
  assert.deepEqual(column.after.outside, []);
  assert.deepEqual(errors, []);
  console.log('AI usage checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
