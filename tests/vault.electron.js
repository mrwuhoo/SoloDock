const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Vault renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const shot = async (name, selector) => {
    if (!process.env.SOLODOCK_VAULT_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_VAULT_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  };

  // A fake main process: same rules as vault-lock.js, kept tiny.
  const setupScript = `(async () => {
    const vault = window.__vault = { enabled: false, setupSeen: false, locked: false, system: 'touchid', password: null, autoLockMinutes: 10, cooldownUntil: 0, failures: 0, approve: true };
    const items = [{ id: 'c1', service: 'GitHub', account: 'me@example.com', passwordMask: '**********', createdAt: 1 }];
    window.notchAPI = {
      getVaultStatus: async () => ({
        enabled: vault.enabled, setupSeen: vault.setupSeen, locked: vault.enabled && vault.locked, system: vault.system,
        hasPassword: Boolean(vault.password), autoLockMinutes: vault.autoLockMinutes,
        lockAt: vault.enabled && !vault.locked ? Date.now() + vault.autoLockMinutes * 60000 : null,
        cooldownUntil: vault.cooldownUntil > Date.now() ? vault.cooldownUntil : 0, attemptsLeft: 5 - vault.failures,
        configFile: '/Users/me/Library/Application Support/SoloDock/vault-lock.json',
      }),
      configureVault: async (options) => {
        if (vault.enabled && vault.locked) return { ok: false, error: 'locked' };
        if (typeof options.password === 'string') vault.password = options.password;
        if (options.removePassword) vault.password = null;
        if (options.autoLockMinutes) vault.autoLockMinutes = options.autoLockMinutes;
        const enabled = options.enabled === undefined ? vault.enabled : options.enabled;
        if (enabled && !vault.password && !vault.system) return { ok: false, error: 'password_required' };
        vault.enabled = enabled; vault.setupSeen = true; vault.locked = false;
        return { ok: true };
      },
      unlockVault: async (method, password) => {
        if (method === 'system') { if (!vault.approve) return { ok: false, error: 'canceled' }; vault.locked = false; return { ok: true }; }
        if (vault.cooldownUntil > Date.now()) return { ok: false, error: 'cooldown', cooldownUntil: vault.cooldownUntil };
        if (password === vault.password) { vault.locked = false; vault.failures = 0; return { ok: true }; }
        vault.failures += 1;
        if (vault.failures >= 2) { vault.failures = 0; vault.cooldownUntil = Date.now() + 3000; return { ok: false, error: 'cooldown', cooldownUntil: vault.cooldownUntil }; }
        return { ok: false, error: 'wrong', attemptsLeft: 5 - vault.failures };
      },
      lockVault: async () => { if (vault.enabled) vault.locked = true; return { ok: true }; },
      touchVault: async () => ({ ok: true }),
      dismissVaultSetup: async () => { vault.setupSeen = true; return { ok: true }; },
      resetVaultPassword: async () => { if (!vault.system || !vault.approve) return { ok: false, error: 'canceled' }; vault.password = null; vault.locked = false; return { ok: true }; },
      listCredentials: async () => ({ ok: true, secureStorage: true, locked: vault.enabled && vault.locked, items: vault.enabled && vault.locked ? [] : items }),
      getCredential: async (id) => (vault.locked ? { ok: false, error: 'locked' } : { ok: true, item: { ...items[0], password: 'hunter22' } }),
      copyCredential: async () => !vault.locked,
    };
    await setMode(true);
    await setActiveTab('credentials');
    await window.NotchVault.refresh();
    await new Promise((resolve) => setTimeout(resolve, 60));
  })()`;
  await win.webContents.executeJavaScript(setupScript);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const visible = (el) => Boolean(el) && !el.hidden && getComputedStyle(el).display !== 'none';
    const names = () => [...document.querySelectorAll('#credential-list .credential-item strong')].map((node) => node.textContent);
    const out = {};
    out.initial = { setup: visible($('vault-setup')), lock: visible($('vault-lock')), names: names(), timer: visible($('vault-auto-lock')) };

    $('vault-setup-enable').click();
    await settle();
    out.enabled = { setup: visible($('vault-setup')), timer: $('vault-auto-lock').textContent, lockNow: visible($('vault-lock-now')), toast: $('status-toast-message').textContent };

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', metaKey: true, bubbles: true }));
    await settle(120);
    out.locked = {
      lock: visible($('vault-lock')),
      page: getComputedStyle(document.querySelector('.credentials-page')).display,
      names: names(),
      system: $('vault-unlock-system').textContent,
      passwordForm: visible($('vault-unlock-password')),
      hint: $('vault-lock-hint').textContent,
    };
    // Settings can't be changed while locked.
    out.settingsWhileLocked = { disabled: $('settings-vault-enabled').disabled, note: $('settings-vault-note').textContent };

    window.__vault.approve = false;
    $('vault-unlock-system').click();
    await settle(120);
    out.canceled = { error: $('vault-lock-error').textContent, lock: visible($('vault-lock')) };
    window.__vault.approve = true;
    $('vault-unlock-system').click();
    await settle(120);
    out.unlocked = { lock: visible($('vault-lock')), names: names(), error: $('vault-lock-error').textContent };
    return out;
  })()`);

  assert.deepEqual(result.initial, { setup: true, lock: false, names: ['GitHub'], timer: false });
  assert.equal(result.enabled.setup, false);
  assert.equal(result.enabled.timer, '10 分钟后自动锁定');
  assert.equal(result.enabled.lockNow, true);
  assert.match(result.enabled.toast, /密钥锁已开启/);
  assert.deepEqual(result.locked, { lock: true, page: 'none', names: [], system: '使用 Touch ID 解锁', passwordForm: false, hint: '10 分钟未使用、锁屏或休眠后会自动锁定' });
  assert.equal(result.settingsWhileLocked.disabled, true);
  assert.match(result.settingsWhileLocked.note, /先到密钥页解锁/);
  assert.deepEqual(result.canceled, { error: '没有通过验证，可以再试一次', lock: true });
  assert.deepEqual(result.unlocked, { lock: false, names: ['GitHub'], error: '' });
  await shot('vault-unlocked', '#tab-credentials');

  const passwordFlow = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const visible = (el) => Boolean(el) && !el.hidden && getComputedStyle(el).display !== 'none';
    const out = {};
    // Master password in settings: mismatch, then saved.
    await setActiveTab('settings');
    await settle();
    out.settingsNoteCleared = $('settings-vault-note').textContent;
    $('settings-vault-password-edit').click();
    $('settings-vault-password-new').value = 'blue-sky-42';
    $('settings-vault-password-confirm').value = 'blue-sky-43';
    $('settings-vault-password-form').requestSubmit();
    await settle();
    out.mismatch = $('settings-vault-note').textContent;
    $('settings-vault-password-new').value = 'blue-sky-42';
    $('settings-vault-password-confirm').value = 'blue-sky-42';
    $('settings-vault-password-form').requestSubmit();
    await settle();
    out.saved = { note: $('settings-vault-note').textContent, state: $('settings-vault-password-state').textContent, status: $('settings-vault-status').textContent, formHidden: $('settings-vault-password-form').hidden };

    // Lock, then a wrong password, then the cooldown.
    await setActiveTab('credentials');
    $('vault-lock-now').click();
    await settle(120);
    out.passwordForm = visible($('vault-unlock-password'));
    out.forgot = visible($('vault-forgot'));
    $('vault-password').value = 'nope';
    $('vault-unlock-password').requestSubmit();
    await settle(120);
    out.wrong = $('vault-lock-error').textContent;
    $('vault-password').value = 'nope again';
    $('vault-unlock-password').requestSubmit();
    await settle(120);
    out.cooldown = { error: $('vault-lock-error').textContent, disabled: $('vault-password').disabled };
    return out;
  })()`);
  assert.equal(passwordFlow.settingsNoteCleared, '', 'the "locked" note goes away after unlocking');
  assert.equal(passwordFlow.mismatch, '两次输入的主密码不一致');
  assert.deepEqual(passwordFlow.saved, { note: '主密码已保存。', state: '已设置', status: '已开启 · Touch ID / 主密码', formHidden: true });
  assert.equal(passwordFlow.passwordForm, true);
  assert.equal(passwordFlow.forgot, true);
  assert.equal(passwordFlow.wrong, '主密码不对，还可以再试 4 次');
  assert.match(passwordFlow.cooldown.error, /^主密码输错太多次，请 [23] 秒后再试$/);
  assert.equal(passwordFlow.cooldown.disabled, true);
  await shot('vault-locked', '#tab-credentials');

  const resetAndReveal = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const out = {};
    $('vault-forgot').click();
    await settle(120);
    out.reset = { locked: $('vault-lock').hidden === false, toast: $('status-toast-message').textContent, hasPassword: window.NotchVault.status().hasPassword };

    // New-entry password is masked; 显示 reveals it until clicked again (or 10 seconds pass).
    const input = $('credential-password');
    const reveal = document.querySelector('.credential-reveal[data-reveal-for="credential-password"]');
    out.maskedByDefault = input.type;
    reveal.click();
    out.revealed = [input.type, reveal.textContent, reveal.getAttribute('aria-pressed')];
    reveal.click();
    out.remasked = input.type;

    // The inline edit form masks the stored password too.
    document.querySelector('#credential-list .credential-copy').click();
    await settle(120);
    const editInput = document.querySelector('.credential-item.editing input[name="password"]');
    out.editType = editInput?.type;
    document.querySelector('.credential-item.editing .credential-reveal').click();
    out.editRevealed = editInput?.type;
    return out;
  })()`);
  assert.deepEqual(resetAndReveal.reset, { locked: false, toast: '主密码已清除，密钥都还在；可以在设置里重新设置主密码', hasPassword: false });
  assert.equal(resetAndReveal.maskedByDefault, 'password');
  assert.deepEqual(resetAndReveal.revealed, ['text', '隐藏', 'true']);
  assert.equal(resetAndReveal.remasked, 'password');
  assert.equal(resetAndReveal.editType, 'password');
  assert.equal(resetAndReveal.editRevealed, 'text');

  // A Mac whose Touch ID is unavailable (lid closed): the system sheet asks for the login password instead.
  const macPassword = await win.webContents.executeJavaScript(`(async () => {
    Object.assign(window.__vault, { enabled: true, locked: true, system: 'mac-password', password: null });
    await window.NotchVault.refresh();
    const out = { button: document.getElementById('vault-unlock-system').textContent, hidden: document.getElementById('vault-unlock-system').hidden };
    window.__vault.locked = false;
    await window.NotchVault.refresh();
    out.method = document.getElementById('settings-vault-method').textContent;
    return out;
  })()`);
  assert.deepEqual(macPassword, { button: '使用电脑登录密码解锁', hidden: false, method: '用电脑登录密码解锁，主密码可选' });

  // A computer without Touch ID / Windows Hello: turning the lock on asks for a master password first.
  const noSystem = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    Object.assign(window.__vault, { enabled: false, setupSeen: false, locked: false, system: null, password: null });
    await window.NotchVault.refresh();
    const out = { setupText: $('vault-setup-text').textContent };
    $('vault-setup-enable').click();
    await settle(120);
    out.tab = document.querySelector('#tab-settings.active') !== null;
    out.formOpen = !$('settings-vault-password-form').hidden;
    $('settings-vault-password-new').value = 'offline-pass';
    $('settings-vault-password-confirm').value = 'offline-pass';
    $('settings-vault-password-form').requestSubmit();
    await settle(120);
    out.after = { enabled: window.__vault.enabled, note: $('settings-vault-note').textContent, method: $('settings-vault-method').textContent };
    out.hint = $('settings-vault-hint').textContent;
    // Forgetting the master password without Touch ID: the lock screen explains how to reset it.
    await setActiveTab('credentials');
    window.__vault.locked = true;
    await window.NotchVault.refresh();
    $('vault-forgot').click();
    out.forgotAdvice = $('vault-lock-error').textContent;
    return out;
  })()`);
  assert.match(noSystem.setupText, /需要先设一个主密码/);
  assert.equal(noSystem.tab, true);
  assert.equal(noSystem.formOpen, true);
  assert.deepEqual(noSystem.after, { enabled: true, note: '主密码已保存，密钥锁已开启。', method: '这台电脑没有 Touch ID / Windows Hello，需要主密码' });
  assert.match(noSystem.hint, /删除 \/Users\/me\/Library\/Application Support\/SoloDock\/vault-lock\.json 后重新打开即可重置/);
  assert.match(noSystem.forgotAdvice, /vault-lock\.json 后重新打开即可重置，密钥不受影响/);
  await win.webContents.executeJavaScript(`document.getElementById('settings-vault-card').scrollIntoView({ block: 'start' })`);
  await shot('vault-settings', '#settings-vault-card');

  assert.deepEqual(errors, []);
  console.log('Vault lock checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
