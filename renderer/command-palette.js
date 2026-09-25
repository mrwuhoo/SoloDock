// ⌘K 搜索：面板里按 ⌘K 或点顶栏放大镜打开，在记下的东西里一处搜索。
// 密钥只搜名称、账号与网址（主进程从不把密码发给页面），锁定时提示「解锁后可搜索」。
(function bootstrapCommandPalette() {
  'use strict';

  const S = window.NotchSearch;
  const get = (id) => document.getElementById(id);
  const root = get('palette');
  const input = get('palette-input');
  const results = get('palette-results');
  const filters = get('palette-filters');
  if (!S || !root || !input) return;

  const RECENT_KEY = 'notch-palette-recent-v1';
  const api = () => window.notchAPI || {};
  const toast = (message) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message);
  };
  const ICONS = {
    todo: '<path d="M5 7h9M5 12h9M5 17h6"/><path d="m16.5 7.5 1.5 1.5 2.5-3"/>',
    note: '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    prompt: '<path d="M12 3.5c.7 4 2.8 6.1 6.8 6.8-4 .7-6.1 2.8-6.8 6.8-.7-4-2.8-6.1-6.8-6.8 4-.7 6.1-2.8 6.8-6.8Z"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/>',
    clip: '<rect x="7" y="4" width="10" height="4" rx="1.5"/><path d="M8 6H6.5A1.5 1.5 0 0 0 5 7.5v11A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 17.5 6H16"/>',
    credential: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
    action: '<path d="M12 5v14M5 12h14"/>',
    focus: '<circle cx="12" cy="13.5" r="6.8"/><path d="M12 13.5V10M10 3.8h4"/>',
    record: '<rect x="8" y="3" width="8" height="13" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  };
  const ACTION_HINT = { todo: '打开', note: '打开', prompt: '复制', link: '打开', clip: '复制', credential: '复制密码', action: '执行' };
  const QUICK_ACTIONS = [
    { type: 'action', id: 'new-note', title: '新建笔记', subtitle: '在随笔里写', icon: 'note' },
    { type: 'action', id: 'new-todo', title: '添加待办', subtitle: '到待办页输入', icon: 'todo' },
    { type: 'action', id: 'start-focus', title: '开始专注', subtitle: '按番茄钟设定的时长', icon: 'focus' },
    { type: 'action', id: 'start-recording', title: '开始录音', subtitle: '录制页', icon: 'record' },
  ];

  let items = [];
  let rows = [];
  let active = 0;
  let filter = 'all';
  let vaultLocked = false;
  let restoreFocus = null;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const oneLine = (value, limit = 90) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);

  // 把各处的数据收成统一的条目。每次打开时重新收集，保证是最新的。
  async function collect() {
    const next = [];
    const todos = window.NotchTodos?.items?.() || {};
    for (const priority of ['P0', 'P1', 'P2', 'P3']) {
      for (const todo of todos[priority] || []) {
        if (todo.done) continue;
        next.push({ type: 'todo', id: todo.id, title: todo.text, subtitle: [window.NotchTodos.categoryName(priority), todo.deadline ? new Date(todo.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''].filter(Boolean).join(' · '), at: todo.createdAt });
      }
    }
    for (const note of window.NotchNotes?.list?.() || []) {
      next.push({ type: 'note', id: note.id, title: oneLine(note.title) || '未命名笔记', subtitle: oneLine(note.content), keywords: note.content, at: note.updatedAt || note.createdAt });
    }
    for (const prompt of window.NotchPromptLibrary?.list?.() || []) {
      next.push({ type: 'prompt', id: prompt.id, title: prompt.title, subtitle: oneLine(prompt.text), keywords: `${prompt.group || ''} ${prompt.text}`, at: prompt.lastUsedAt || prompt.updatedAt });
    }
    for (const group of readJson('notch-link-groups', []) || []) {
      for (const link of group.links || []) {
        let host = '';
        try { host = new URL(link.url).host; } catch (error) { host = link.url; }
        next.push({ type: 'link', id: link.id, title: link.title && link.title !== '未命名' ? link.title : host, subtitle: `${group.name ? `${group.name} · ` : ''}${host}`, keywords: link.url, url: link.url, at: link.createdAt });
      }
    }
    for (const entry of readJson('notch-clip-history', []) || []) {
      if (!entry || entry.type === 'image' || typeof entry.text !== 'string') continue;
      next.push({ type: 'clip', id: entry.id, title: oneLine(entry.text, 120), subtitle: entry.type === 'url' ? '剪贴板 · 链接' : '剪贴板', keywords: entry.text, entry, at: entry.createdAt });
    }
    const vault = await api().listCredentials?.()?.catch?.(() => null);
    vaultLocked = Boolean(vault?.locked);
    for (const credential of vault?.items || []) {
      next.push({ type: 'credential', id: credential.id, title: credential.service, subtitle: [credential.kind === 'apikey' ? 'API Key' : '密码', credential.account].filter(Boolean).join(' · '), keywords: `${credential.account} ${credential.url || ''}`, at: credential.lastUsedAt || credential.createdAt });
    }
    items = next;
  }

  function renderFilters() {
    const options = [{ id: 'all', label: '全部' }, ...S.TYPES];
    filters.innerHTML = options.map((option) => `<button type="button" role="tab" data-filter="${option.id}" aria-selected="${option.id === filter}">${option.label}</button>`).join('');
  }

  function row(item, index) {
    const icon = ICONS[item.icon || item.type] || ICONS.action;
    return `<div class="palette-row" role="option" id="palette-row-${index}" data-index="${index}" aria-selected="${index === active}">
      <span class="palette-icon" data-type="${item.type}"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span>
      <span class="palette-text"><b>${escapeHtml(item.title)}</b>${item.subtitle ? `<small>${escapeHtml(item.subtitle)}</small>` : ''}</span>
      <span class="palette-hint">${item.locked ? '去解锁' : ACTION_HINT[item.type] || ''}</span>
    </div>`;
  }

  function render() {
    const query = input.value;
    rows = [];
    let html = '';
    const section = (label, list, more = null) => {
      if (!list.length) return;
      html += `<section class="palette-group"><header><span>${label}</span>${more ? `<button type="button" class="palette-more" data-more="${more.type}">查看全部 ${more.total} 条</button>` : ''}</header>`;
      list.forEach((item) => { html += row(item, rows.length); rows.push(item); });
      html += '</section>';
    };
    if (!query.trim()) {
      const recent = (readJson(RECENT_KEY, []) || []).map((entry) => items.find((item) => item.type === entry.type && item.id === entry.id)).filter(Boolean).slice(0, 5);
      section('最近使用', recent);
      section('快捷操作', QUICK_ACTIONS);
    } else {
      for (const group of S.searchItems(items, query, { filter })) {
        section(group.label, group.items, group.total > group.items.length ? { type: group.type, total: group.total } : null);
      }
      if (vaultLocked && (filter === 'all' || filter === 'credential')) {
        section('密钥', [{ type: 'credential', id: '__locked', title: '密钥已锁定', subtitle: '解锁后可搜索名称、账号与网址', locked: true }]);
      }
      if (!rows.length) html = `<div class="palette-empty"><b>没有找到「${escapeHtml(query.trim())}」</b><span>试试别的关键词，或按 Tab 换个类型</span></div>`;
    }
    results.innerHTML = html;
    active = Math.min(active, Math.max(0, rows.length - 1));
    syncActive();
  }

  function syncActive() {
    results.querySelectorAll('.palette-row').forEach((node) => node.setAttribute('aria-selected', String(Number(node.dataset.index) === active)));
    const current = results.querySelector(`#palette-row-${active}`);
    if (current) {
      current.scrollIntoView({ block: 'nearest' });
      input.setAttribute('aria-activedescendant', current.id);
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function remember(item) {
    if (item.type === 'action' || item.locked) return;
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(S.rememberRecent(readJson(RECENT_KEY, []), item))); } catch (error) { /* ignore */ }
  }

  const textOf = (item) => {
    if (item.type === 'note') return window.NotchNotes?.list?.().find((note) => note.id === item.id)?.content || item.title;
    if (item.type === 'prompt') return window.NotchPromptLibrary?.list?.().find((prompt) => prompt.id === item.id)?.text || item.title;
    if (item.type === 'link') return item.url;
    if (item.type === 'clip') return item.entry?.text || item.title;
    return item.title;
  };

  // ⏎ 默认动作：打开 / 复制；⌘⏎ 粘贴到前台应用（密钥只能复制，永远不走粘贴）。
  async function run(item, paste = false) {
    if (!item) return;
    if (paste) {
      if (item.type === 'credential' || item.type === 'action') {
        toast(item.type === 'credential' ? '密钥只能复制，不会粘贴到其他应用' : '这一项没有可粘贴的内容');
        return;
      }
      remember(item);
      close();
      const entry = item.type === 'clip' && item.entry ? item.entry : { type: 'text', text: textOf(item) };
      const result = await api().pasteClipboard?.(entry)?.catch?.(() => null);
      if (result && !result.pasted) toast(result.permissionRequired ? '已复制；开启辅助功能权限后可以直接粘贴' : '已复制到剪贴板');
      return;
    }
    remember(item);
    close();
    switch (item.type) {
      case 'todo':
        window.NotchTodos?.focus?.(item.id);
        break;
      case 'note':
        window.NotchNotes?.open?.(item.id);
        break;
      case 'prompt':
        if (window.NotchPromptLibrary?.needsInput?.(item.id)) {
          await window.setActiveTab?.('notes');
          window.NotchPromptLibrary.open(item.id);
          toast('先填好变量再复制');
        } else {
          await window.NotchPromptLibrary?.copy?.(item.id);
        }
        break;
      case 'link':
        api().openExternal?.(item.url);
        break;
      case 'clip': {
        const copied = await api().writeClipboard?.(item.entry)?.catch?.(() => false);
        toast(copied ? '已复制' : '复制失败');
        break;
      }
      case 'credential':
        if (item.locked) {
          window.setActiveTab?.('credentials');
          break;
        }
        toast((await api().copyCredential?.(item.id, 'password')?.catch?.(() => false)) ? '已复制 · 不进剪贴板历史，60 秒后自动清除' : '复制失败，密钥可能已锁定');
        break;
      case 'action':
        runAction(item.id);
        break;
      default:
        break;
    }
  }

  async function runAction(id) {
    if (id === 'new-note') {
      await window.setActiveTab?.('home');
      get('home-note')?.focus();
    } else if (id === 'new-todo') {
      await window.setActiveTab?.('todo');
      document.querySelector('.add-row input[data-priority]')?.focus();
    } else if (id === 'start-focus') {
      await window.setActiveTab?.('home');
      const state = window.NotchPomodoro?.state?.();
      if (!state?.running) get('pomodoro-toggle')?.click();
    } else if (id === 'start-recording') {
      await window.setActiveTab?.('recordings');
      window.NotchWorkspace?.startRecording?.();
    }
  }

  // 「查看全部」：去对应页面，能带上搜索词的就带上。
  async function showAll(type) {
    const query = input.value.trim();
    close();
    if (type === 'note') {
      await window.setActiveTab?.('notes');
      window.NotchPromptLibrary?.setLibrary?.('notes', { remember: false });
      setSearch('notes-search', query);
    } else if (type === 'prompt') {
      await window.setActiveTab?.('notes');
      window.NotchPromptLibrary?.setLibrary?.('prompts', { remember: false });
      setSearch('notes-search', query);
    } else if (type === 'credential') {
      await window.setActiveTab?.('credentials');
      setSearch('credential-search', query);
    } else {
      await window.setActiveTab?.({ todo: 'todo', link: 'links', clip: 'clip' }[type] || 'home');
    }
  }

  function setSearch(id, value) {
    const field = get(id);
    if (!field) return;
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function open() {
    if (!root.hidden) return;
    restoreFocus = document.activeElement;
    filter = 'all';
    active = 0;
    input.value = '';
    root.hidden = false;
    renderFilters();
    input.focus();
    await collect();
    render();
  }

  // 返回 true 表示刚才是开着的（给 Esc 用）。
  function close() {
    if (root.hidden) return false;
    root.hidden = true;
    if (restoreFocus && document.contains(restoreFocus) && typeof restoreFocus.focus === 'function') restoreFocus.focus({ preventScroll: true });
    restoreFocus = null;
    return true;
  }

  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      active = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      syncActive();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(rows[active], event.metaKey || event.ctrlKey);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      filter = S.nextFilter(filter, event.shiftKey ? -1 : 1);
      active = 0;
      renderFilters();
      render();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  results.addEventListener('mousemove', (event) => {
    const node = event.target.closest('.palette-row');
    if (!node || Number(node.dataset.index) === active) return;
    active = Number(node.dataset.index);
    syncActive();
  });
  results.addEventListener('click', (event) => {
    const more = event.target.closest('[data-more]');
    if (more) {
      showAll(more.dataset.more);
      return;
    }
    const node = event.target.closest('.palette-row');
    if (node) run(rows[Number(node.dataset.index)], event.metaKey || event.ctrlKey);
  });
  filters.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    filter = chip.dataset.filter;
    active = 0;
    renderFilters();
    render();
    input.focus();
  });
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-palette-close]')) close();
  });
  get('search-trigger')?.addEventListener('click', (event) => {
    event.stopPropagation();
    open();
  });
  // ⌘K：面板展开时在任何地方都能打开（再按一次关闭）。
  document.addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if (!document.getElementById('app')?.classList.contains('expanded')) return;
    event.preventDefault();
    event.stopPropagation();
    if (root.hidden) open();
    else close();
  }, true);
  document.addEventListener('notch:modechange', (event) => {
    if (!event.detail?.expanded) close();
  });

  window.NotchPalette = { open, close, isOpen: () => !root.hidden, rows: () => rows.map((item) => ({ ...item })) };
})();
