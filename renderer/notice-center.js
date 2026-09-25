// 通知中心：顶栏铃铛下方的弹层，找回错过的提醒。数据由主进程 notice-store.js 保存（7 天）。
// 分组：需要你处理（AI 等你确认、还没处理）/ 今天 / 更早。打开即视为已读。
(function bootstrapNoticeCenter() {
  'use strict';

  const get = (id) => document.getElementById(id);
  const bell = get('notice-bell');
  const panel = get('notice-center');
  const list = get('notice-center-list');
  const badge = get('notice-badge');
  if (!bell || !panel || !list) return;

  const api = () => window.notchAPI || {};
  const toast = (message) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message);
  };
  const SOURCE = {
    codex: ['Codex', 'check'],
    claude: ['Claude', 'spark'],
    gpt: ['GPT', 'spark'],
    chatgpt: ['GPT', 'spark'],
    task: ['任务', 'check'],
    'needs-you': ['需要你确认', 'alert'],
    todo: ['待办', 'clock'],
    event: ['日程', 'calendar'],
    reminder: ['提醒', 'bell'],
    pomodoro: ['专注', 'timer'],
    'pomodoro-break': ['休息', 'leaf'],
    sit: ['久坐', 'walk'],
    offwork: ['收工', 'moon'],
  };
  const GLYPHS = {
    check: '<path d="m6.5 12.5 3.5 3.5 7.5-8"/>',
    spark: '<path d="M12 3.5c.7 4 2.8 6.1 6.8 6.8-4 .7-6.1 2.8-6.8 6.8-.7-4-2.8-6.1-6.8-6.8 4-.7 6.1-2.8 6.8-6.8Z"/>',
    alert: '<path d="M12 4.5 21 19.5H3Z"/><path d="M12 10v4.2M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.8v4.7l3.2 1.8"/>',
    calendar: '<rect x="4.5" y="5.5" width="15" height="14" rx="3"/><path d="M4.5 10h15M9 3.5v4M15 3.5v4"/>',
    bell: '<path d="M7 16.5V11a5 5 0 0 1 10 0v5.5l1.5 1.5h-13Z"/><path d="M10.2 20.2a2 2 0 0 0 3.6 0"/>',
    timer: '<circle cx="12" cy="13.5" r="6.8"/><path d="M12 13.5V10M10 3.8h4"/>',
    leaf: '<path d="M5.5 18.5c0-7.5 5-12 13-12 0 8-4.5 13-12 13Z"/><path d="M5.5 18.5 13 11"/>',
    walk: '<circle cx="13" cy="4.8" r="1.8"/><path d="m10 21 2.3-6.2 2.7 2.4V21M8 12.5l2.4-4.3 3.6 1.2 2 3.3M12.3 14.8 11 9.5"/>',
    moon: '<path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z"/>',
  };
  const AI = new Set(['codex', 'claude', 'gpt', 'chatgpt', 'task', 'needs-you']);

  let items = [];
  let summary = { unread: 0, needsYou: 0 };
  let highlight = '';

  const pad = (value) => String(value).padStart(2, '0');
  function timeLabel(at, now = Date.now()) {
    const date = new Date(at);
    const today = new Date(now);
    const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    const dayDiff = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
    if (dayDiff === 0) return clock;
    if (dayDiff === 1) return `昨天 ${clock}`;
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function renderBadge() {
    const count = summary.needsYou || summary.unread;
    badge.hidden = !count;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.dataset.tone = summary.needsYou ? 'needs' : 'unread';
    bell.dataset.tone = summary.needsYou ? 'needs' : '';
    bell.setAttribute('aria-label', summary.needsYou
      ? `通知中心：${summary.needsYou} 件需要你处理`
      : summary.unread ? `通知中心：${summary.unread} 条未读` : '通知中心');
  }

  function row(item) {
    const [label, glyph] = SOURCE[item.source] || ['提醒', 'bell'];
    const node = document.createElement('article');
    node.className = 'notice-item';
    node.dataset.id = item.id;
    node.dataset.source = item.source;
    if (item.handled) node.dataset.handled = 'true';
    if (!item.read) node.dataset.unread = 'true';
    if (highlight && item.source === highlight && !item.handled) node.dataset.highlight = 'true';
    const icon = document.createElement('span');
    icon.className = 'notice-icon';
    icon.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[glyph]}</svg>`;
    const body = document.createElement('div');
    body.className = 'notice-body';
    const top = document.createElement('div');
    top.className = 'notice-top';
    const title = document.createElement('b');
    title.textContent = item.title;
    const time = document.createElement('time');
    time.textContent = timeLabel(item.at);
    top.append(title, time);
    const detail = document.createElement('p');
    detail.textContent = [item.source === 'needs-you' ? '' : label, item.detail].filter(Boolean).join(' · ');
    body.append(top, detail);
    const actions = document.createElement('div');
    actions.className = 'notice-actions';
    if (item.handled) {
      const done = document.createElement('span');
      done.className = 'notice-done';
      done.textContent = '已处理';
      actions.append(done);
    } else if (AI.has(item.source) && item.project) {
      actions.append(button('跳回窗口', 'open', item.source === 'needs-you'));
      if (item.source === 'needs-you') actions.append(button('忽略', 'dismiss'));
    } else if (item.source === 'todo') {
      actions.append(button('完成', 'todo-done', true), button('打开', 'open-todo'));
    }
    if (actions.childNodes.length) body.append(actions);
    node.append(icon, body);
    return node;
  }

  function button(label, action, primary = false) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = `notice-action${primary ? ' primary' : ''}`;
    node.dataset.action = action;
    node.textContent = label;
    return node;
  }

  function group(title, entries) {
    if (!entries.length) return null;
    const section = document.createElement('section');
    section.className = 'notice-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    section.append(heading, ...entries.map(row));
    return section;
  }

  function render() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const pending = items.filter((item) => item.source === 'needs-you' && !item.handled);
    const rest = items.filter((item) => !pending.includes(item));
    const sections = [
      group('需要你处理', pending),
      group('今天', rest.filter((item) => item.at >= startOfToday)),
      group('更早', rest.filter((item) => item.at < startOfToday)),
    ].filter(Boolean);
    list.replaceChildren(...sections);
    if (!sections.length) {
      const empty = document.createElement('div');
      empty.className = 'notice-empty';
      empty.innerHTML = '<b>没有错过的提醒</b><span>AI 完成、需要你确认、待办到期都会留在这里 7 天</span>';
      list.append(empty);
    }
    get('notice-center-meta').textContent = summary.needsYou ? `${summary.needsYou} 件需要你处理` : `${items.length} 条`;
    get('notice-read-all').disabled = !items.some((item) => !item.read);
    get('notice-clear').disabled = !items.length;
    list.querySelector('[data-highlight="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  async function load() {
    const result = await api().listNotices?.()?.catch?.(() => null);
    if (!result) return;
    items = Array.isArray(result.items) ? result.items : [];
    summary = result.summary || summary;
    renderBadge();
    if (!panel.hidden) render();
  }

  // 弹层右边缘对齐铃铛（铃铛在右侧页签组里，位置随页签数量变化）。
  function place() {
    const topbar = panel.offsetParent || document.body;
    const bellBox = bell.getBoundingClientRect();
    const parentBox = topbar.getBoundingClientRect();
    const width = panel.offsetWidth || 380;
    const left = Math.min(Math.max(12, bellBox.right - parentBox.left - width + 10), parentBox.width - width - 12);
    panel.style.left = `${Math.round(left)}px`;
  }

  async function open(options = {}) {
    highlight = options.highlight || '';
    panel.hidden = false;
    place();
    bell.setAttribute('aria-expanded', 'true');
    await load();
    render();
    // 打开即视为看过；「需要你处理」仍保留，直到跳回处理或忽略。
    if (items.some((item) => !item.read)) api().readAllNotices?.()?.catch?.(() => {});
  }

  function close() {
    panel.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
    highlight = '';
  }

  bell.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panel.hidden) open();
    else close();
  });
  panel.addEventListener('click', async (event) => {
    event.stopPropagation();
    const actionButton = event.target.closest('[data-action]');
    const item = event.target.closest('.notice-item');
    if (!actionButton || !item) return;
    const action = actionButton.dataset.action;
    if (action === 'open-todo') {
      close();
      window.setActiveTab?.('todo');
      return;
    }
    actionButton.disabled = true;
    const result = await api().actOnNotice?.(item.dataset.id, action)?.catch?.(() => null);
    if (!result?.ok && action === 'open') toast('没找到对应的窗口，可能已经关掉了');
    if (result?.ok && action === 'todo-done') toast('待办已完成');
    await load();
    render();
  });
  get('notice-read-all').addEventListener('click', async () => {
    await api().readAllNotices?.()?.catch?.(() => {});
    await load();
    render();
  });
  get('notice-clear').addEventListener('click', async () => {
    await api().clearNotices?.()?.catch?.(() => {});
    await load();
    render();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target) && !bell.contains(event.target)) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) close();
  });
  document.addEventListener('notch:modechange', (event) => {
    if (!event.detail?.expanded) close();
  });

  api().onNoticesChanged?.((next) => {
    summary = next || summary;
    renderBadge();
    if (!panel.hidden) load();
  });
  load();

  window.NotchNoticeCenter = { open, close, load, state: () => ({ items: items.map((item) => ({ ...item })), summary: { ...summary } }) };
})();
