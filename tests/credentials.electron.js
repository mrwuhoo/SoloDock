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

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const store = [
      { id: 'p1', kind: 'password', service: 'GitHub', account: 'me@example.com', url: 'https://github.com', note: '', passwordMask: '**********', createdAt: 1, lastUsedAt: 0 },
      { id: 'k1', kind: 'apikey', service: 'OpenAI', account: 'OPENAI_API_KEY', url: '', note: '', passwordMask: '**********', createdAt: 2, lastUsedAt: 0 },
    ];
    window.__copies = []; window.__saved = []; window.__deleted = [];
    window.notchAPI = {
      getVaultStatus: async () => ({ enabled: false, setupSeen: true, locked: false, system: 'touchid', hasPassword: false, autoLockMinutes: 10, lockAt: null, cooldownUntil: 0, attemptsLeft: 5 }),
      listCredentials: async () => ({ ok: true, secureStorage: true, locked: false, items: store.slice() }),
      saveCredential: async (payload) => {
        window.__saved.push(payload);
        const existing = store.find((item) => item.id === payload.id);
        if (existing) Object.assign(existing, payload);
        else store.push({ ...payload, id: 'n' + store.length, account: payload.account || 'DEEPSEEK_API_KEY', passwordMask: '**********', createdAt: 10 + store.length, lastUsedAt: 0 });
        return { ok: true };
      },
      copyCredential: async (id, field) => { window.__copies.push([id, field]); return true; },
      deleteCredentials: async (ids) => { window.__deleted.push(...ids); ids.forEach((id) => store.splice(store.findIndex((item) => item.id === id), 1)); return { ok: true, deleted: ids.length }; },
      getCredential: async (id) => ({ ok: true, item: { ...store.find((item) => item.id === id), password: 'secret-value' } }),
    };
    await setMode(true);
    await setActiveTab('credentials');
    await window.NotchVault.refresh();
    document.dispatchEvent(new CustomEvent('notch:vault-changed', { detail: { locked: false } }));
    await settle(120);
    const rows = () => [...document.querySelectorAll('#credential-list .credential-item:not(.editing)')];
    const describe = () => rows().map((row) => ({
      name: row.querySelector('strong').textContent,
      tag: row.querySelector('.credential-kind-tag').textContent,
      actions: [...row.querySelectorAll('.credential-actions button')].map((button) => button.textContent),
      mask: row.querySelector('code').textContent,
    }));
    const out = { rows: describe() };

    // KEY=value for the API key.
    rows()[0].querySelector('[data-credential-copy="env"]').click();
    await settle();
    out.envCopy = { copies: window.__copies.slice(), note: $('credentials-note').textContent };

    // New API key: labels, derived variable name, payload.
    document.querySelector('[data-credential-kind="apikey"]').click();
    $('credential-service').value = 'DeepSeek';
    $('credential-service').dispatchEvent(new Event('input', { bubbles: true }));
    out.apiForm = {
      account: $('credential-account-label').textContent,
      password: $('credential-password-label').textContent,
      placeholder: $('credential-account').placeholder,
      generateHidden: $('credential-generate').hidden,
    };
    $('credential-password').value = 'sk-123';
    $('credential-save').click();
    await settle(120);
    out.apiSaved = { payload: window.__saved[0], note: $('credentials-note').textContent, rows: rows().length };

    // Back to passwords: missing account is caught; the generator fills and reveals a strong password.
    document.querySelector('[data-credential-kind="password"]').click();
    $('credential-service').value = 'Figma';
    $('credential-password').value = 'x';
    $('credential-save').click();
    await settle();
    out.missingAccount = $('credentials-note').textContent;
    $('credential-generate').click();
    const generated = $('credential-password').value;
    out.generated = { length: generated.length, type: $('credential-password').type, options: !$('credential-generator').hidden, classes: [/[A-Z]/, /[a-z]/, /[2-9]/, /[!@#$%^&*\\-_=+?]/].every((pattern) => pattern.test(generated)) };
    $('credential-generator-length').value = '32';
    $('credential-generator-length').dispatchEvent(new Event('change', { bubbles: true }));
    $('credential-generator-symbols').checked = false;
    $('credential-generator-symbols').dispatchEvent(new Event('change', { bubbles: true }));
    out.regenerated = { length: $('credential-password').value.length, plain: /^[A-Za-z2-9]+$/.test($('credential-password').value) };

    // Delete needs a second click.
    const github = rows().find((row) => row.querySelector('strong').textContent === 'GitHub');
    const remove = github.querySelector('[data-credential-delete]');
    remove.click();
    await settle();
    out.firstDelete = { label: remove.textContent, deleted: window.__deleted.slice() };
    remove.click();
    await settle(120);
    out.secondDelete = { deleted: window.__deleted.slice(), names: describe().map((row) => row.name) };

    // Search by URL / name.
    $('credential-search').value = 'deep';
    $('credential-search').dispatchEvent(new Event('input', { bubbles: true }));
    out.search = describe().map((row) => row.name);
    $('credential-search').value = '';
    $('credential-search').dispatchEvent(new Event('input', { bubbles: true }));

    // Editing an API key shows its own labels and keeps the kind on save.
    const openai = rows().find((row) => row.querySelector('strong').textContent === 'OpenAI');
    openai.querySelector('.credential-copy').click();
    await settle(120);
    const form = document.querySelector('.credential-item.editing');
    out.edit = {
      labels: [...form.querySelectorAll('label > span:first-child')].map((span) => span.textContent),
      passwordType: form.elements.password.type,
      account: form.elements.account.value,
    };
    form.elements.note.value = '团队共用';
    form.requestSubmit();
    await settle(120);
    out.editSaved = window.__saved.at(-1);

    // Everything stays inside its card.
    const inside = (container, selector) => {
      const box = container.getBoundingClientRect();
      return [...container.querySelectorAll(selector)].filter((node) => {
        const r = node.getBoundingClientRect();
        return r.width && (r.left < box.left - 1 || r.right > box.right + 1);
      }).map((node) => node.id || node.className || node.tagName);
    };
    out.formOverflow = inside(document.querySelector('.credentials-form-card'), 'input, button, select, label');
    out.rowOverflow = rows().flatMap((row) => inside(row, 'button, strong, span, code'));
    return out;
  })()`);

  assert.deepEqual(result.rows, [
    { name: 'OpenAI', tag: 'API Key', actions: ['复制', 'KEY=value', '删除'], mask: '••••••••••' },
    { name: 'GitHub', tag: '密码', actions: ['账号', '密码', '删除'], mask: '••••••••••' },
  ]);
  assert.deepEqual(result.envCopy.copies, [['k1', 'env']]);
  assert.equal(result.envCopy.note, 'KEY=value 已复制 · 不进剪贴板历史，60 秒后自动清除');
  assert.deepEqual(result.apiForm, { account: '变量名（可选）', password: 'API Key', placeholder: '默认 DEEPSEEK_API_KEY，用于「复制为 KEY=value」', generateHidden: true });
  assert.deepEqual(result.apiSaved.payload, { kind: 'apikey', service: 'DeepSeek', account: '', password: 'sk-123', url: '', note: '' });
  assert.equal(result.apiSaved.note, 'API Key 已加密保存。');
  assert.equal(result.apiSaved.rows, 3);
  assert.equal(result.missingAccount, '请填写名称、账号和密码。');
  assert.deepEqual(result.generated, { length: 20, type: 'text', options: true, classes: true });
  assert.deepEqual(result.regenerated, { length: 32, plain: true });
  assert.deepEqual(result.firstDelete, { label: '确认删除', deleted: [] });
  assert.deepEqual(result.secondDelete.deleted, ['p1']);
  assert.equal(result.secondDelete.names.includes('GitHub'), false);
  assert.deepEqual(result.search, ['DeepSeek']);
  assert.deepEqual(result.edit, { labels: ['名称', '变量名', 'API Key', '网址', '备注'], passwordType: 'password', account: 'OPENAI_API_KEY' });
  assert.equal(result.editSaved.kind, 'apikey');
  assert.equal(result.editSaved.note, '团队共用');
  assert.deepEqual(result.formOverflow, []);
  assert.deepEqual(result.rowOverflow, []);
  await shot('credentials');

  assert.deepEqual(errors, []);
  console.log('Credentials checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
