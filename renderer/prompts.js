// Prompt library on the first page of the Notes tab (formerly the home "常用指令" card).
// Prompts are only stored and copied; SoloDock never sends them to a model.
(function bootstrapPromptLibrary() {
  'use strict';

  const Prompts = window.NotchPrompts;
  const page = document.getElementById('notes-page');
  if (!Prompts || !page) return;

  const PROMPTS_KEY = 'notch-prompts-v1';
  const LEGACY_COMMANDS_KEY = 'notch-home-commands';
  const VALUES_KEY = 'notch-prompt-values-v1';
  const LIBRARY_KEY = 'notch-notes-library-v1';

  const listEl = document.getElementById('prompts-list');
  const detailEl = document.getElementById('prompts-detail');
  const groupsEl = document.getElementById('prompt-groups');
  const countEl = document.getElementById('prompts-count');
  const searchEl = document.getElementById('notes-search');
  const newButton = document.getElementById('notes-new');
  const modeButtons = [...document.querySelectorAll('[data-notes-mode]')];

  const toast = (message, options) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message, options);
  };
  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* quota: keep session state */ }
  };
  const uid = () => `prompt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // One-time migration: the legacy commands key is kept untouched for rollback.
  function loadPrompts() {
    const stored = readJson(PROMPTS_KEY, null);
    if (Array.isArray(stored)) return Prompts.normalizePrompts(stored);
    const migrated = Prompts.migrateCommands(readJson(LEGACY_COMMANDS_KEY, []));
    writeJson(PROMPTS_KEY, migrated);
    return migrated;
  }

  let prompts = loadPrompts();
  let values = readJson(VALUES_KEY, {});
  if (!values || typeof values !== 'object' || Array.isArray(values)) values = {};
  let selectedId = '';
  let activeGroup = '';
  let saveTimer = null;

  function persist() {
    writeJson(PROMPTS_KEY, prompts);
  }

  function selected() {
    return prompts.find((prompt) => prompt.id === selectedId) || null;
  }

  function relativeTime(timestamp) {
    if (!timestamp) return '还没用过';
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return '刚刚用过';
    if (minutes < 60) return `${minutes} 分钟前用过`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小时前用过`;
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}月${date.getDate()}日用过`;
  }

  function renderGroups() {
    if (!groupsEl) return;
    const groups = Prompts.promptGroups(prompts);
    if (activeGroup && activeGroup !== '★' && !groups.includes(activeGroup)) activeGroup = '';
    const chips = [['', '全部'], ['★', '★ 精选'], ...groups.map((group) => [group, group])];
    groupsEl.replaceChildren(...chips.map(([value, label]) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `prompt-group${value === activeGroup ? ' active' : ''}`;
      chip.dataset.group = value;
      chip.setAttribute('aria-pressed', String(value === activeGroup));
      chip.textContent = label;
      return chip;
    }));
  }

  function renderList() {
    renderRows({ keepSelection: false });
    renderDetail();
  }

  // Rows only: used while the user types in the detail so inputs (and IME composition) survive.
  function renderRows({ keepSelection }) {
    if (!listEl) return;
    const visible = Prompts.filterPrompts(prompts, searchEl?.value || '', activeGroup);
    if (countEl) countEl.textContent = String(prompts.length);
    if (!keepSelection && !visible.some((prompt) => prompt.id === selectedId)) selectedId = visible[0]?.id || '';
    const scrollTop = listEl.scrollTop;
    listEl.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'notes-list-empty';
      empty.textContent = prompts.length ? '没有找到相关提示词' : '点「新建」保存第一条常用提示词';
      listEl.append(empty);
    }
    visible.forEach((prompt) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `notes-list-item prompt-item${prompt.id === selectedId ? ' active' : ''}`;
      row.dataset.promptId = prompt.id;
      row.setAttribute('aria-pressed', String(prompt.id === selectedId));
      const title = document.createElement('strong');
      title.textContent = prompt.title;
      if (prompt.starred) {
        const star = document.createElement('i');
        star.className = 'prompt-star';
        star.setAttribute('aria-label', '精选');
        star.textContent = '★';
        title.append(star);
      }
      const meta = document.createElement('span');
      const variableCount = Prompts.editableVariables(prompt.text).length;
      meta.textContent = [prompt.group || '未分组', variableCount ? `${variableCount} 个变量` : '', prompt.uses ? `${prompt.uses} 次` : '']
        .filter(Boolean).join(' · ');
      row.append(title, meta);
      listEl.append(row);
    });
    listEl.scrollTop = scrollTop;
  }

  function fieldInput(className, value, placeholder, label, maxLength) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = className;
    input.value = value;
    input.placeholder = placeholder;
    input.maxLength = maxLength;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', label);
    return input;
  }

  function renderVariables(prompt) {
    const box = detailEl.querySelector('.prompt-vars');
    if (!box) return;
    const names = Prompts.editableVariables(prompt.text);
    const saved = values[prompt.id] || {};
    box.replaceChildren();
    box.hidden = names.length === 0;
    names.forEach((name) => {
      const label = document.createElement('label');
      label.className = 'prompt-var';
      const caption = document.createElement('span');
      caption.textContent = name;
      const input = fieldInput('prompt-var-input', saved[name] || '', `填写${name}`, name, 400);
      input.dataset.variable = name;
      label.append(caption, input);
      box.append(label);
    });
    const hint = detailEl.querySelector('.prompt-hint');
    const builtins = Prompts.extractVariables(prompt.text).filter((name) => Prompts.BUILTIN_VARIABLES.includes(name));
    if (hint) {
      hint.textContent = builtins.length
        ? `复制时自动填入：${builtins.map((name) => `{${name}}`).join(' ')}`
        : '用 {名称} 标记变量，例如 {称呼}；{剪贴板} 和 {日期} 会自动填入';
    }
  }

  function renderDetail() {
    if (!detailEl) return;
    const prompt = selected();
    detailEl.replaceChildren();
    if (!prompt) {
      const empty = document.createElement('div');
      empty.className = 'notes-detail-empty';
      empty.innerHTML = prompts.length
        ? '<span class="notes-empty-mark" aria-hidden="true">⌕</span><strong>没有匹配的提示词</strong><p>试试其他关键词或分组。</p>'
        : '<span class="notes-empty-mark" aria-hidden="true">✦</span><strong>保存你的常用提示词</strong><p>把反复用到的提示词、回复模板放在这里，用 {称呼} 这样的变量，填好后一键复制。</p>';
      detailEl.append(empty);
      return;
    }
    const header = document.createElement('header');
    header.className = 'notes-detail-head prompt-head';
    const heading = document.createElement('div');
    const title = fieldInput('notes-detail-title prompt-title', prompt.title, '提示词名称', '提示词名称，可直接修改', 40);
    const meta = document.createElement('div');
    meta.className = 'prompt-meta';
    const group = fieldInput('prompt-group-input', prompt.group, '分组', '分组', 12);
    group.setAttribute('list', 'prompt-group-options');
    const datalist = document.createElement('datalist');
    datalist.id = 'prompt-group-options';
    Prompts.promptGroups(prompts).forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      datalist.append(option);
    });
    const usage = document.createElement('span');
    usage.className = 'prompt-usage';
    usage.textContent = `用过 ${prompt.uses} 次 · ${relativeTime(prompt.lastUsedAt)}`;
    meta.append(group, datalist, usage);
    heading.append(title, meta);
    const actions = document.createElement('div');
    actions.className = 'notes-detail-actions';
    const star = document.createElement('button');
    star.type = 'button';
    star.className = `prompt-star-toggle${prompt.starred ? ' active' : ''}`;
    star.dataset.action = 'star';
    star.setAttribute('aria-pressed', String(prompt.starred));
    star.setAttribute('aria-label', prompt.starred ? '取消精选' : '设为精选');
    star.title = prompt.starred ? '取消精选' : '设为精选';
    star.textContent = prompt.starred ? '★' : '☆';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'notes-delete';
    remove.dataset.action = 'delete';
    remove.setAttribute('aria-label', '删除提示词');
    remove.title = '删除提示词';
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h10l1-12"/></svg>';
    actions.append(star, remove);
    header.append(heading, actions);

    const editor = document.createElement('textarea');
    editor.className = 'notes-editor prompt-editor';
    editor.value = prompt.text;
    editor.placeholder = '写下提示词。用 {称呼}、{项目} 这样的变量，复制前在下方填写。';
    editor.spellcheck = false;
    editor.setAttribute('aria-label', `编辑提示词：${prompt.title}`);

    const vars = document.createElement('div');
    vars.className = 'prompt-vars';

    const footer = document.createElement('footer');
    footer.className = 'prompt-actions';
    const copyFilled = document.createElement('button');
    copyFilled.type = 'button';
    copyFilled.className = 'workspace-button primary';
    copyFilled.dataset.action = 'copy-filled';
    copyFilled.textContent = '填好后复制';
    const copyRaw = document.createElement('button');
    copyRaw.type = 'button';
    copyRaw.className = 'workspace-button';
    copyRaw.dataset.action = 'copy-raw';
    copyRaw.textContent = '复制原文';
    const hint = document.createElement('small');
    hint.className = 'prompt-hint';
    footer.append(copyFilled, copyRaw, hint);

    detailEl.append(header, editor, vars, footer);
    renderVariables(prompt);
  }

  // Saves a field while the user is typing: the detail inputs are left alone,
  // only the list rows and group chips are refreshed.
  function updatePrompt(id, patch, { refreshDetail = false } = {}) {
    const now = Date.now();
    prompts = Prompts.normalizePrompts(prompts.map((prompt) => (
      prompt.id === id ? { ...prompt, ...patch, updatedAt: now } : prompt
    )));
    persist();
    renderGroups();
    renderRows({ keepSelection: true });
    if (refreshDetail) renderDetail();
  }

  async function copyPrompt(filled) {
    const prompt = selected();
    if (!prompt || !window.notchAPI?.writeClipboard) return;
    let text = prompt.text;
    if (filled) {
      const needsClipboard = Prompts.extractVariables(prompt.text).includes('剪贴板');
      let clipboard = null;
      if (needsClipboard && window.notchAPI.readClipboardText) {
        clipboard = await window.notchAPI.readClipboardText().catch(() => null);
      }
      text = Prompts.fillTemplate(prompt.text, values[prompt.id] || {}, { clipboard: typeof clipboard === 'string' ? clipboard : null });
    }
    if (!text.trim()) {
      toast('提示词还是空的');
      return;
    }
    const copied = await window.notchAPI.writeClipboard({ type: 'text', text }).catch(() => false);
    if (!copied) {
      toast('复制失败');
      return;
    }
    prompts = Prompts.recordUse(prompts, prompt.id);
    persist();
    const missing = filled && /\{[^{}\n]{1,24}\}/.test(text);
    toast(missing ? '已复制 · 还有变量没有填写' : '已复制');
    renderGroups();
    renderList();
  }

  function createPrompt() {
    const now = Date.now();
    const prompt = { id: uid(), title: '新提示词', text: '', group: activeGroup && activeGroup !== '★' ? activeGroup : '', createdAt: now, updatedAt: now };
    prompts = Prompts.normalizePrompts([prompt, ...prompts]);
    persist();
    if (searchEl) searchEl.value = '';
    selectedId = prompt.id;
    renderGroups();
    renderList();
    const title = detailEl.querySelector('.prompt-title');
    title?.focus();
    title?.select();
  }

  function deletePrompt() {
    const prompt = selected();
    if (!prompt) return;
    const before = prompts;
    prompts = prompts.filter((item) => item.id !== prompt.id);
    persist();
    renderGroups();
    renderList();
    toast(`已删除「${prompt.title}」`, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => {
        prompts = before;
        selectedId = prompt.id;
        persist();
        renderGroups();
        renderList();
      },
    });
  }

  function setLibrary(mode, { remember = true } = {}) {
    const library = mode === 'notes' ? 'notes' : 'prompts';
    page.dataset.library = library;
    modeButtons.forEach((button) => {
      const active = button.dataset.notesMode === library;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    if (searchEl) {
      searchEl.value = '';
      searchEl.placeholder = library === 'prompts' ? '搜索提示词' : '搜索笔记';
      // Let the notes library re-render with the cleared query as well.
      searchEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (remember) writeJson(LIBRARY_KEY, library);
  }

  modeButtons.forEach((button) => button.addEventListener('click', () => setLibrary(button.dataset.notesMode)));
  newButton?.addEventListener('click', () => {
    if (page.dataset.library === 'prompts') createPrompt();
  });
  searchEl?.addEventListener('input', () => {
    if (page.dataset.library === 'prompts') renderList();
  });
  groupsEl?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-group]');
    if (!chip) return;
    activeGroup = chip.dataset.group;
    renderGroups();
    renderList();
  });
  listEl?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-prompt-id]');
    if (!row) return;
    selectedId = row.dataset.promptId;
    renderList();
  });
  detailEl?.addEventListener('input', (event) => {
    const prompt = selected();
    if (!prompt) return;
    const target = event.target;
    if (target.classList.contains('prompt-title')) {
      updatePrompt(prompt.id, { title: target.value });
    } else if (target.classList.contains('prompt-group-input')) {
      updatePrompt(prompt.id, { group: target.value });
    } else if (target.classList.contains('prompt-editor')) {
      // Keep typing smooth: save after a short pause and refresh only the variable form.
      prompt.text = target.value;
      renderVariables(prompt);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => updatePrompt(prompt.id, { text: target.value }), 400);
    } else if (target.classList.contains('prompt-var-input')) {
      values = { ...values, [prompt.id]: { ...(values[prompt.id] || {}), [target.dataset.variable]: target.value } };
      writeJson(VALUES_KEY, values);
    }
  });
  detailEl?.addEventListener('focusout', (event) => {
    if (!event.target.classList.contains('prompt-editor') || !saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const prompt = selected();
    if (prompt) updatePrompt(prompt.id, { text: event.target.value });
  });
  detailEl?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    const prompt = selected();
    if (!action || !prompt) return;
    if (action === 'star') updatePrompt(prompt.id, { starred: !prompt.starred }, { refreshDetail: true });
    if (action === 'delete') deletePrompt();
    if (action === 'copy-filled') copyPrompt(true);
    if (action === 'copy-raw') copyPrompt(false);
  });
  window.addEventListener('beforeunload', () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    const editor = detailEl?.querySelector('.prompt-editor');
    const prompt = selected();
    if (editor && prompt) {
      prompts = Prompts.normalizePrompts(prompts.map((item) => (item.id === prompt.id ? { ...item, text: editor.value } : item)));
      persist();
    }
  });

  setLibrary(readJson(LIBRARY_KEY, 'prompts'), { remember: false });
  renderGroups();
  renderList();

  window.NotchPromptLibrary = {
    list: () => prompts.map((prompt) => ({ ...prompt })),
    setLibrary,
    // 从搜索打开：切到提示词页并选中这一条（有变量要填时用这个）。
    open(id) {
      setLibrary('prompts', { remember: false });
      activeGroup = '';
      selectedId = String(id || '');
      renderGroups();
      renderList();
    },
    // 从搜索直接复制（没有要填的变量时）。
    async copy(id) {
      selectedId = String(id || '');
      await copyPrompt(true);
    },
    needsInput: (id) => {
      const prompt = prompts.find((item) => item.id === id);
      return Boolean(prompt && Prompts.editableVariables(prompt.text).length);
    },
  };
})();
