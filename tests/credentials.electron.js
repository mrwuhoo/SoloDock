const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Credentials renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const shot = async (name) => {
    if (!process.env.SOLODOCK_CREDENTIALS_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('tab-credentials').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_CREDENTIALS_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  };
  const key = async (keyCode, modifiers = []) => {
    for (const type of ['keyDown', 'keyUp']) win.webContents.sendInputEvent({ type, keyCode, modifiers });
    await new Promise((resolve) => setTimeout(resolve, 80));
  };
  const run = (source) => win.webContents.executeJavaScript(`(async () => { ${source} })()`);

  const setup = await run(`
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const now = Date.now();
    const store = [
      { id: 'p1', kind: 'password', service: 'GitHub', account: 'me@example.com', url: 'https://github.com/login', note: '主力开发账号', passwordMask: '**********', createdAt: Date.parse('2026-03-01'), lastUsedAt: now - 3600000 },
      { id: 'k1', kind: 'apikey', service: 'OpenAI', account: 'OPENAI_API_KEY', url: '', note: '', passwordMask: '**********', createdAt: 2, lastUsedAt: now - 7200000 },
      { id: 'p2', kind: 'password', service: '飞书', account: 'solo@studio.cn', url: '', note: '', passwordMask: '**********', createdAt: 3, lastUsedAt: 0 },
      { id: 'p3', kind: 'password', service: 'Bilibili', account: 'studio', url: '', note: '', passwordMask: '**********', createdAt: 4, lastUsedAt: 0 },
    ];
    window.__store = store;
    window.__copies = []; window.__saved = []; window.__deleted = []; window.__gets = []; window.__cleared = 0; window.__opened = [];
    window.notchAPI = {
      getVaultStatus: async () => ({ enabled: true, setupSeen: true, locked: false, system: 'touchid', hasPassword: false, autoLockMinutes: 10, lockAt: Date.now() + 272000, cooldownUntil: 0, attemptsLeft: 5 }),
      listCredentials: async () => ({ ok: true, secureStorage: true, locked: false, items: store.map((item) => ({ ...item })) }),
      saveCredential: async (payload) => {
        window.__saved.push(payload);
        const existing = store.find((item) => item.id === payload.id);
        if (existing) { Object.assign(existing, payload); return { ok: true, item: { ...existing } }; }
        const item = { ...payload, id: 'n' + store.length, account: payload.account || 'DEEPSEEK_API_KEY', passwordMask: '**********', createdAt: Date.now(), lastUsedAt: 0 };
        delete item.password;
        store.push(item);
        return { ok: true, item: { ...item } };
      },
      copyCredential: async (id, field) => { window.__copies.push([id, field]); return true; },
      clearSecretClipboard: async () => { window.__cleared += 1; return true; },
      deleteCredentials: async (ids) => { window.__deleted.push(...ids); ids.forEach((id) => store.splice(store.findIndex((item) => item.id === id), 1)); return { ok: true, deleted: ids.length }; },
      getCredential: async (id) => { window.__gets.push(id); return { ok: true, item: { ...store.find((item) => item.id === id), password: 'secret-value' } }; },
      openExternal: async (url) => { window.__opened.push(url); return true; },
      lockVault: async () => ({ ok: true }),
    };
    await setMode(true);
    await setActiveTab('credentials');
    await window.NotchVault.refresh();
    document.dispatchEvent(new CustomEvent('notch:vault-changed', { detail: { locked: false } }));
    await settle(150);
    return {
      focused: document.activeElement?.id,
      autoLock: $('vault-auto-lock').textContent,
      lockHidden: $('vault-lock-now').hidden,
    };
  `);
  assert.equal(setup.focused, 'credential-search', 'search is focused when the page opens');
  assert.match(setup.autoLock, /^\d+ 分钟后自动锁定$/);
  assert.equal(setup.lockHidden, false);

  const listing = await run(`
    const groups = [...document.querySelectorAll('#credential-list .cred-group')].map((node) => node.textContent);
    const rows = [...document.querySelectorAll('#credential-list .cred-row')].map((row) => [row.querySelector('b').textContent, row.querySelector('small').textContent, row.querySelector('.cred-tag').textContent, row.classList.contains('active')]);
    const detail = document.getElementById('credential-detail');
    return {
      groups, rows,
      title: detail.querySelector('h2').textContent,
      meta: detail.querySelector('.cred-detail-title p').textContent,
      fields: [...detail.querySelectorAll('.cred-field')].map((row) => [row.querySelector('.cred-field-label').textContent, row.querySelector('.cred-field-value').textContent]),
      avatar: detail.querySelector('.cred-avatar').textContent,
      html: detail.innerHTML.includes('secret-value'),
    };
  `);
  assert.deepEqual(listing.groups, ['最近使用', '全部']);
  assert.deepEqual(listing.rows, [
    ['GitHub', 'me@example.com', '密码', true],
    ['OpenAI', 'OPENAI_API_KEY', 'API Key', false],
    ['飞书', 'solo@studio.cn', '密码', false],
    ['Bilibili', 'studio', '密码', false],
  ]);
  assert.equal(listing.title, 'GitHub');
  assert.match(listing.meta, /^github\.com · 最近使用 (今天|昨天) \d\d:\d\d · 密码$/);
  assert.deepEqual(listing.fields, [['账号', 'me@example.com'], ['密码', '••••••••••••••'], ['网址', 'https://github.com/login'], ['备注', '主力开发账号']]);
  assert.equal(listing.avatar, 'G');
  assert.equal(listing.html, false, 'the password never reaches the DOM before 显示');
  await shot('credentials-detail');

  // Enter in the search copies the selected password; the dark toast counts down to clearing.
  await key('Return');
  const copied = await run(`
    await new Promise((resolve) => setTimeout(resolve, 60));
    const toast = document.getElementById('credential-toast');
    return { copies: window.__copies.slice(), hidden: toast.hidden, text: toast.querySelector('[data-toast-text]').textContent, bar: toast.querySelector('i').style.width };
  `);
  assert.deepEqual(copied.copies, [['p1', 'password']]);
  assert.equal(copied.hidden, false);
  assert.equal(copied.text, '密码已复制 · 60 秒后从剪贴板清除');
  assert.equal(copied.bar, '100%');
  await shot('credentials-toast');

  const cleared = await run(`
    document.getElementById('credential-toast-clear').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    return { cleared: window.__cleared, hidden: document.getElementById('credential-toast').hidden };
  `);
  assert.deepEqual(cleared, { cleared: 1, hidden: true });

  // ↓ moves the selection; 显示 fetches once and masks again on the second click.
  await key('Down');
  const moved = await run(`
    const detail = document.getElementById('credential-detail');
    const out = { title: detail.querySelector('h2').textContent, fields: [...detail.querySelectorAll('.cred-field-label')].map((node) => node.textContent) };
    detail.querySelector('[data-action="reveal"]').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    out.revealed = [...detail.querySelectorAll('.cred-field-value')].map((node) => node.textContent);
    out.gets = window.__gets.slice();
    detail.querySelector('[data-action="reveal"]').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    out.masked = detail.innerHTML.includes('secret-value');
    detail.querySelector('[data-copy="env"]').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    out.env = { copies: window.__copies.slice(-1), text: document.querySelector('#credential-toast [data-toast-text]').textContent };
    return out;
  `);
  assert.equal(moved.title, 'OpenAI');
  assert.deepEqual(moved.fields, ['变量名', 'API Key', '环境变量']);
  assert.deepEqual(moved.revealed, ['OPENAI_API_KEY', 'secret-value', 'OPENAI_API_KEY=••••']);
  assert.deepEqual(moved.gets, ['k1']);
  assert.equal(moved.masked, false);
  assert.deepEqual(moved.env.copies, [['k1', 'env']]);
  assert.equal(moved.env.text, 'OPENAI_API_KEY=… 已复制 · 60 秒后从剪贴板清除');

  // ⌘C with nothing selected in the page copies the account (focus outside inputs).
  await run(`document.activeElement?.blur(); return true;`);
  await key('C', ['meta']);
  const account = await run(`return window.__copies.slice(-1);`);
  assert.deepEqual(account, [['k1', 'account']]);

  // ⌘N opens the sheet; a new API key derives its variable name and becomes the selection.
  await key('N', ['meta']);
  const sheet = await run(`
    const $ = (id) => document.getElementById(id);
    const out = { open: !$('credential-sheet').hidden, title: $('credential-form-title').textContent, focused: document.activeElement?.id };
    document.querySelector('[data-credential-kind="apikey"]').click();
    $('credential-service').value = 'DeepSeek';
    $('credential-service').dispatchEvent(new Event('input', { bubbles: true }));
    out.apiForm = { account: $('credential-account-label').textContent, password: $('credential-password-label').textContent, placeholder: $('credential-account').placeholder, generateHidden: $('credential-generate').hidden };
    $('credential-password').value = 'sk-123';
    return out;
  `);
  assert.equal(sheet.open, true);
  assert.equal(sheet.title, '新增密钥');
  assert.equal(sheet.focused, 'credential-service');
  assert.deepEqual(sheet.apiForm, { account: '变量名（可选）', password: 'API Key', placeholder: '默认 DEEPSEEK_API_KEY，用于「复制为 KEY=value」', generateHidden: true });
  await shot('credentials-sheet');
  await key('Return', ['meta']);
  const saved = await run(`
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { payload: window.__saved[0], hidden: document.getElementById('credential-sheet').hidden, title: document.querySelector('#credential-detail h2').textContent, selected: window.NotchCredentials.state().selectedId };
  `);
  assert.deepEqual(saved.payload, { kind: 'apikey', service: 'DeepSeek', account: '', password: 'sk-123', url: '', note: '' });
  assert.equal(saved.hidden, true);
  assert.equal(saved.title, 'DeepSeek');
  assert.equal(saved.selected, 'n4');

  // Password form: missing account is caught; the generator fills and reveals a strong password; Escape closes.
  const form = await run(`
    const $ = (id) => document.getElementById(id);
    $('credential-new').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    document.querySelector('[data-credential-kind="password"]').click();
    const out = { cleared: $('credential-service').value === '' && $('credential-password').value === '' };
    $('credential-service').value = 'Figma';
    $('credential-password').value = 'x';
    $('credential-save').click();
    await new Promise((resolve) => setTimeout(resolve, 60));
    out.missingAccount = $('credentials-note').textContent;
    $('credential-generate').click();
    const generated = $('credential-password').value;
    out.generated = { length: generated.length, type: $('credential-password').type, options: !$('credential-generator').hidden, classes: [/[A-Z]/, /[a-z]/, /[2-9]/, /[!@#$%^&*\\-_=+?]/].every((pattern) => pattern.test(generated)) };
    $('credential-generator-length').value = '32';
    $('credential-generator-length').dispatchEvent(new Event('change', { bubbles: true }));
    $('credential-generator-symbols').checked = false;
    $('credential-generator-symbols').dispatchEvent(new Event('change', { bubbles: true }));
    out.regenerated = { length: $('credential-password').value.length, plain: /^[A-Za-z2-9]+$/.test($('credential-password').value) };
    const card = document.querySelector('.cred-sheet-card').getBoundingClientRect();
    out.overflow = [...document.querySelectorAll('.cred-sheet-card input, .cred-sheet-card button, .cred-sheet-card select')].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.width && (r.left < card.left - 1 || r.right > card.right + 1);
    }).map((node) => node.id || node.className);
    out.escape = window.NotchCredentials.escape();
    out.hidden = $('credential-sheet').hidden;
    out.passwordCleared = $('credential-password').value === '';
    return out;
  `);
  assert.equal(form.cleared, true);
  assert.equal(form.missingAccount, '请填写名称、账号和密码。');
  assert.deepEqual(form.generated, { length: 20, type: 'text', options: true, classes: true });
  assert.deepEqual(form.regenerated, { length: 32, plain: true });
  assert.deepEqual(form.overflow, []);
  assert.deepEqual([form.escape, form.hidden, form.passwordCleared], [true, true, true]);

  // Editing loads the stored values once and keeps the kind; ⋯ → 删除 needs a second click.
  const edited = await run(`
    const $ = (id) => document.getElementById(id);
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('.cred-row[data-id="k1"]').click();
    document.querySelector('#credential-detail [data-action="edit"]').click();
    await settle();
    const out = {
      title: $('credential-form-title').textContent,
      values: [$('credential-service').value, $('credential-account').value, $('credential-password').value, $('credential-password').type],
      kind: document.querySelector('[data-credential-kind][aria-checked="true"]').dataset.credentialKind,
    };
    $('credential-note').value = '团队共用';
    $('credential-form').requestSubmit();
    await settle(150);
    out.saved = window.__saved.at(-1);
    out.note = [...document.querySelectorAll('#credential-detail .cred-field')].find((row) => row.querySelector('.cred-field-label').textContent === '备注')?.querySelector('.cred-field-value').textContent;

    document.querySelector('.cred-row[data-id="p1"]').click();
    document.querySelector('#credential-detail [data-action="more"]').click();
    const menu = document.querySelector('#credential-detail .cred-menu');
    out.menu = { hidden: menu.hidden, items: [...menu.querySelectorAll('button')].map((node) => node.textContent) };
    menu.querySelector('[data-copy="url"]').click();
    await settle();
    out.urlCopy = window.__copies.slice(-1);
    document.querySelector('#credential-detail [data-action="more"]').click();
    document.querySelector('#credential-detail [data-action="delete"]').click();
    await settle();
    out.firstDelete = { label: document.querySelector('#credential-detail [data-action="delete"]').textContent, deleted: window.__deleted.slice() };
    document.querySelector('#credential-detail [data-action="delete"]').click();
    await settle(150);
    out.secondDelete = { deleted: window.__deleted.slice(), names: [...document.querySelectorAll('.cred-row b')].map((node) => node.textContent) };
    document.querySelector('#credential-detail [data-action="open-url"]')?.click();
    return out;
  `);
  assert.equal(edited.title, '编辑密钥');
  assert.deepEqual(edited.values, ['OpenAI', 'OPENAI_API_KEY', 'secret-value', 'password']);
  assert.equal(edited.kind, 'apikey');
  assert.equal(edited.saved.kind, 'apikey');
  assert.equal(edited.saved.id, 'k1');
  assert.equal(edited.saved.note, '团队共用');
  assert.equal(edited.note, '团队共用');
  assert.deepEqual(edited.menu, { hidden: false, items: ['复制网址', '删除'] });
  assert.deepEqual(edited.urlCopy, [['p1', 'url']]);
  assert.deepEqual(edited.firstDelete, { label: '确认删除', deleted: [] });
  assert.deepEqual(edited.secondDelete.deleted, ['p1']);
  assert.equal(edited.secondDelete.names.includes('GitHub'), false);

  // Search matches name/account/url; no results shows a hint; locking clears everything.
  const searched = await run(`
    const $ = (id) => document.getElementById(id);
    $('credential-search').value = 'deep';
    $('credential-search').dispatchEvent(new Event('input', { bubbles: true }));
    const out = { names: [...document.querySelectorAll('.cred-row b')].map((node) => node.textContent), title: document.querySelector('#credential-detail h2')?.textContent };
    $('credential-search').value = 'zzz';
    $('credential-search').dispatchEvent(new Event('input', { bubbles: true }));
    out.empty = document.querySelector('#credential-list .cred-empty strong')?.textContent;
    $('credential-search').value = '';
    $('credential-search').dispatchEvent(new Event('input', { bubbles: true }));
    window.notchAPI.listCredentials = async () => ({ ok: true, secureStorage: true, locked: true, items: [] });
    document.dispatchEvent(new CustomEvent('notch:vault-changed', { detail: { locked: true } }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    out.locked = { rows: document.querySelectorAll('.cred-row').length, state: window.NotchCredentials.state().locked };
    return out;
  `);
  assert.deepEqual(searched.names, ['DeepSeek']);
  assert.equal(searched.title, 'DeepSeek');
  assert.equal(searched.empty, '没有找到');
  assert.deepEqual(searched.locked, { rows: 0, state: true });

  assert.deepEqual(errors, []);
  console.log('Credentials checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
