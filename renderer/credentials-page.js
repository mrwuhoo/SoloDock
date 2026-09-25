// 密钥页：顶部搜索（自动聚焦）+ 新增 + 自动锁定倒计时 + 锁定；左侧列表（最近使用 / 全部），右侧详情。
// 新增与编辑在浮层里完成。密码默认遮蔽，「显示」10 秒后自动遮蔽（vault.js 负责）；复制走主进程的机密剪贴板，60 秒后清除。
// 主进程从不把密码放进列表；只有「显示」和「编辑」时才用 getCredential 取一次明文。
(function bootstrapCredentialsPage() {
  'use strict';

  const Domain = window.NotchDomain;
  const $ = (id) => document.getElementById(id);
  const page = $('credentials-page');
  const list = $('credential-list');
  const detail = $('credential-detail');
  if (!Domain || !page || !list || !detail) return;

  const api = () => window.notchAPI || {};
  const toast = (message, options) => (typeof window.showStatusToast === 'function' ? window.showStatusToast(message, options) : null);
  const els = {
    search: $('credential-search'),
    create: $('credential-new'),
    sheet: $('credential-sheet'),
    form: $('credential-form'),
    formTitle: $('credential-form-title'),
    service: $('credential-service'),
    account: $('credential-account'),
    password: $('credential-password'),
    url: $('credential-url'),
    note: $('credential-note'),
    save: $('credential-save'),
    generate: $('credential-generate'),
    generator: $('credential-generator'),
    generatorLength: $('credential-generator-length'),
    generatorSymbols: $('credential-generator-symbols'),
    formNote: $('credentials-note'),
    copyToast: $('credential-toast'),
  };
  const CLEAR_AFTER_S = 60;
  const TONES = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'ink'];
  const ICON = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="10" height="10" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.8"/></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5h5v5M18.5 5.5l-7.5 7.5"/><path d="M17.5 13.5v4a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19h3.8L19.2 8.6a2.1 2.1 0 0 0-3-3L5.8 16v3Z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17.5" cy="12" r="1.3"/></svg>',
    shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 5.5 6.5V12c0 4 2.8 6.8 6.5 8 3.7-1.2 6.5-4 6.5-8V6.5Z"/></svg>',
  };

  let credentials = [];
  let locked = false;
  let secureStorage = true;
  let selectedId = '';
  let editingId = '';
  let kind = 'password';
  let revealed = null; // { id, password, timer }
  let confirmDelete = '';

  const byId = (id) => credentials.find((item) => item.id === id) || null;
  const isApiKey = (item) => item && item.kind === 'apikey';
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return ''; } };
  const initialOf = (name) => { const first = Array.from(String(name || '?').trim())[0] || '?'; return /[a-z]/i.test(first) ? first.toUpperCase() : first; };
  const toneOf = (name) => { let sum = 0; for (const char of String(name || '')) sum = (sum * 31 + char.codePointAt(0)) >>> 0; return TONES[sum % TONES.length]; };
  const envName = (item) => item.account || Domain.deriveEnvName(item.service);

  function when(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const start = (value) => { const day = new Date(value); day.setHours(0, 0, 0, 0); return day.getTime(); };
    const days = Math.round((start(Date.now()) - start(timestamp)) / 86400000);
    return days === 0 ? `今天 ${clock}` : days === 1 ? `昨天 ${clock}` : `${date.getMonth() + 1}/${date.getDate()}`;
  }

  // ---------------- 数据 ----------------
  async function load() {
    const result = await Promise.resolve(api().listCredentials?.()).catch(() => null);
    credentials = result && Array.isArray(result.items) ? result.items : [];
    locked = Boolean(result?.locked);
    secureStorage = result ? result.secureStorage !== false : true;
    if (locked) { closeSheet(); forgetReveal(); }
    if (!byId(selectedId)) selectedId = visible()[0]?.id || '';
    render();
  }

  function visible() {
    const query = els.search?.value || '';
    return Domain.sortCredentials(Domain.filterCredentials(credentials, query));
  }

  // 最近使用：用过的前 3 条；其余按名称排在「全部」。
  function groups() {
    const items = visible();
    const recent = items.filter((item) => item.lastUsedAt > 0).sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 3);
    const rest = items.filter((item) => !recent.includes(item)).sort((a, b) => String(a.service).localeCompare(String(b.service), 'zh-Hans-CN'));
    return [['最近使用', recent], ['全部', rest]].filter(([, entries]) => entries.length);
  }

  // ---------------- 渲染 ----------------
  function avatar(item, size = 'small') {
    const span = document.createElement('span');
    span.className = `cred-avatar ${size}`;
    span.dataset.tone = toneOf(item.service);
    span.textContent = initialOf(item.service);
    return span;
  }

  function renderList() {
    list.replaceChildren();
    if (!credentials.length) {
      const empty = document.createElement('div');
      empty.className = 'cred-empty';
      empty.innerHTML = '<strong>还没有保存的密钥</strong><p>点「新增」存一个账号密码或 API Key。只保存在本机，由系统钥匙串加密。</p>';
      list.append(empty);
      return;
    }
    const sections = groups();
    if (!sections.length) {
      const empty = document.createElement('div');
      empty.className = 'cred-empty';
      empty.innerHTML = '<strong>没有找到</strong><p>搜索会匹配名称、账号和网址，从不搜索密码。</p>';
      list.append(empty);
      return;
    }
    sections.forEach(([label, entries]) => {
      const heading = document.createElement('div');
      heading.className = 'cred-group';
      heading.textContent = label;
      list.append(heading);
      entries.forEach((item) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `cred-row${item.id === selectedId ? ' active' : ''}`;
        row.dataset.id = item.id;
        row.setAttribute('aria-pressed', String(item.id === selectedId));
        const text = document.createElement('span');
        text.className = 'cred-row-text';
        const name = document.createElement('b');
        name.textContent = item.service;
        const account = document.createElement('small');
        account.textContent = isApiKey(item) ? envName(item) : item.account;
        text.append(name, account);
        const tag = document.createElement('em');
        tag.className = `cred-tag${isApiKey(item) ? ' api' : ''}`;
        tag.textContent = isApiKey(item) ? 'API Key' : '密码';
        row.append(avatar(item), text, tag);
        list.append(row);
      });
    });
  }

  function fieldRow(label, value, actions, options = {}) {
    const row = document.createElement('div');
    row.className = `cred-field${options.secret ? ' secret' : ''}`;
    const key = document.createElement('span');
    key.className = 'cred-field-label';
    key.textContent = label;
    const content = document.createElement(options.link ? 'button' : 'span');
    content.className = `cred-field-value${options.link ? ' link' : ''}`;
    if (options.link) { content.type = 'button'; content.dataset.action = 'open-url'; }
    if (options.prefix) {
      const mask = document.createElement('span');
      mask.className = 'cred-mask';
      mask.textContent = value;
      content.append(options.prefix, mask);
    } else content.textContent = value;
    const tools = document.createElement('span');
    tools.className = 'cred-field-actions';
    tools.innerHTML = actions;
    row.append(key, content, tools);
    return row;
  }

  function renderDetail() {
    const item = byId(selectedId);
    detail.replaceChildren();
    if (!item) {
      const empty = document.createElement('div');
      empty.className = 'cred-empty';
      empty.innerHTML = credentials.length ? '<strong>选一条看看</strong><p>⏎ 复制所选条目的密码，⌘C 复制账号。</p>' : '<strong>安全地保存账号和 API Key</strong><p>密码默认遮蔽；复制后不进剪贴板历史，60 秒后自动清除。</p>';
      detail.append(empty);
      return;
    }
    const apiKey = isApiKey(item);
    const head = document.createElement('header');
    head.className = 'cred-detail-head';
    const heading = document.createElement('div');
    heading.className = 'cred-detail-title';
    const title = document.createElement('h2');
    title.textContent = item.service;
    const meta = document.createElement('p');
    meta.textContent = [hostOf(item.url), item.lastUsedAt ? `最近使用 ${when(item.lastUsedAt)}` : '还没用过', apiKey ? 'API Key' : '密码'].filter(Boolean).join(' · ');
    heading.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'cred-detail-actions';
    actions.innerHTML = `<button class="cred-secondary" type="button" data-action="edit">${ICON.edit}编辑</button><button class="cred-icon" type="button" data-action="more" aria-label="更多" aria-expanded="false">${ICON.more}</button>`;
    head.append(avatar(item, 'large'), heading, actions);

    const fields = document.createElement('div');
    fields.className = 'cred-fields';
    const shown = revealed && revealed.id === item.id ? revealed.password : '';
    if (apiKey) {
      fields.append(fieldRow('变量名', envName(item), `<button class="cred-secondary" type="button" data-copy="account">${ICON.copy}复制</button>`));
      fields.append(fieldRow('API Key', shown || '••••••••••••••••••', `<button class="cred-icon" type="button" data-action="reveal" aria-label="${shown ? '遮蔽' : '显示 10 秒'}" aria-pressed="${Boolean(shown)}">${ICON.eye}</button><button class="cred-primary" type="button" data-copy="password">${ICON.copy}复制</button>`, { secret: !shown }));
      const envButton = `<button class="cred-secondary" type="button" data-copy="env">${ICON.copy}复制为 ${envName(item)}=…</button>`;
      fields.append(fieldRow('环境变量', '••••', envButton, { prefix: `${envName(item)}=` }));
    } else {
      fields.append(fieldRow('账号', item.account, `<button class="cred-secondary" type="button" data-copy="account">${ICON.copy}复制</button>`));
      fields.append(fieldRow('密码', shown || '••••••••••••••', `<button class="cred-icon" type="button" data-action="reveal" aria-label="${shown ? '遮蔽' : '显示 10 秒'}" aria-pressed="${Boolean(shown)}">${ICON.eye}</button><button class="cred-primary" type="button" data-copy="password">${ICON.copy}复制</button>`, { secret: !shown }));
    }
    if (item.url) fields.append(fieldRow('网址', item.url, `<button class="cred-icon" type="button" data-action="open-url" aria-label="在浏览器打开">${ICON.open}</button>`, { link: true }));
    if (item.note) fields.append(fieldRow('备注', item.note, ''));

    const foot = document.createElement('footer');
    foot.className = 'cred-detail-foot';
    const created = document.createElement('span');
    created.textContent = item.createdAt > 1e12 ? `创建于 ${new Date(item.createdAt).toLocaleDateString('zh-CN')}` : '';
    const safe = document.createElement('span');
    safe.className = 'cred-safe';
    safe.innerHTML = `${ICON.shield}<span>复制的内容不进剪贴板历史，60 秒后清除</span>`;
    foot.append(created, safe);

    const menu = document.createElement('div');
    menu.className = 'cred-menu';
    menu.hidden = true;
    menu.setAttribute('role', 'menu');
    menu.innerHTML = `${item.url ? '<button type="button" role="menuitem" data-copy="url">复制网址</button>' : ''}<button type="button" role="menuitem" data-action="delete" class="danger">${confirmDelete === item.id ? '确认删除' : '删除'}</button>`;
    detail.append(head, fields, foot, menu);
  }

  function render() {
    renderList();
    renderDetail();
  }

  // ---------------- 复制 ----------------
  let toastTimer = null;
  let toastTick = null;
  function showCopyToast(label) {
    const box = els.copyToast;
    if (!box) return;
    clearTimeout(toastTimer);
    clearInterval(toastTick);
    const started = Date.now();
    const text = box.querySelector('[data-toast-text]');
    const bar = box.querySelector('i');
    const update = () => {
      const left = Math.max(0, CLEAR_AFTER_S - Math.round((Date.now() - started) / 1000));
      text.textContent = `${label}已复制 · ${left} 秒后从剪贴板清除`;
      bar.style.width = `${(left / CLEAR_AFTER_S) * 100}%`;
    };
    update();
    box.hidden = false;
    toastTick = setInterval(update, 1000);
    toastTimer = setTimeout(() => { box.hidden = true; clearInterval(toastTick); }, 6000);
  }

  async function copy(item, field) {
    if (!item) return;
    const ok = await Promise.resolve(api().copyCredential?.(item.id, field)).catch(() => false);
    if (!ok) {
      toast(locked ? '密钥已锁定，请先解锁' : '没复制上，请再试一次');
      return;
    }
    item.lastUsedAt = Date.now();
    if (field === 'password') showCopyToast(isApiKey(item) ? 'API Key ' : '密码');
    else if (field === 'env') showCopyToast(`${envName(item)}=… `);
    else toast(field === 'url' ? '已复制网址' : isApiKey(item) ? '已复制变量名' : '已复制账号');
    render();
  }

  // ---------------- 显示 10 秒 ----------------
  function forgetReveal() {
    if (revealed) clearTimeout(revealed.timer);
    revealed = null;
  }

  async function reveal(item) {
    if (revealed && revealed.id === item.id) {
      forgetReveal();
      renderDetail();
      return;
    }
    const result = await Promise.resolve(api().getCredential?.(item.id)).catch(() => null);
    if (!result?.ok || !result.item) {
      toast(result?.error === 'locked' ? '密钥已锁定，请先解锁' : '读取失败');
      return;
    }
    forgetReveal();
    revealed = { id: item.id, password: result.item.password || '', timer: setTimeout(() => { forgetReveal(); renderDetail(); }, 10000) };
    renderDetail();
  }

  // ---------------- 新增 / 编辑浮层 ----------------
  function randomInt(max) {
    const values = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    do { crypto.getRandomValues(values); } while (values[0] >= limit);
    return values[0] % max;
  }

  function applyKind(next) {
    kind = next === 'apikey' ? 'apikey' : 'password';
    const apiKey = kind === 'apikey';
    page.querySelectorAll('[data-credential-kind]').forEach((button) => button.setAttribute('aria-checked', String(button.dataset.credentialKind === kind)));
    $('credential-account-label').textContent = apiKey ? '变量名（可选）' : '账号';
    $('credential-password-label').textContent = apiKey ? 'API Key' : '密码';
    els.service.placeholder = apiKey ? '例如 OpenAI' : '例如 GitHub';
    els.password.placeholder = apiKey ? '粘贴 API Key，保存后才会加密' : '保存后才会加密';
    els.generate.hidden = apiKey;
    if (apiKey) els.generator.hidden = true;
    updateAccountPlaceholder();
  }

  function updateAccountPlaceholder() {
    els.account.placeholder = kind === 'apikey' ? `默认 ${Domain.deriveEnvName(els.service.value || '')}，用于「复制为 KEY=value」` : '邮箱、用户名或手机号';
  }

  function fillGenerated() {
    els.password.value = Domain.generatePassword({ length: Number(els.generatorLength.value || 20), symbols: els.generatorSymbols.checked !== false }, randomInt);
    if (els.password.type === 'password') page.querySelector('.credential-reveal[data-reveal-for="credential-password"]')?.click();
  }

  function resetForm() {
    [els.service, els.account, els.password, els.url, els.note].forEach((input) => { input.value = ''; });
    els.password.type = 'password';
    const revealButton = page.querySelector('.credential-reveal[data-reveal-for="credential-password"]');
    if (revealButton) { revealButton.textContent = '显示'; revealButton.setAttribute('aria-pressed', 'false'); }
    els.generator.hidden = true;
    els.formNote.textContent = '由系统钥匙串加密；复制的密码不进剪贴板历史，60 秒后自动清除。';
    els.formNote.classList.remove('error');
  }

  async function openSheet(item = null) {
    if (locked) return;
    resetForm();
    editingId = item ? item.id : '';
    els.formTitle.textContent = item ? '编辑密钥' : '新增密钥';
    applyKind(item ? item.kind : kind);
    if (item) {
      const result = await Promise.resolve(api().getCredential?.(item.id)).catch(() => null);
      if (!result?.ok || !result.item) {
        toast(result?.error === 'locked' ? '密钥已锁定，请先解锁' : '读取失败');
        return;
      }
      const full = result.item;
      els.service.value = full.service || '';
      els.account.value = full.account || '';
      els.password.value = full.password || '';
      els.url.value = full.url || '';
      els.note.value = full.note || '';
      updateAccountPlaceholder();
    }
    if (!secureStorage) {
      els.formNote.textContent = '当前系统安全存储不可用，暂时无法保存密码。';
      els.formNote.classList.add('error');
    }
    els.sheet.hidden = false;
    requestAnimationFrame(() => els.service.focus());
  }

  function closeSheet() {
    if (!els.sheet || els.sheet.hidden) return false;
    els.sheet.hidden = true;
    editingId = '';
    els.password.value = '';
    return true;
  }

  async function save() {
    const payload = { kind, service: els.service.value || '', account: els.account.value || '', password: els.password.value || '', url: els.url.value || '', note: els.note.value || '' };
    if (editingId) payload.id = editingId;
    const needsAccount = kind === 'password';
    if (!payload.service.trim() || (needsAccount && !payload.account.trim()) || !payload.password) {
      els.formNote.textContent = needsAccount ? '请填写名称、账号和密码。' : '请填写名称和 API Key。';
      els.formNote.classList.add('error');
      return;
    }
    els.save.disabled = true;
    const result = await Promise.resolve(api().saveCredential?.(payload)).catch(() => ({ ok: false }));
    els.save.disabled = false;
    if (!result || !result.ok) {
      els.formNote.textContent = result?.error === 'locked' ? '密钥已锁定，请先解锁。' : '加密保存失败，请确认系统钥匙串可用。';
      els.formNote.classList.add('error');
      return;
    }
    const wasEditing = editingId;
    closeSheet();
    if (result.item?.id) selectedId = result.item.id;
    await load();
    toast(wasEditing ? '已保存修改' : kind === 'apikey' ? 'API Key 已加密保存' : '已加密保存');
  }

  async function remove(item) {
    if (confirmDelete !== item.id) {
      confirmDelete = item.id;
      renderDetail();
      detail.querySelector('.cred-menu').hidden = false;
      return;
    }
    confirmDelete = '';
    const result = await Promise.resolve(api().deleteCredentials?.([item.id])).catch(() => null);
    if (!result?.ok) {
      toast('删除失败');
      return;
    }
    forgetReveal();
    toast(`已删除「${item.service}」`);
    await load();
  }

  // ---------------- 事件 ----------------
  list.addEventListener('click', (event) => {
    const row = event.target.closest('.cred-row');
    if (!row) return;
    if (selectedId !== row.dataset.id) { forgetReveal(); confirmDelete = ''; }
    selectedId = row.dataset.id;
    render();
  });

  detail.addEventListener('click', (event) => {
    const item = byId(selectedId);
    if (!item) return;
    const copyButton = event.target.closest('[data-copy]');
    if (copyButton) {
      detail.querySelector('.cred-menu').hidden = true;
      copy(item, copyButton.dataset.copy);
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'reveal') reveal(item);
    else if (action === 'edit') openSheet(item);
    else if (action === 'open-url') api().openExternal?.(item.url)?.catch?.(() => {});
    else if (action === 'more') {
      const menu = detail.querySelector('.cred-menu');
      menu.hidden = !menu.hidden;
      event.target.closest('[data-action]').setAttribute('aria-expanded', String(!menu.hidden));
    } else if (action === 'delete') remove(item);
  });

  els.search?.addEventListener('input', () => {
    const items = visible();
    if (!items.some((item) => item.id === selectedId)) selectedId = items[0]?.id || '';
    render();
  });
  els.search?.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      copy(byId(selectedId), 'password');
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    }
  });

  function moveSelection(direction) {
    const order = groups().flatMap(([, entries]) => entries.map((item) => item.id));
    if (!order.length) return;
    const index = order.indexOf(selectedId);
    selectedId = order[(index + direction + order.length) % order.length];
    forgetReveal();
    render();
  }

  // ⏎ 复制所选的密码、⌘C 复制账号、⌘N 新增；焦点在输入框里时不抢。
  document.addEventListener('keydown', (event) => {
    if (!document.getElementById('tab-credentials')?.classList.contains('active') || locked || !els.sheet.hidden) return;
    if (window.NotchPalette?.isOpen?.()) return;
    const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]');
    const mod = event.metaKey || event.ctrlKey;
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      openSheet();
      return;
    }
    if (typing) return;
    if (event.key === 'Enter' && !mod) {
      if (event.target instanceof Element && event.target.closest('button, a, summary')) return;
      event.preventDefault();
      copy(byId(selectedId), 'password');
    } else if (mod && event.key.toLowerCase() === 'c' && !String(window.getSelection?.() || '')) {
      event.preventDefault();
      copy(byId(selectedId), 'account');
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    }
  });

  els.create?.addEventListener('click', () => openSheet());
  page.querySelectorAll('[data-credential-kind]').forEach((button) => button.addEventListener('click', () => applyKind(button.dataset.credentialKind)));
  els.service?.addEventListener('input', updateAccountPlaceholder);
  els.generate?.addEventListener('click', () => { els.generator.hidden = false; fillGenerated(); });
  $('credential-generator-again')?.addEventListener('click', fillGenerated);
  els.generatorLength?.addEventListener('change', fillGenerated);
  els.generatorSymbols?.addEventListener('change', fillGenerated);
  els.form?.addEventListener('submit', (event) => { event.preventDefault(); save(); });
  els.form?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault();
      save();
    }
  });
  els.sheet?.addEventListener('click', (event) => {
    if (event.target === els.sheet || event.target.closest('[data-sheet-close]')) closeSheet();
  });
  $('credential-toast-clear')?.addEventListener('click', async () => {
    const cleared = await Promise.resolve(api().clearSecretClipboard?.()).catch(() => false);
    els.copyToast.hidden = true;
    clearInterval(toastTick);
    toast(cleared ? '已从剪贴板清除' : '剪贴板里已经不是这条内容了');
  });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.cred-menu, [data-action="more"]')) {
      const menu = detail.querySelector('.cred-menu');
      if (menu && !menu.hidden) { menu.hidden = true; confirmDelete = ''; }
    }
  }, true);
  document.addEventListener('notch:vault-changed', () => load());
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab !== 'credentials') { forgetReveal(); return; }
    load();
    if (!locked) requestAnimationFrame(() => els.search?.focus({ preventScroll: true }));
  });

  applyKind('password');
  window.NotchCredentials = {
    load,
    escape: () => {
      if (closeSheet()) return true;
      const menu = detail.querySelector('.cred-menu');
      if (menu && !menu.hidden) { menu.hidden = true; return true; }
      return false;
    },
    state: () => ({ selectedId, locked, count: credentials.length }),
  };
  load();
})();
