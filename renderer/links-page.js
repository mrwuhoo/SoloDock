// 链接页：左栏分组（全部 / 未分组 / 自定义）+ 右侧两列链接；剪贴板建议条；分组与链接的「⋯」菜单；
// 拖到左栏分组即移动、拖到行上可排序；删除 5 秒内可撤销。数据存 `notch-link-groups`，结构不变。
(function bootstrapLinksPage() {
  'use strict';

  const Domain = window.NotchDomain;
  const L = window.NotchLinksDomain;
  const $ = (id) => document.getElementById(id);
  const page = $('links-page');
  const nav = $('links-nav');
  const body = $('links-body');
  if (!Domain || !L || !page || !nav || !body) return;

  const KEY = 'notch-link-groups';
  const SEEN_KEY = 'notch-link-clip-seen-v1';
  const DISMISSED_KEY = 'notch-link-clip-dismissed-v1';
  const api = () => window.notchAPI || {};
  const toast = (message, options) => (typeof window.showStatusToast === 'function' ? window.showStatusToast(message, options) : null);
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const els = {
    total: $('links-total'),
    add: $('link-add'),
    search: $('links-search'),
    suggest: $('links-suggest'),
    suggestUrl: $('links-suggest-url'),
    suggestSave: $('links-suggest-save'),
    menu: $('links-menu'),
    newGroup: $('links-new-group'),
    newGroupName: $('links-new-group-name'),
    addGroup: $('links-add-group'),
  };
  const ICON = {
    all: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.3 3.6 5 3.6 8s-1.1 5.7-3.6 8c-2.5-2.3-3.6-5-3.6-8S9.5 6.3 12 4Z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5a2 2 0 0 1 2-2h3.6l2 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.5" y="8.5" width="10" height="10" rx="2"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
    open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.5 5.5h5v5M18.5 5.5l-7.5 7.5"/><path d="M17.5 13.5v4a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h4"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="17.5" cy="12" r="1.3"/></svg>',
  };

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (error) { return false; }
  }

  function normalize(value) {
    return (Array.isArray(value) ? value : []).filter((group) => group && group.id).map((group) => ({
      ...group,
      name: String(group.name || '').trim() || L.UNSORTED,
      links: (Array.isArray(group.links) ? group.links : []).filter((link) => link && link.id && link.url),
    }));
  }

  let groups = normalize(readJson(KEY, []));
  let selected = 'all';
  let query = '';
  let editing = null; // { kind: 'group' | 'link', id }
  let flashId = '';
  let suggestion = '';

  const allLinks = () => groups.flatMap((group) => group.links.map((link) => ({ link, group })));
  const groupById = (id) => groups.find((group) => group.id === id) || null;
  const unsorted = () => groups.find((group) => group.name === L.UNSORTED) || null;
  function ensureUnsorted() {
    let group = unsorted();
    if (!group) {
      group = { id: uid('group'), name: L.UNSORTED, links: [] };
      groups.unshift(group);
    }
    return group.id;
  }
  const findLink = (id) => allLinks().find((entry) => entry.link.id === id) || null;

  function persist(options = {}) {
    writeJson(KEY, groups);
    if (options.render !== false) render();
  }

  // 分组顺序：未分组永远排在「全部」下面，其余按保存的顺序。
  function orderedGroups() {
    const plain = groups.filter((group) => group.name !== L.UNSORTED);
    const loose = unsorted();
    return loose ? [loose, ...plain] : plain;
  }

  function targetGroupId(url) {
    if (selected !== 'all' && groupById(selected)) return selected;
    return Domain.preferredLinkGroupId(groups, url) || ensureUnsorted();
  }

  // ---------------- 添加 ----------------
  function addLink(raw, options = {}) {
    const url = Domain.normalizeHttpUrl(raw);
    if (!url) {
      if (!options.quiet) toast('请输入有效的公开网址');
      return { status: 'invalid' };
    }
    const existing = allLinks().find((entry) => entry.link.url === url);
    if (existing) {
      if (!options.quiet) {
        toast(`已在「${existing.group.name}」中`);
        reveal(existing.link.id, existing.group.id);
      }
      return { status: 'duplicate', group: existing.group.name };
    }
    const groupId = options.groupId && groupById(options.groupId) ? options.groupId : targetGroupId(url);
    const presetTitle = String(options.title || '').trim().slice(0, 80);
    const link = { id: uid('link'), url, title: presetTitle || L.hostOf(url), icon: '', createdAt: Date.now() };
    groupById(groupId).links.unshift(link);
    flashId = link.id;
    persist();
    // 标题和图标在后台补全，不等网络。
    Promise.resolve(api().inspectLink?.(url)).then((inspected) => {
      if (!inspected?.ok) return;
      const entry = findLink(link.id);
      if (!entry) return;
      entry.link.url = inspected.url || entry.link.url;
      if (!presetTitle && inspected.title && inspected.title !== '未命名') entry.link.title = String(inspected.title).slice(0, 120);
      if (typeof inspected.icon === 'string' && inspected.icon.startsWith('data:image/')) entry.link.icon = inspected.icon;
      persist();
    }).catch(() => {});
    return { status: 'saved', id: link.id, group: groupById(groupId).name };
  }

  // ---------------- 剪贴板建议 ----------------
  async function checkClipboard() {
    if (!els.suggest || !api().readClipboardText) return;
    const text = await Promise.resolve(api().readClipboardText()).catch(() => '');
    const url = Domain.normalizeHttpUrl(L.pickClipboardUrl(text)) || '';
    const seen = readJson(SEEN_KEY, {});
    const dismissed = readJson(DISMISSED_KEY, []);
    if (url) {
      const key = L.hashUrl(url);
      if (!Object.prototype.hasOwnProperty.call(seen, key)) {
        seen[key] = Date.now();
        const recent = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 50);
        writeJson(SEEN_KEY, Object.fromEntries(recent));
      }
    }
    const show = L.shouldSuggest(url, { saved: allLinks().map((entry) => entry.link.url), dismissed, seen, now: Date.now() });
    suggestion = show ? url : '';
    renderSuggestion();
  }

  function renderSuggestion() {
    els.suggest.hidden = !suggestion;
    if (!suggestion) return;
    els.suggestUrl.textContent = L.displayUrl(suggestion);
    const group = selected !== 'all' ? groupById(selected) : groupById(Domain.preferredLinkGroupId(groups, suggestion)) || unsorted();
    els.suggestSave.textContent = `保存到${group ? ` ${group.name}` : ` ${L.UNSORTED}`}`;
  }

  function dismissSuggestion() {
    if (!suggestion) return;
    const dismissed = readJson(DISMISSED_KEY, []);
    writeJson(DISMISSED_KEY, [L.hashUrl(suggestion), ...dismissed.filter((key) => key !== L.hashUrl(suggestion))].slice(0, 100));
    suggestion = '';
    renderSuggestion();
  }

  // ---------------- 渲染 ----------------
  function navItem(id, label, count, icon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'links-nav-item';
    button.dataset.group = id;
    button.setAttribute('aria-pressed', String(selected === id));
    button.innerHTML = `${icon}<span></span><b></b>`;
    button.querySelector('span').textContent = label;
    button.querySelector('b').textContent = String(count);
    return button;
  }

  function renderNav() {
    const total = allLinks().length;
    if (els.total) els.total.textContent = String(total);
    const items = [navItem('all', '全部', total, ICON.all)];
    if (!unsorted()) items.push(navItem('unsorted', L.UNSORTED, 0, ICON.folder));
    orderedGroups().forEach((group) => items.push(navItem(group.id, group.name, group.links.length, ICON.folder)));
    nav.replaceChildren(...items);
  }

  function favicon(link) {
    if (link.icon && link.icon.startsWith('data:image/')) {
      const img = document.createElement('img');
      img.className = 'links-favicon';
      img.alt = '';
      img.src = link.icon;
      img.addEventListener('error', () => img.replaceWith(initialTile(link)), { once: true });
      return img;
    }
    return initialTile(link);
  }

  function initialTile(link) {
    const tile = document.createElement('span');
    tile.className = 'links-favicon';
    tile.dataset.tone = L.toneOf(link);
    tile.textContent = L.initialOf(link);
    return tile;
  }

  function linkRow(link, group) {
    const row = document.createElement('div');
    row.className = `links-row${link.id === flashId ? ' flash' : ''}`;
    row.dataset.linkId = link.id;
    row.dataset.groupId = group.id;
    row.setAttribute('role', 'link');
    row.tabIndex = 0;
    row.draggable = true;
    row.title = link.url;
    const text = document.createElement('span');
    text.className = 'links-text';
    if (editing?.kind === 'link' && editing.id === link.id) {
      const input = document.createElement('input');
      input.className = 'links-edit';
      input.value = link.title;
      input.maxLength = 120;
      input.setAttribute('aria-label', '链接标题');
      text.append(input);
    } else {
      const title = document.createElement('b');
      title.textContent = link.title || L.hostOf(link.url);
      text.append(title);
    }
    const url = document.createElement('small');
    url.textContent = L.displayUrl(link.url);
    text.append(url);
    const acts = document.createElement('span');
    acts.className = 'links-acts';
    acts.innerHTML = `<button class="links-icon" type="button" data-action="copy" aria-label="复制网址" title="复制网址">${ICON.copy}</button><button class="links-icon" type="button" data-action="open" aria-label="在浏览器打开" title="在浏览器打开">${ICON.open}</button><button class="links-icon" type="button" data-action="link-menu" aria-label="更多">${ICON.more}</button>`;
    row.append(favicon(link), text, acts);
    return row;
  }

  function groupSection(group, links) {
    const section = document.createElement('section');
    section.className = 'links-group';
    section.dataset.groupId = group.id;
    const header = document.createElement('header');
    header.className = 'links-group-head';
    if (editing?.kind === 'group' && editing.id === group.id) {
      const input = document.createElement('input');
      input.className = 'links-group-edit';
      input.value = group.name;
      input.maxLength = 20;
      input.setAttribute('aria-label', '分组名称');
      header.append(input);
    } else {
      const title = document.createElement('h3');
      title.textContent = group.name;
      header.append(title);
    }
    const count = document.createElement('span');
    count.className = 'links-count';
    count.textContent = String(links.length);
    header.append(count, Object.assign(document.createElement('span'), { className: 'links-flex' }));
    if (group.name !== L.UNSORTED) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'links-icon';
      more.dataset.action = 'group-menu';
      more.setAttribute('aria-label', '分组选项');
      more.innerHTML = ICON.more;
      header.append(more);
    }
    const grid = document.createElement('div');
    grid.className = 'links-grid';
    links.forEach((link) => grid.append(linkRow(link, group)));
    section.append(header, grid);
    if (!links.length) {
      const empty = document.createElement('p');
      empty.className = 'links-empty-inline';
      empty.textContent = '这个分组还没有链接，粘贴网址回车就存进来';
      section.append(empty);
    }
    return section;
  }

  function renderBody() {
    const scrollTop = body.scrollTop;
    body.replaceChildren();
    // 「全部」只列有链接的分组；选中某个分组时即使是空的也显示它；搜索时只列有命中的。
    const shown = selected === 'all' ? orderedGroups() : [groupById(selected)].filter(Boolean);
    const sections = shown
      .map((group) => ({ group, links: group.links.filter((link) => L.linkMatches(link, query)) }))
      .filter(({ links }) => links.length > 0 || (selected !== 'all' && !query));
    if (!sections.length) {
      const empty = document.createElement('div');
      empty.className = 'links-empty';
      empty.innerHTML = query ? '<strong>没有找到</strong><p>试试标题里的词或网址的一部分。</p>' : '<strong>还没有收藏的链接</strong><p>粘贴一个网址，回车就收藏好了；标题和图标会自动补全。</p>';
      body.append(empty);
    } else {
      sections.forEach(({ group, links }) => body.append(groupSection(group, links)));
    }
    body.scrollTop = scrollTop;
    const edit = body.querySelector('.links-edit, .links-group-edit');
    if (edit) { edit.focus(); edit.select(); }
    if (flashId) {
      const row = body.querySelector(`[data-link-id="${CSS.escape(flashId)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
      setTimeout(() => row?.classList.remove('flash'), 1300);
      flashId = '';
    }
  }

  function renderPlaceholder() {
    if (!els.add) return;
    const group = selected !== 'all' ? groupById(selected) : null;
    els.add.placeholder = `粘贴网址，回车保存到「${group ? group.name : L.UNSORTED}」`;
  }

  function render() {
    if (selected !== 'all' && selected !== 'unsorted' && !groupById(selected)) selected = 'all';
    if (selected === 'unsorted' && unsorted()) selected = unsorted().id;
    renderNav();
    renderBody();
    renderPlaceholder();
    if (suggestion) renderSuggestion();
  }

  function reveal(linkId, groupId) {
    selected = selected === 'all' ? 'all' : groupId;
    query = '';
    if (els.search) els.search.value = '';
    flashId = linkId;
    render();
  }

  // ---------------- 菜单 ----------------
  let menuContext = null;
  function openMenu(anchor, context) {
    menuContext = context;
    const menu = els.menu;
    menu.replaceChildren();
    const item = (label, action, extra = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.menu = action;
      Object.entries(extra).forEach(([key, value]) => { button.dataset[key] = value; });
      if (extra.danger) button.className = 'danger';
      button.textContent = label;
      menu.append(button);
      return button;
    };
    if (context.kind === 'group') {
      const group = groupById(context.id);
      if (context.step === 'delete') {
        const note = document.createElement('p');
        note.className = 'links-menu-note';
        note.textContent = `删除「${group.name}」，里面的 ${group.links.length} 条链接：`;
        menu.append(note);
        item(`移到「${L.UNSORTED}」`, 'group-delete-keep');
        if (group.links.length) item('一并删除', 'group-delete-all', { danger: 'true' });
      } else {
        item('重命名', 'group-rename');
        item('删除分组…', 'group-delete', { danger: 'true' });
      }
    } else {
      const entry = findLink(context.id);
      if (context.step === 'move') {
        const note = document.createElement('p');
        note.className = 'links-menu-note';
        note.textContent = '移动到';
        menu.append(note);
        const targets = orderedGroups().filter((group) => group.id !== entry.group.id);
        if (!unsorted() && entry.group.name !== L.UNSORTED) item(L.UNSORTED, 'link-move-to', { target: 'unsorted' });
        targets.forEach((group) => item(group.name, 'link-move-to', { target: group.id }));
      } else {
        item('编辑标题', 'link-rename');
        item('移动到…', 'link-move');
        item('删除', 'link-delete', { danger: 'true' });
      }
    }
    const box = page.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    menu.hidden = false;
    const left = Math.max(0, Math.min(rect.right - box.left - menu.offsetWidth, box.width - menu.offsetWidth));
    let top = rect.bottom - box.top + 4;
    if (top + menu.offsetHeight > box.height) top = Math.max(0, rect.top - box.top - menu.offsetHeight - 4);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    anchor.setAttribute('aria-expanded', 'true');
    menuContext.anchor = anchor;
  }

  function closeMenu() {
    if (els.menu.hidden) return false;
    els.menu.hidden = true;
    menuContext?.anchor?.setAttribute('aria-expanded', 'false');
    menuContext = null;
    return true;
  }

  function deleteLink(id) {
    const entry = findLink(id);
    if (!entry) return;
    const index = entry.group.links.indexOf(entry.link);
    entry.group.links.splice(index, 1);
    persist();
    toast(`已删除「${entry.link.title || L.hostOf(entry.link.url)}」`, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => {
        const group = groupById(entry.group.id) || groupById(ensureUnsorted());
        if (findLink(entry.link.id)) return;
        group.links.splice(Math.min(index, group.links.length), 0, entry.link);
        persist();
      },
    });
  }

  function deleteGroup(id, keepLinks) {
    const index = groups.findIndex((group) => group.id === id);
    if (index < 0) return;
    const snapshot = JSON.parse(JSON.stringify(groups));
    const [group] = groups.splice(index, 1);
    if (keepLinks && group.links.length) groupById(ensureUnsorted()).links.push(...group.links);
    if (selected === id) selected = 'all';
    persist();
    toast(keepLinks ? `已删除「${group.name}」，链接移到「${L.UNSORTED}」` : `已删除「${group.name}」和 ${group.links.length} 条链接`, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => {
        groups = snapshot;
        persist();
      },
    });
  }

  function moveLink(linkId, targetId, index = null) {
    const target = targetId === 'unsorted' ? ensureUnsorted() : targetId;
    const before = JSON.stringify(groups.map((group) => [group.id, group.links.map((link) => link.id)]));
    groups = normalize(index === null ? Domain.moveLinkToGroup(groups, linkId, target) : Domain.moveLinkToPosition(groups, linkId, target, index));
    if (JSON.stringify(groups.map((group) => [group.id, group.links.map((link) => link.id)])) === before) return false;
    persist();
    return true;
  }

  els.menu.addEventListener('click', (event) => {
    const button = event.target.closest('[data-menu]');
    if (!button || !menuContext) return;
    const context = menuContext;
    const action = button.dataset.menu;
    if (action === 'group-delete') return openMenu(context.anchor, { ...context, step: 'delete' });
    if (action === 'link-move') return openMenu(context.anchor, { ...context, step: 'move' });
    closeMenu();
    if (action === 'group-rename') { editing = { kind: 'group', id: context.id }; renderBody(); }
    else if (action === 'group-delete-keep') deleteGroup(context.id, true);
    else if (action === 'group-delete-all') deleteGroup(context.id, false);
    else if (action === 'link-rename') { editing = { kind: 'link', id: context.id }; renderBody(); }
    else if (action === 'link-delete') deleteLink(context.id);
    else if (action === 'link-move-to') {
      const target = button.dataset.target;
      if (moveLink(context.id, target)) toast(`已移到「${target === 'unsorted' ? L.UNSORTED : groupById(target)?.name || L.UNSORTED}」`);
    }
  });

  function finishEdit(save) {
    const input = body.querySelector('.links-edit, .links-group-edit');
    const current = editing;
    editing = null;
    if (save && input && current) {
      const value = input.value.replace(/\s+/g, ' ').trim();
      if (current.kind === 'group' && value && !groups.some((group) => group.id !== current.id && group.name === value)) {
        groupById(current.id).name = value.slice(0, 20);
      } else if (current.kind === 'link' && value) {
        const entry = findLink(current.id);
        if (entry) entry.link.title = value.slice(0, 120);
      }
      persist();
      return;
    }
    render();
  }

  // ---------------- 事件 ----------------
  nav.addEventListener('click', (event) => {
    const item = event.target.closest('[data-group]');
    if (!item) return;
    selected = item.dataset.group === 'unsorted' ? ensureUnsorted() : item.dataset.group;
    if (item.dataset.group === 'unsorted') persist({ render: false });
    closeMenu();
    render();
  });

  body.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    const row = event.target.closest('.links-row');
    const section = event.target.closest('.links-group');
    if (action === 'group-menu' && section) {
      event.stopPropagation();
      return openMenu(event.target.closest('[data-action]'), { kind: 'group', id: section.dataset.groupId });
    }
    if (!row || event.target.closest('.links-edit')) return;
    const entry = findLink(row.dataset.linkId);
    if (!entry) return;
    if (action === 'link-menu') return openMenu(event.target.closest('[data-action]'), { kind: 'link', id: entry.link.id });
    if (action === 'copy') {
      Promise.resolve(api().writeClipboard?.({ type: 'text', text: entry.link.url })).then(() => toast('已复制网址')).catch(() => {});
      return;
    }
    // 点行本身或「打开」：用默认浏览器打开。
    api().openExternal?.(entry.link.url)?.catch?.(() => {});
  });
  body.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.target.closest('.links-edit, .links-group-edit')) {
      if (event.key === 'Enter') { event.preventDefault(); finishEdit(true); }
      return;
    }
    const row = event.target.closest('.links-row');
    if (row && event.key === 'Enter' && event.target === row) {
      const entry = findLink(row.dataset.linkId);
      if (entry) api().openExternal?.(entry.link.url)?.catch?.(() => {});
    }
  });
  body.addEventListener('focusout', (event) => {
    if (event.target.closest('.links-edit, .links-group-edit') && editing) finishEdit(true);
  });

  // 拖动：拖到左栏分组 = 移过去；拖到别的行上 = 排到它前面或后面。
  let dragId = '';
  body.addEventListener('dragstart', (event) => {
    const row = event.target.closest?.('.links-row');
    if (!row) return;
    dragId = row.dataset.linkId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', findLink(dragId)?.link.url || '');
    row.classList.add('dragging');
  });
  const clearMarks = () => page.querySelectorAll('.drop-before, .drop-after, .drop-target, .dragging').forEach((node) => node.classList.remove('drop-before', 'drop-after', 'drop-target', 'dragging'));
  body.addEventListener('dragend', () => { dragId = ''; clearMarks(); });
  body.addEventListener('dragover', (event) => {
    const row = event.target.closest?.('.links-row');
    if (!dragId || !row || row.dataset.linkId === dragId) return;
    event.preventDefault();
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    page.querySelectorAll('.drop-before, .drop-after').forEach((node) => node.classList.remove('drop-before', 'drop-after'));
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  body.addEventListener('drop', (event) => {
    const row = event.target.closest?.('.links-row');
    if (!dragId || !row) return;
    event.preventDefault();
    const group = groupById(row.dataset.groupId);
    const index = group.links.findIndex((link) => link.id === row.dataset.linkId) + (row.classList.contains('drop-after') ? 1 : 0);
    const id = dragId;
    dragId = '';
    clearMarks();
    moveLink(id, group.id, index);
  });
  nav.addEventListener('dragover', (event) => {
    const item = event.target.closest?.('[data-group]');
    if (!dragId || !item || item.dataset.group === 'all') return;
    event.preventDefault();
    nav.querySelectorAll('.drop-target').forEach((node) => node.classList.remove('drop-target'));
    item.classList.add('drop-target');
  });
  nav.addEventListener('dragleave', (event) => event.target.closest?.('[data-group]')?.classList.remove('drop-target'));
  nav.addEventListener('drop', (event) => {
    const item = event.target.closest?.('[data-group]');
    if (!dragId || !item || item.dataset.group === 'all') return;
    event.preventDefault();
    const id = dragId;
    dragId = '';
    clearMarks();
    const target = item.dataset.group;
    if (moveLink(id, target)) toast(`已移到「${target === 'unsorted' ? L.UNSORTED : groupById(target)?.name}」`);
  });

  els.add?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.repeat) return;
    event.preventDefault();
    const value = els.add.value.trim();
    if (!value) return;
    const result = addLink(value);
    if (result.status === 'saved') {
      els.add.value = '';
      toast(`已保存到「${result.group}」`);
    }
  });
  els.search?.addEventListener('input', () => {
    query = els.search.value;
    renderBody();
  });
  els.suggestSave?.addEventListener('click', () => {
    const url = suggestion;
    suggestion = '';
    renderSuggestion();
    const result = addLink(url);
    if (result.status === 'saved') toast(`已保存到「${result.group}」`);
  });
  $('links-suggest-dismiss')?.addEventListener('click', dismissSuggestion);

  els.addGroup?.addEventListener('click', () => {
    els.newGroup.hidden = false;
    els.addGroup.hidden = true;
    els.newGroupName.value = '';
    els.newGroupName.focus();
  });
  const closeNewGroup = () => { els.newGroup.hidden = true; els.addGroup.hidden = false; };
  els.newGroup?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = els.newGroupName.value.replace(/\s+/g, ' ').trim().slice(0, 20);
    closeNewGroup();
    if (!name) return;
    const existing = groups.find((group) => group.name === name);
    if (existing) { selected = existing.id; render(); return; }
    const group = { id: uid('group'), name, links: [] };
    groups.push(group);
    selected = group.id;
    persist();
  });
  els.newGroupName?.addEventListener('blur', () => { if (!els.newGroupName.value.trim()) closeNewGroup(); });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('#links-menu, [data-action="group-menu"], [data-action="link-menu"]')) closeMenu();
  }, true);

  // 打开链接页（或面板在链接页上展开）时看一眼剪贴板。
  const onLinksPage = () => document.getElementById('tab-links')?.classList.contains('active');
  document.addEventListener('notch:tabchange', (event) => { if (event.detail?.tab === 'links') checkClipboard(); });
  document.addEventListener('notch:modechange', (event) => { if (event.detail?.expanded && onLinksPage()) checkClipboard(); });

  window.NotchLinks = {
    // 随手记等其他入口收藏链接：返回 'saved' / 'duplicate' / 'invalid'。
    add(url, title = '') {
      return addLink(url, { title, quiet: true }).status;
    },
    groups: () => groups.map((group) => ({ ...group, links: group.links.map((link) => ({ ...link })) })),
    render,
    checkClipboard,
    escape: () => {
      if (closeMenu()) return true;
      if (editing) { finishEdit(false); return true; }
      return false;
    },
  };

  render();
})();
