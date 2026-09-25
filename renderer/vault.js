// 密钥锁界面：锁定页、首次开启引导、列表头的自动锁定倒计时、设置里的「密钥锁」卡片，
// 以及密码框的「显示 10 秒」。锁状态以主进程为准（vault-lock.js），这里只负责展示和发起请求。
(function bootstrapVaultLock() {
  'use strict';

  const get = (id) => document.getElementById(id);
  const tab = get('tab-credentials');
  const lockView = get('vault-lock');
  if (!tab || !lockView) return;

  const REVEAL_MS = 10_000;
  const TOUCH_THROTTLE_MS = 20_000;
  const SYSTEM_NAMES = { touchid: 'Touch ID', 'mac-password': '电脑登录密码', hello: 'Windows Hello' };
  const els = {
    hint: get('vault-lock-hint'),
    system: get('vault-unlock-system'),
    passwordForm: get('vault-unlock-password'),
    password: get('vault-password'),
    passwordSubmit: get('vault-unlock-password-submit'),
    error: get('vault-lock-error'),
    forgot: get('vault-forgot'),
    setup: get('vault-setup'),
    setupText: get('vault-setup-text'),
    autoLock: get('vault-auto-lock'),
    lockNow: get('vault-lock-now'),
    settingsStatus: get('settings-vault-status'),
    settingsEnabled: get('settings-vault-enabled'),
    settingsMethod: get('settings-vault-method'),
    settingsAuto: get('settings-vault-auto'),
    settingsPasswordState: get('settings-vault-password-state'),
    settingsPasswordEdit: get('settings-vault-password-edit'),
    settingsPasswordRemove: get('settings-vault-password-remove'),
    settingsPasswordForm: get('settings-vault-password-form'),
    settingsPasswordNew: get('settings-vault-password-new'),
    settingsPasswordConfirm: get('settings-vault-password-confirm'),
    settingsNote: get('settings-vault-note'),
  };
  const api = () => window.notchAPI || {};
  const toast = (message, options) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message, options);
  };

  let status = null;
  let lastLocked = null;
  let cooldownTimer = null;
  let lastTouch = 0;

  const systemName = () => SYSTEM_NAMES[status?.system] || '';
  // 中文里夹英文名称时两侧留空格，纯中文不留：「使用 Touch ID 解锁」「使用电脑登录密码解锁」。
  const spaced = (name) => (/^[A-Za-z]/.test(name) ? ` ${name} ` : name);

  async function refresh() {
    const next = await api().getVaultStatus?.().catch(() => null);
    if (!next) return;
    status = next;
    render();
    if (lastLocked !== status.locked) {
      lastLocked = status.locked;
      document.dispatchEvent(new CustomEvent('notch:vault-changed', { detail: { locked: status.locked } }));
    }
  }

  function minutesLeft() {
    if (!status?.lockAt) return 0;
    return Math.max(1, Math.ceil((status.lockAt - Date.now()) / 60_000));
  }

  function render() {
    if (!status) return;
    const locked = status.enabled && status.locked;
    tab.dataset.vaultLocked = locked ? 'true' : 'false';
    lockView.hidden = !locked;

    // 锁定页
    const name = systemName();
    els.hint.textContent = `${status.autoLockMinutes} 分钟未使用、锁屏或休眠后会自动锁定`;
    els.system.hidden = !name;
    els.system.textContent = name ? `使用${spaced(name)}解锁` : '';
    els.passwordForm.hidden = !status.hasPassword;
    els.password.placeholder = name ? '或输入主密码' : '输入主密码';
    els.forgot.hidden = !status.hasPassword;
    if (locked && !name && !status.hasPassword) {
      els.error.textContent = '没有可用的解锁方式，请重启 SoloDock 后再试';
    }
    renderCooldown();

    // 首次引导：还没开锁、也没点过「以后再说」
    els.setup.hidden = locked || status.enabled || status.setupSeen;
    els.setupText.textContent = name
      ? `${status.autoLockMinutes} 分钟未使用、锁屏或休眠后自动锁定，用${spaced(name)}解锁。`
      : `${status.autoLockMinutes} 分钟未使用、锁屏或休眠后自动锁定。这台电脑没有 Touch ID / Windows Hello，需要先设一个主密码。`;

    // 列表头
    const showTimer = status.enabled && !status.locked;
    els.autoLock.hidden = !showTimer;
    els.lockNow.hidden = !showTimer;
    if (showTimer) els.autoLock.textContent = `${minutesLeft()} 分钟后自动锁定`;

    // 设置卡片
    const methods = [name, status.hasPassword ? '主密码' : ''].filter(Boolean).join(' / ');
    els.settingsStatus.textContent = status.enabled ? `已开启 · ${methods || '无'}` : '未开启';
    els.settingsEnabled.checked = status.enabled;
    els.settingsMethod.textContent = name ? `用${spaced(name)}解锁，主密码可选` : '这台电脑没有 Touch ID / Windows Hello，需要主密码';
    get('settings-vault-hint').textContent = `防的是别人趁你离开时打开密钥页；密钥本身始终由系统钥匙串加密。${forgotAdvice()}`;
    els.settingsAuto.value = String(status.autoLockMinutes);
    els.settingsPasswordState.textContent = status.hasPassword ? '已设置' : '未设置';
    els.settingsPasswordEdit.textContent = status.hasPassword ? '修改' : '设置';
    els.settingsPasswordRemove.hidden = !status.hasPassword;
    const editable = !locked;
    [els.settingsEnabled, els.settingsAuto, els.settingsPasswordEdit, els.settingsPasswordRemove].forEach((control) => { control.disabled = !editable; });
    if (!editable) {
      els.settingsPasswordForm.hidden = true;
      setSettingsNote('密钥已锁定：先到密钥页解锁，再修改这些设置。');
    } else if (els.settingsNote.dataset.lockedNote === 'true') {
      setSettingsNote('');
    }
    if (!editable) els.settingsNote.dataset.lockedNote = 'true';
  }

  function forgotAdvice() {
    const name = systemName();
    const how = status?.system === 'touchid' ? 'Touch ID 或电脑登录密码' : name;
    return name
      ? `忘记主密码可以用 ${how}重置，不会丢失任何密钥。`
      : `忘记主密码：退出 SoloDock，删除 ${status?.configFile || 'vault-lock.json'} 后重新打开即可重置，密钥不受影响。`;
  }

  function renderCooldown() {
    if (cooldownTimer) clearTimeout(cooldownTimer);
    cooldownTimer = null;
    const remaining = Math.ceil(((status?.cooldownUntil || 0) - Date.now()) / 1000);
    const cooling = remaining > 0;
    els.password.disabled = cooling;
    els.passwordSubmit.disabled = cooling;
    if (cooling) {
      els.error.textContent = `主密码输错太多次，请 ${remaining} 秒后再试`;
      cooldownTimer = setTimeout(renderCooldown, 1000);
    } else if (els.error.dataset.cooldown === 'true') {
      els.error.textContent = '';
    }
    els.error.dataset.cooldown = cooling ? 'true' : 'false';
  }

  function setSettingsNote(message, error = false) {
    els.settingsNote.textContent = message;
    els.settingsNote.classList.toggle('error', error);
    delete els.settingsNote.dataset.lockedNote;
  }

  const ERRORS = {
    canceled: '没有通过验证，可以再试一次',
    unavailable: '这台电脑现在无法使用系统验证',
    no_password: '还没有设置主密码',
    locked: '密钥已锁定，请先解锁',
    password_required: '这台电脑没有 Touch ID / Windows Hello，开启密钥锁需要先设置主密码',
    password_too_short: '主密码至少 6 位',
    save_failed: '保存失败，请稍后再试',
  };

  // ---------------- 解锁 ----------------
  els.system.addEventListener('click', async () => {
    els.system.disabled = true;
    els.error.textContent = status?.system === 'touchid' ? '请按一下 Touch ID…' : `请在系统窗口里输入${systemName()}…`;
    const result = await api().unlockVault?.('system').catch(() => ({ ok: false, error: 'canceled' }));
    els.system.disabled = false;
    els.error.textContent = result?.ok ? '' : (ERRORS[result?.error] || ERRORS.canceled);
    await refresh();
  });

  els.passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = els.password.value;
    if (!password) return;
    els.passwordSubmit.disabled = true;
    const result = await api().unlockVault?.('password', password).catch(() => ({ ok: false }));
    els.passwordSubmit.disabled = false;
    els.password.value = '';
    if (result?.ok) els.error.textContent = '';
    else if (result?.error === 'wrong') els.error.textContent = `主密码不对，还可以再试 ${result.attemptsLeft} 次`;
    else if (result?.error !== 'cooldown') els.error.textContent = ERRORS[result?.error] || '解锁失败';
    await refresh();
    if (!status?.locked) return;
    els.password.focus();
  });

  els.forgot.addEventListener('click', async () => {
    if (!systemName()) {
      els.error.textContent = forgotAdvice();
      return;
    }
    const result = await api().resetVaultPassword?.().catch(() => ({ ok: false }));
    if (!result?.ok) {
      els.error.textContent = ERRORS[result?.error] || '重置失败';
      return;
    }
    await refresh();
    toast('主密码已清除，密钥都还在；可以在设置里重新设置主密码');
  });

  // ---------------- 引导与锁定 ----------------
  function openPasswordForm() {
    window.setActiveTab?.('settings');
    els.settingsPasswordForm.hidden = false;
    requestAnimationFrame(() => {
      if (!window.NotchSettings?.reveal?.('settings-vault-card')) get('settings-vault-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      els.settingsPasswordNew.focus();
    });
  }

  get('vault-setup-enable').addEventListener('click', async () => {
    if (!status?.system) {
      openPasswordForm();
      setSettingsNote('设置主密码后会自动开启密钥锁。');
      els.settingsPasswordForm.dataset.enableAfter = 'true';
      return;
    }
    const result = await api().configureVault?.({ enabled: true }).catch(() => ({ ok: false }));
    if (!result?.ok) {
      toast(ERRORS[result?.error] || '开启失败');
      return;
    }
    await refresh();
    toast(`密钥锁已开启：${status.autoLockMinutes} 分钟未使用、锁屏或休眠后自动锁定`);
  });

  get('vault-setup-later').addEventListener('click', async () => {
    await api().dismissVaultSetup?.().catch(() => {});
    await refresh();
  });

  async function lockNow() {
    if (!status?.enabled || status.locked) return;
    await api().lockVault?.().catch(() => {});
    await refresh();
  }
  els.lockNow.addEventListener('click', lockNow);
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'l' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if (!tab.classList.contains('active')) return;
    event.preventDefault();
    lockNow();
  });

  // 在密钥页里操作（搜索、滚动、点按）都算在使用，顺延自动锁定。
  const touch = () => {
    if (!status?.enabled || status.locked || Date.now() - lastTouch < TOUCH_THROTTLE_MS) return;
    lastTouch = Date.now();
    api().touchVault?.().then(refresh).catch(() => {});
  };
  ['pointerdown', 'keydown', 'wheel'].forEach((name) => tab.addEventListener(name, touch, { passive: true }));

  // ---------------- 设置卡片 ----------------
  els.settingsEnabled.addEventListener('change', async () => {
    const enabled = els.settingsEnabled.checked;
    const result = await api().configureVault?.({ enabled }).catch(() => ({ ok: false }));
    if (!result?.ok) {
      els.settingsEnabled.checked = !enabled;
      setSettingsNote(ERRORS[result?.error] || '修改失败', true);
      if (result?.error === 'password_required') {
        els.settingsPasswordForm.hidden = false;
        els.settingsPasswordForm.dataset.enableAfter = 'true';
        els.settingsPasswordNew.focus();
      }
      return;
    }
    setSettingsNote(enabled ? '密钥锁已开启。' : '密钥锁已关闭。');
    await refresh();
  });

  els.settingsAuto.addEventListener('change', async () => {
    const result = await api().configureVault?.({ autoLockMinutes: Number(els.settingsAuto.value) }).catch(() => ({ ok: false }));
    setSettingsNote(result?.ok ? '自动锁定时间已更新。' : (ERRORS[result?.error] || '修改失败'), !result?.ok);
    await refresh();
  });

  els.settingsPasswordEdit.addEventListener('click', () => {
    els.settingsPasswordForm.hidden = false;
    els.settingsPasswordNew.focus();
  });
  get('settings-vault-password-cancel').addEventListener('click', () => {
    els.settingsPasswordForm.hidden = true;
    els.settingsPasswordNew.value = '';
    els.settingsPasswordConfirm.value = '';
    delete els.settingsPasswordForm.dataset.enableAfter;
  });
  els.settingsPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = els.settingsPasswordNew.value;
    if (Array.from(password).length < 6) {
      setSettingsNote(ERRORS.password_too_short, true);
      return;
    }
    if (password !== els.settingsPasswordConfirm.value) {
      setSettingsNote('两次输入的主密码不一致', true);
      return;
    }
    const options = { password };
    if (els.settingsPasswordForm.dataset.enableAfter === 'true') options.enabled = true;
    const result = await api().configureVault?.(options).catch(() => ({ ok: false }));
    els.settingsPasswordNew.value = '';
    els.settingsPasswordConfirm.value = '';
    if (!result?.ok) {
      setSettingsNote(ERRORS[result?.error] || '保存失败', true);
      return;
    }
    els.settingsPasswordForm.hidden = true;
    const enabledNow = options.enabled === true;
    delete els.settingsPasswordForm.dataset.enableAfter;
    setSettingsNote(enabledNow ? '主密码已保存，密钥锁已开启。' : '主密码已保存。');
    await refresh();
  });
  els.settingsPasswordRemove.addEventListener('click', async () => {
    const result = await api().configureVault?.({ removePassword: true }).catch(() => ({ ok: false }));
    setSettingsNote(result?.ok ? '主密码已移除。' : (ERRORS[result?.error] || '移除失败'), !result?.ok);
    await refresh();
  });

  // ---------------- 显示密码 10 秒 ----------------
  const revealTimers = new WeakMap();
  function mask(input, button) {
    input.type = 'password';
    button.setAttribute('aria-pressed', 'false');
    button.textContent = '显示';
    clearTimeout(revealTimers.get(button));
  }
  // 面板会拦截冒泡的 click（app.js），所以在捕获阶段处理。
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('.credential-reveal');
    if (!button) return;
    event.preventDefault();
    const input = button.dataset.revealFor ? get(button.dataset.revealFor) : button.parentElement?.querySelector('input');
    if (!input) return;
    if (input.type === 'text') {
      mask(input, button);
      return;
    }
    input.type = 'text';
    button.setAttribute('aria-pressed', 'true');
    button.textContent = '隐藏';
    clearTimeout(revealTimers.get(button));
    revealTimers.set(button, setTimeout(() => mask(input, button), REVEAL_MS));
  }, true);

  // ---------------- 生命周期 ----------------
  api().onVaultChanged?.(() => refresh());
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'credentials' || event.detail?.tab === 'settings') refresh();
  });
  document.addEventListener('notch:modechange', (event) => {
    if (event.detail?.expanded) refresh();
  });
  setInterval(() => {
    if (status?.enabled && !status.locked && tab.classList.contains('active')) refresh();
  }, 15_000);
  refresh();

  window.NotchVault = { refresh, status: () => (status ? { ...status } : null) };
})();
