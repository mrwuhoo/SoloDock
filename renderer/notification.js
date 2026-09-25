'use strict';

// 统一提醒浮窗：从刘海长出的黑色岛屿。上半部分点击打开对应位置；下面一行是按类型给出的按钮
// （由主进程 reminder-rules.js 决定）；护眼这类安静提醒用环形倒计时代替图标、不带按钮。

const root = document.getElementById('notification-root');
const shell = document.getElementById('notification-shell');
const body = document.getElementById('notification-body');
const titleElement = document.getElementById('notification-title');
const sourceElement = document.getElementById('notification-source');
const detailElement = document.getElementById('notification-detail');
const queueElement = document.getElementById('notification-queue');
const actionsElement = document.getElementById('notification-actions');

const api = window.notchAPI;
const HIDE_FALLBACK_MS = 420;
const MAX_QUEUE_COUNT = 99;
const BASE_HEIGHT = 96;
const ACTIONS_HEIGHT = 132;

const SOURCE_NAMES = {
  codex: 'Codex',
  claude: 'Claude',
  gpt: 'GPT',
  chatgpt: 'GPT',
  task: '任务',
  todo: '待办',
  event: '日程',
  reminder: '提醒',
  pomodoro: '专注',
  'pomodoro-break': '休息',
  'focus-summary': '专注',
  sit: '久坐',
  eye: '护眼',
  offwork: '收工',
  info: 'SoloDock',
};
const GLYPHS = {
  codex: 'check',
  claude: 'spark',
  gpt: 'spark',
  chatgpt: 'spark',
  task: 'check',
  todo: 'clock',
  event: 'calendar',
  reminder: 'bell',
  pomodoro: 'timer',
  'pomodoro-break': 'leaf',
  'focus-summary': 'timer',
  sit: 'walk',
  eye: 'eye',
  offwork: 'moon',
  info: 'info',
};

let hideFallback = null;
let currentEventId = null;
let currentActions = [];
let isVisible = false;
let isHiding = false;
let isHovering = false;

function firstText(values, fallback) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return fallback;
}

function normalizeActions(value) {
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && typeof item.id === 'string' && typeof item.label === 'string')
    .slice(0, 3)
    .map((item) => ({ id: item.id, label: item.label.slice(0, 16), primary: item.primary === true }));
}

function normalizeNotification(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const stringPayload = typeof payload === 'string' ? payload : '';
  const sourceKey = firstText([data.source, data.provider, data.agent, data.app, data.type], 'task').toLowerCase();
  const project = firstText([data.project, data.projectName, data.workspace], '');
  return {
    title: firstText([data.title, data.taskTitle, data.taskName, data.name, stringPayload], '任务已完成'),
    source: SOURCE_NAMES[sourceKey] || '任务',
    detail: firstText(
      [data.detail],
      sourceKey === 'todo' ? '将在 1 小时内截止' : project ? `已完成 · ${project}` : '已完成，可以查看了'
    ),
    queueCount: readQueueCount(data.queueCount ?? data.pendingCount ?? data.pending),
    eventId: data.eventId ?? null,
    sourceKey,
    actions: normalizeActions(data.actions),
    style: data.style === 'quiet' ? 'quiet' : 'standard',
    visibleMs: Math.max(0, Number(data.visibleMs) || 0),
  };
}

function readEventId(value) {
  if (value && typeof value === 'object') return value.eventId ?? null;
  return value ?? null;
}

function readQueueCount(value) {
  const raw = Array.isArray(value)
    ? value.length
    : value && typeof value === 'object'
      ? value.queueCount ?? value.pendingCount ?? value.pending ?? value.count
      : value;
  const count = Number(raw);
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(MAX_QUEUE_COUNT, Math.floor(count));
}

function setQueueCount(value) {
  const count = readQueueCount(value);
  queueElement.textContent = `+${count}`;
  queueElement.hidden = count === 0;
  queueElement.title = count ? `还有 ${count} 条提醒` : '';
}

function clearHideFallback() {
  if (!hideFallback) return;
  clearTimeout(hideFallback);
  hideFallback = null;
}

function reportHover(hovering) {
  if (isHovering === hovering) return;
  isHovering = hovering;
  if (api && typeof api.taskNotificationHover === 'function') api.taskNotificationHover(hovering);
}

function renderActions(actions) {
  actionsElement.replaceChildren();
  actions.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `notification-action${item.primary ? ' primary' : ''}`;
    button.dataset.actionId = item.id;
    button.textContent = item.label;
    actionsElement.append(button);
  });
  if (actions.some((item) => item.primary)) {
    const hint = document.createElement('span');
    hint.className = 'notification-shortcut';
    hint.textContent = '⌃⌥↩';
    hint.title = '按 ⌃⌥↩ 执行第一个操作';
    actionsElement.append(hint);
  }
  actionsElement.hidden = actions.length === 0;
}

function showNotification(payload) {
  const notification = normalizeNotification(payload);

  clearHideFallback();
  currentEventId = notification.eventId;
  currentActions = notification.actions;
  isVisible = true;
  isHiding = false;

  titleElement.textContent = notification.title;
  sourceElement.textContent = notification.source;
  detailElement.textContent = notification.detail;
  shell.dataset.source = notification.sourceKey;
  shell.dataset.glyph = GLYPHS[notification.sourceKey] || 'check';
  shell.dataset.style = notification.style;
  shell.style.setProperty('--ring-duration', `${notification.visibleMs || 20000}ms`);
  document.documentElement.style.setProperty('--notification-height', `${notification.actions.length ? ACTIONS_HEIGHT : BASE_HEIGHT}px`);
  renderActions(notification.actions);
  setQueueCount(notification.queueCount);
  body.setAttribute('aria-label', `${notification.source}：${notification.title}`);

  root.hidden = false;
  shell.classList.remove('is-visible', 'is-hiding');
  void shell.offsetWidth;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!isVisible || isHiding) return;
      shell.classList.add('is-visible');
    });
  });
}

function finishHide() {
  if (!isHiding) return;
  clearHideFallback();
  reportHover(false);

  isVisible = false;
  isHiding = false;
  shell.classList.remove('is-visible', 'is-hiding');
  root.hidden = true;

  if (api && typeof api.taskNotificationDismissed === 'function') api.taskNotificationDismissed(currentEventId);
}

function hideNotification(eventId) {
  if (!isVisible || isHiding) return;

  const requestedEventId = readEventId(eventId);
  if (requestedEventId !== null) currentEventId = requestedEventId;
  isHiding = true;
  reportHover(false);

  shell.classList.remove('is-visible');
  shell.classList.add('is-hiding');
  hideFallback = setTimeout(finishHide, HIDE_FALLBACK_MS);
}

function subscribe(method, callback) {
  if (!api || typeof api[method] !== 'function') return;
  api[method](callback);
}

async function runAction(actionId) {
  if (!actionId || !currentEventId || !api?.taskNotificationAction) return;
  actionsElement.querySelectorAll('button').forEach((button) => { button.disabled = true; });
  try { await api.taskNotificationAction(currentEventId, actionId); } catch (error) {}
}

shell.addEventListener('pointerenter', () => reportHover(true));
shell.addEventListener('pointerleave', () => reportHover(false));
actionsElement.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action-id]');
  if (button) runAction(button.dataset.actionId);
});
// 点正文：AI 提醒跳回对应窗口；待办打开待办页；其他收起。
body.addEventListener('click', async () => {
  if (currentActions.some((item) => item.id === 'open-todo')) {
    runAction('open-todo');
    return;
  }
  if (currentActions.some((item) => item.id === 'open') && api && typeof api.activateTaskNotification === 'function') {
    try { await api.activateTaskNotification(currentEventId); } catch (error) {}
  }
  hideNotification(currentEventId);
});
shell.addEventListener('transitionend', (event) => {
  if (event.target !== shell || event.propertyName !== 'clip-path') return;
  if (isHiding) finishHide();
});

window.addEventListener('blur', () => reportHover(false));
window.addEventListener('beforeunload', () => reportHover(false));

subscribe('onTaskNotification', showNotification);
subscribe('onTaskNotificationQueue', setQueueCount);
subscribe('onTaskNotificationHide', hideNotification);

window.NotchNotification = { show: showNotification, hide: hideNotification };
