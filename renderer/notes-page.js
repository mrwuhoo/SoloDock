// 笔记库：按「今天 / 本周 / 更早」分组、搜索高亮、预览（任务框可勾选）/ 编辑（⌘E，Markdown 标记弱化）、
// 「⋯」复制 Markdown / 导出 .md / 删除（可撤销）、停止输入 800ms 自动保存（失败显示「未保存」并重试）。
// 首页随笔实时同步成当天的「M月D日 随笔」（带「今日随笔」标签），过了 0 点首页随笔清空、那条留在笔记库。
(function bootstrapNotesPage() {
  'use strict';

  const D = window.NotchNotesDomain;
  const $ = (id) => document.getElementById(id);
  const page = $('notes-page');
  const list = $('notes-list');
  const detail = $('notes-detail');
  const search = $('notes-search');
  const countEl = $('notes-count');
  if (!D || !page || !list || !detail) return;

  const ARCHIVE_KEY = 'notch-note-archive-v1';
  const HOME_KEY = 'notch-home-note';
  const ACTIVE_KEY = 'notch-note-active-archive-v1';
  const CAPTURE_KEY = 'notch-capture-note-v1';
  const HOME_DAY_KEY = 'notch-home-note-day-v1';
  const SAVE_DELAY_MS = 800;
  const RETRY_MS = 3000;
  const MAX_NOTES = 200;
  const api = () => window.notchAPI || {};
  const toast = (message, options) => (typeof window.showStatusToast === 'function' ? window.showStatusToast(message, options) : null);
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------------- 数据 ----------------
  function load() {
    try {
      return window.NotchDomain.normalizeNoteArchive(JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]'));
    } catch (error) {
      return [];
    }
  }

  // 写入失败（例如存储已满）时返回 false，由调用方显示「未保存」。
  function store(notes) {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(window.NotchDomain.normalizeNoteArchive(notes).slice(0, MAX_NOTES)));
      return true;
    } catch (error) {
      return false;
    }
  }

  const activeHomeId = () => localStorage.getItem(ACTIVE_KEY) || '';
  const isTodaySuibi = (note) => note.id === activeHomeId() && D.dayKey(note.createdAt) === D.dayKey(Date.now());

  let selectedId = '';
  let query = '';
  const modes = new Map(); // 笔记 id → 'edit' | 'preview'（本次打开期间记住）
  let saveState = 'saved';
  let savedAt = 0;
  let saveTimer = null;
  let retryTimer = null;
  let pending = null; // { id, content }

  // ---------------- 保存 ----------------
  function writeContent(id, content) {
    const notes = window.NotchDomain.updateNoteInArchive(load(), id, content, Date.now());
    if (!store(notes)) return false;
    // 正在编辑的是今日随笔：首页随笔跟着变。
    if (id === activeHomeId()) {
      try { localStorage.setItem(HOME_KEY, content); } catch (error) {}
      window.NotchHomeNote?.set?.(content);
    }
    return true;
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pending) return true;
    if (typeof workspaceReloadPending !== 'undefined' && workspaceReloadPending) return true;
    const { id, content } = pending;
    if (writeContent(id, content)) {
      pending = null;
      saveState = 'saved';
      savedAt = Date.now();
      clearTimeout(retryTimer);
      retryTimer = null;
      refreshRow(id);
    } else {
      saveState = 'failed';
      clearTimeout(retryTimer);
      retryTimer = setTimeout(flush, RETRY_MS);
    }
    renderStatus();
    return saveState === 'saved';
  }

  function schedule(id, content) {
    pending = { id, content };
    saveState = 'saving';
    renderStatus();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  // ---------------- 首页随笔 ----------------
  // 首页随笔每次保存都同步到当天那条「M月D日 随笔」；清空首页随笔时断开，之后再写另起一条。
  function syncHomeNote(content, options = {}) {
    const text = String(content || '');
    const at = Number(options.at) || Date.now();
    if (!text.trim()) {
      try { localStorage.removeItem(ACTIVE_KEY); } catch (error) {}
      render();
      return '';
    }
    const notes = load();
    let note = notes.find((item) => item.id === activeHomeId());
    if (note && D.dayKey(note.createdAt) !== D.dayKey(at)) note = null;
    if (note) {
      if (note.content !== text) {
        note.content = text;
        note.updatedAt = Math.max(note.createdAt, Date.now());
      }
    } else {
      note = { id: uid(), title: D.dailyTitle(at), titleSource: 'user', content: text, createdAt: at, updatedAt: at };
      notes.unshift(note);
    }
    if (!store(notes)) return '';
    try {
      localStorage.setItem(ACTIVE_KEY, note.id);
      localStorage.setItem(HOME_DAY_KEY, D.dayKey(at));
    } catch (error) {}
    if (selectedId !== note.id || document.activeElement?.closest?.('#notes-detail') == null) render();
    else refreshRow(note.id);
    return note.id;
  }

  // 过了 0 点：昨天的随笔留在笔记库，首页随笔清空。第一次运行只记下日期，不动已有内容。
  function rollHomeNote(now = Date.now()) {
    const today = D.dayKey(now);
    let stored = '';
    try { stored = localStorage.getItem(HOME_DAY_KEY) || ''; } catch (error) {}
    if (!stored) {
      try { localStorage.setItem(HOME_DAY_KEY, today); } catch (error) {}
      return false;
    }
    if (stored === today) return false;
    const home = window.NotchHomeNote?.get?.() ?? (localStorage.getItem(HOME_KEY) || '');
    if (home.trim()) {
      const [year, month, day] = stored.split('-').map(Number);
      syncHomeNote(home, { at: new Date(year, month - 1, day, 23, 59).getTime() });
    }
    try {
      localStorage.removeItem(ACTIVE_KEY);
      localStorage.setItem(HOME_KEY, '');
      localStorage.setItem(HOME_DAY_KEY, today);
    } catch (error) {}
    window.NotchHomeNote?.set?.('');
    render();
    return true;
  }

  // ---------------- 列表 ----------------
  function appendHighlighted(parent, text) {
    D.highlight(text, query).forEach((part) => {
      if (part.hit) {
        const mark = document.createElement('mark');
        mark.textContent = part.text;
        parent.append(mark);
      } else {
        parent.append(document.createTextNode(part.text));
      }
    });
  }

  function titleOf(note) {
    return String(note.title || '').trim() || D.firstLineTitle(note.content) || '未命名笔记';
  }

  function rowFor(note, now) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `notes-list-item${note.id === selectedId ? ' active' : ''}`;
    button.dataset.noteId = note.id;
    button.setAttribute('aria-pressed', String(note.id === selectedId));
    const top = document.createElement('span');
    top.className = 'notes-row-top';
    const title = document.createElement('strong');
    appendHighlighted(title, titleOf(note));
    top.append(title);
    if (isTodaySuibi(note)) {
      const chip = document.createElement('em');
      chip.className = 'notes-chip';
      chip.textContent = '今日随笔';
      top.append(chip);
    }
    const time = document.createElement('time');
    time.textContent = D.listTime(note.updatedAt, now);
    top.append(time);
    const excerpt = document.createElement('span');
    excerpt.className = 'notes-row-excerpt';
    appendHighlighted(excerpt, D.excerpt(note.content) || '空白笔记');
    button.append(top, excerpt);
    return button;
  }

  function renderList() {
    const now = Date.now();
    const archive = load();
    const notes = window.NotchDomain.filterNotes(archive, query);
    if (countEl) countEl.textContent = String(archive.length);
    if (!notes.some((note) => note.id === selectedId)) selectedId = notes[0]?.id || '';
    const scrollTop = list.scrollTop;
    list.replaceChildren();
    if (!notes.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-list-empty';
      empty.textContent = archive.length ? '没有找到相关笔记' : '保存的笔记会出现在这里';
      list.append(empty);
      return;
    }
    const pinned = archive.find(isTodaySuibi)?.id || '';
    D.groupNotes(notes, now, pinned).forEach((group) => {
      const label = document.createElement('div');
      label.className = 'notes-group';
      label.textContent = group.label;
      list.append(label, ...group.items.map((note) => rowFor(note, now)));
    });
    list.scrollTop = scrollTop;
  }

  function refreshRow(id) {
    const note = load().find((item) => item.id === id);
    const row = list.querySelector(`[data-note-id="${CSS.escape(String(id))}"]`);
    if (note && row) row.replaceWith(rowFor(note, Date.now()));
    renderMeta();
  }

  // ---------------- 详情 ----------------
  const ICON_MORE = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17.5" cy="12" r="1.3"/></svg>';

  function currentNote() {
    return load().find((note) => note.id === selectedId) || null;
  }

  function modeOf(note) {
    return modes.get(note.id) || (String(note.content || '').trim() ? 'preview' : 'edit');
  }

  function metaText(note) {
    const content = pending && pending.id === note.id ? pending.content : note.content;
    const source = String(note.title || '').trim()
      ? (note.titleSource === 'model' ? '标题由 AI 命名' : '标题由你命名')
      : '标题取自首行';
    const saved = saveState === 'failed' ? '未保存，正在重试' : saveState === 'saving' ? '正在保存…' : `自动保存于 ${D.updatedLabel(Math.max(savedAt, note.updatedAt))}`;
    return `${saved} · ${D.wordCount(content)} 字 · ${source}`;
  }

  function renderMeta() {
    const note = currentNote();
    const meta = detail.querySelector('.nd-meta');
    if (note && meta) {
      meta.textContent = metaText(note);
      meta.dataset.state = saveState;
    }
    renderStatus();
  }

  function renderStatus() {
    const note = currentNote();
    const status = detail.querySelector('.nd-status');
    if (!note || !status) return;
    status.dataset.state = saveState;
    status.textContent = saveState === 'failed' ? '未保存 · 3 秒后重试' : saveState === 'saving' ? '正在保存…' : `更新于 ${D.updatedLabel(savedAt && savedAt > note.updatedAt ? savedAt : note.updatedAt)}`;
    const meta = detail.querySelector('.nd-meta');
    if (meta) {
      meta.textContent = metaText(note);
      meta.dataset.state = saveState;
    }
  }

  function renderMarks(input, marks) {
    marks.replaceChildren(...D.markdownMarks(input.value + '\n').map((part) => {
      if (!part.mark) return document.createTextNode(part.text);
      const span = document.createElement('span');
      span.className = 'nd-mark';
      span.textContent = part.text;
      return span;
    }));
    marks.scrollTop = input.scrollTop;
  }

  function renderBody(note) {
    const body = detail.querySelector('.nd-body');
    if (!body) return;
    body.replaceChildren();
    const mode = modeOf(note);
    detail.querySelectorAll('.nd-mode button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.mode === mode)));
    const content = pending && pending.id === note.id ? pending.content : note.content;
    if (mode === 'preview') {
      const article = document.createElement('article');
      article.className = 'nd-preview';
      article.tabIndex = 0;
      if (String(content).trim()) {
        article.append(buildMarkdownPreview(content));
      } else {
        const empty = document.createElement('p');
        empty.className = 'nd-empty';
        empty.textContent = '空白笔记，按 ⌘E 开始写';
        article.append(empty);
      }
      body.append(article);
      return;
    }
    const editor = document.createElement('div');
    editor.className = 'nd-editor';
    const marks = document.createElement('pre');
    marks.className = 'nd-marks';
    marks.setAttribute('aria-hidden', 'true');
    const input = document.createElement('textarea');
    input.className = 'nd-input';
    input.id = 'notes-editor';
    input.value = content;
    input.placeholder = '直接输入，支持 Markdown：# 标题、- 列表、- [ ] 任务、> 引用';
    input.spellcheck = false;
    input.dataset.noteId = note.id;
    input.setAttribute('aria-label', `编辑笔记：${titleOf(note)}`);
    editor.append(marks, input);
    body.append(editor);
    renderMarks(input, marks);
  }

  function renderDetail() {
    const note = currentNote();
    detail.replaceChildren();
    if (!note) {
      const empty = document.createElement('div');
      empty.className = 'notes-detail-empty';
      empty.innerHTML = load().length
        ? '<span class="notes-empty-mark" aria-hidden="true">⌕</span><strong>没有匹配的笔记</strong><p>试试搜索其他关键词。</p>'
        : '<span class="notes-empty-mark" aria-hidden="true">✎</span><strong>还没有笔记</strong><p>点「新建」写第一篇；首页随笔也会自动出现在这里。</p>';
      detail.append(empty);
      return;
    }
    detail.innerHTML = `
      <header class="nd-head">
        <div class="nd-heading">
          <input class="nd-title notes-detail-title" type="text" maxlength="80" autocomplete="off" spellcheck="false" aria-label="笔记标题，可直接修改" />
          <p class="nd-meta"></p>
        </div>
        <div class="nd-actions">
          <div class="nd-mode" role="tablist" aria-label="编辑或预览（⌘E）">
            <button type="button" role="tab" data-mode="edit">编辑</button>
            <button type="button" role="tab" data-mode="preview">预览</button>
          </div>
          <button class="nd-icon" type="button" data-action="more" aria-label="更多" aria-expanded="false">${ICON_MORE}</button>
        </div>
      </header>
      <div class="nd-body"></div>
      <footer class="nd-foot"><span>编辑 / 预览 ⌘E · 自动保存</span><span class="nd-status"></span></footer>
      <div class="nd-menu" role="menu" hidden>
        <button type="button" role="menuitem" data-action="copy-md">复制 Markdown</button>
        <button type="button" role="menuitem" data-action="export-md">导出 .md</button>
        <button type="button" role="menuitem" data-action="delete-note" class="danger">删除</button>
      </div>`;
    const title = detail.querySelector('.nd-title');
    title.value = String(note.title || '');
    title.placeholder = D.firstLineTitle(note.content) || '未命名笔记';
    title.dataset.noteId = note.id;
    renderBody(note);
    renderMeta();
    requestNoteTitle(note);
  }

  function render() {
    renderList();
    renderDetail();
  }

  // 标题为空、内容足够时请 AI 起个标题（设置里没配模型就什么都不做）。
  const titleAttempts = new Set();
  async function requestNoteTitle(note) {
    if (!note || note.title || note.titleSource === 'user' || !String(note.content || '').trim() || titleAttempts.has(note.id) || !api().organizeMaterial) return;
    titleAttempts.add(note.id);
    const expected = note.content;
    const result = await api().organizeMaterial({ kind: 'note', text: expected }).catch(() => null);
    if (!result?.ok || !result.title) { titleAttempts.delete(note.id); return; }
    const next = window.NotchDomain.applyGeneratedNoteTitle(load(), note.id, result.title, expected);
    if (next.find((item) => item.id === note.id)?.titleSource !== 'model') { titleAttempts.delete(note.id); return; }
    store(next);
    render();
  }

  function setMode(mode) {
    const note = currentNote();
    if (!note) return;
    flush();
    modes.set(note.id, mode === 'edit' ? 'edit' : 'preview');
    renderBody(currentNote());
    if (mode === 'edit') {
      const input = detail.querySelector('.nd-input');
      input?.focus({ preventScroll: true });
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function select(id) {
    flush();
    selectedId = String(id || '');
    render();
  }

  function createNote() {
    flush();
    const now = Date.now();
    const id = uid();
    if (!store([{ id, title: '', content: '', createdAt: now, updatedAt: now }, ...load()])) {
      toast('存储空间不足，没能新建笔记');
      return '';
    }
    query = '';
    if (search) search.value = '';
    selectedId = id;
    modes.set(id, 'edit');
    render();
    detail.querySelector('.nd-title')?.focus();
    return id;
  }

  function deleteNote(id) {
    flush();
    const notes = load();
    const index = notes.findIndex((note) => note.id === id);
    if (index < 0) return;
    const [removed] = notes.splice(index, 1);
    store(notes);
    if (activeHomeId() === id) localStorage.removeItem(ACTIVE_KEY);
    selectedId = notes[Math.min(index, notes.length - 1)]?.id || '';
    render();
    toast(`已删除「${titleOf(removed)}」`, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => {
        const current = load();
        if (current.some((note) => note.id === removed.id)) return;
        current.splice(Math.min(index, current.length), 0, removed);
        store(current);
        selectedId = removed.id;
        render();
      },
    });
  }

  function closeMenu() {
    const menu = detail.querySelector('.nd-menu');
    if (!menu || menu.hidden) return false;
    menu.hidden = true;
    detail.querySelector('[data-action="more"]')?.setAttribute('aria-expanded', 'false');
    return true;
  }

  async function exportNote(note) {
    const result = await api().exportNote?.({ title: D.exportName(titleOf(note)), content: note.content })?.catch?.(() => null);
    if (result?.ok) toast('已导出 .md');
    else if (result && !result.canceled) toast('导出失败，请换个位置再试');
  }

  // ---------------- 事件 ----------------
  list.addEventListener('click', (event) => {
    const row = event.target.closest('[data-note-id]');
    if (row) select(row.dataset.noteId);
  });

  let searchTimer = null;
  search?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (page.dataset.library !== 'notes') { query = ''; return; }
      flush();
      query = search.value;
      render();
    }, 50);
  });

  $('notes-new')?.addEventListener('click', () => {
    if (page.dataset.library === 'notes') createNote();
  });

  detail.addEventListener('input', (event) => {
    const title = event.target.closest('.nd-title');
    if (title?.dataset.noteId) {
      const notes = window.NotchDomain.updateNoteTitle(load(), title.dataset.noteId, title.value, Date.now());
      if (store(notes)) { saveState = 'saved'; savedAt = Date.now(); }
      refreshRow(title.dataset.noteId);
      return;
    }
    const input = event.target.closest('.nd-input');
    if (input) {
      renderMarks(input, detail.querySelector('.nd-marks'));
      schedule(input.dataset.noteId, input.value);
      renderMeta();
    }
  });
  detail.addEventListener('scroll', (event) => {
    if (event.target.classList?.contains('nd-input')) {
      const marks = detail.querySelector('.nd-marks');
      if (marks) marks.scrollTop = event.target.scrollTop;
    }
  }, true);
  detail.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.target.closest('.nd-title') && event.key === 'Enter') {
      event.preventDefault();
      event.target.blur();
    }
  });
  detail.addEventListener('focusout', (event) => {
    const title = event.target.closest('.nd-title');
    if (title) {
      const note = currentNote();
      if (note) title.placeholder = D.firstLineTitle(note.content) || '未命名笔记';
    }
    if (event.target.closest('.nd-input')) flush();
  });
  detail.addEventListener('click', (event) => {
    const modeButton = event.target.closest('.nd-mode [data-mode]');
    if (modeButton) return setMode(modeButton.dataset.mode);
    // 预览里直接勾选任务框，结果写回 Markdown。
    const task = event.target.closest('.nd-preview .note-task-item[data-line]');
    if (task) {
      const note = currentNote();
      if (!note) return;
      const next = D.toggleTask(note.content, task.dataset.line);
      if (next !== note.content && writeContent(note.id, next)) { savedAt = Date.now(); renderBody(currentNote()); refreshRow(note.id); }
      return;
    }
    const link = event.target.closest('.nd-preview [data-note-href]');
    if (link) {
      event.preventDefault();
      api().openExternal?.(link.dataset.noteHref)?.catch?.(() => {});
      return;
    }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    const note = currentNote();
    if (!note) return;
    if (action === 'more') {
      const menu = detail.querySelector('.nd-menu');
      menu.hidden = !menu.hidden;
      event.target.closest('[data-action]').setAttribute('aria-expanded', String(!menu.hidden));
      return;
    }
    closeMenu();
    flush();
    const fresh = currentNote();
    if (action === 'copy-md') {
      Promise.resolve(api().writeClipboard?.({ type: 'text', text: fresh.content })).then(() => toast('已复制 Markdown')).catch(() => {});
    } else if (action === 'export-md') {
      exportNote(fresh);
    } else if (action === 'delete-note') {
      deleteNote(fresh.id);
    }
  });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.nd-menu, [data-action="more"]')) closeMenu();
  }, true);

  // ⌘F 搜索（两个库都行）；⌘N 新建、⌘E 编辑 / 预览只在「笔记」库里生效。
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing) return;
    if (!document.getElementById('tab-notes')?.classList.contains('active')) return;
    if (window.NotchPalette?.isOpen?.()) return;
    const key = event.key.toLowerCase();
    if (key !== 'f' && page.dataset.library !== 'notes') return;
    if (key === 'f') {
      event.preventDefault();
      search?.focus();
      search?.select();
      return;
    }
    if (key === 'n') {
      event.preventDefault();
      createNote();
    } else if (key === 'e') {
      const note = currentNote();
      if (!note) return;
      event.preventDefault();
      setMode(modeOf(note) === 'edit' ? 'preview' : 'edit');
    }
  }, true);

  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab !== 'notes') flush();
  });
  window.addEventListener('beforeunload', () => flush());
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  document.addEventListener('notch:modechange', (event) => {
    if (event.detail?.expanded) rollHomeNote();
    else flush();
  });
  setInterval(() => rollHomeNote(), 60_000);

  window.NotchNotes = {
    list: () => load(),
    async open(id) {
      if (typeof window.setActiveTab === 'function') await window.setActiveTab('notes');
      window.NotchPromptLibrary?.setLibrary?.('notes', { remember: false });
      query = '';
      if (search) search.value = '';
      select(id);
    },
    // 随手记的随笔：一天一条「随手记 · 9月25日」，每条前面带时间。那条被删了就另起一条。
    appendCapture(text, at = Date.now()) {
      const Capture = window.NotchCapture;
      flush();
      const day = Capture.captureDayKey(at);
      let state = {};
      try { state = JSON.parse(localStorage.getItem(CAPTURE_KEY) || '{}') || {}; } catch (error) {}
      const notes = load();
      let note = state.day === day ? notes.find((item) => item.id === state.id) : null;
      if (note) {
        note.content = Capture.appendCaptureLine(note.content, text, at);
        note.updatedAt = Math.max(note.createdAt, Date.now());
      } else {
        note = { id: uid(), title: Capture.captureNoteTitle(at), titleSource: 'user', content: Capture.appendCaptureLine('', text, at), createdAt: at, updatedAt: at };
        notes.unshift(note);
      }
      if (!store(notes)) return '';
      localStorage.setItem(CAPTURE_KEY, JSON.stringify({ day, id: note.id }));
      render();
      return note.id;
    },
    syncHomeNote,
    rollHomeNote,
    flush,
    // 切到笔记页时刷新（时间标签、随手记新加的内容）；正在编辑时不打断。
    refresh() {
      if (!detail.contains(document.activeElement)) render();
    },
    create: createNote,
    setMode,
    state: () => ({ selectedId, query, saveState, mode: currentNote() ? modeOf(currentNote()) : '' }),
  };

  rollHomeNote();
  render();
})();
