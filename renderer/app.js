const app = document.getElementById('app');
const notch = document.getElementById('notch');
const panel = document.getElementById('panel');
const statusToast = document.getElementById('status-toast');
const statusToastMessage = document.getElementById('status-toast-message');
const statusToastAction = document.getElementById('status-toast-action');

function collectLocalStorageSnapshot() {
  const result = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) result[key] = localStorage.getItem(key);
  }
  return result;
}

let workspaceReloadPending = false;
async function hydratePortableWorkspace() {
  if (!window.notchAPI?.loadWorkspaceData) return;
  try {
    const snapshot = await window.notchAPI.loadWorkspaceData();
    let imported = false;
    if (sessionStorage.getItem('notch-workspace-hydrated') !== '1' && snapshot && typeof snapshot === 'object') {
      Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string' && localStorage.getItem(key) === null) {
          localStorage.setItem(key, value);
          imported = true;
        }
      });
      sessionStorage.setItem('notch-workspace-hydrated', '1');
    }
    if (imported) {
      // The current editors were initialized before the asynchronous import.
      // Their unload/visibility handlers must not overwrite recovered values.
      workspaceReloadPending = true;
      location.reload();
      return;
    }
    setInterval(() => window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).catch(() => {}), 2000);
  } catch (error) {}
}
// Do not interrupt parser-loaded workspace scripts with a recovery navigation.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydratePortableWorkspace, { once: true });
} else {
  hydratePortableWorkspace();
}
window.notchAPI?.onWorkspaceChanged?.(() => {
  sessionStorage.removeItem('notch-workspace-hydrated');
  window.notchAPI.saveWorkspaceData(collectLocalStorageSnapshot()).finally(() => location.reload());
});

let statusToastTimer = null;
let statusToastHideTimer = null;
let statusToastActionHandler = null;
let statusToastExpireHandler = null;

function dismissStatusToast(commitPending = true) {
  if (statusToastTimer) clearTimeout(statusToastTimer);
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastTimer = null;
  statusToastHideTimer = null;
  const onExpire = statusToastExpireHandler;
  statusToastExpireHandler = null;
  statusToastActionHandler = null;
  const actionHadFocus = statusToastAction === document.activeElement;
  if (actionHadFocus) {
    const activeTabButton = document.querySelector('.tab.active');
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  if (statusToast) {
    statusToast.classList.remove('visible');
    statusToast.setAttribute('aria-hidden', 'true');
  }
  if (statusToastAction) statusToastAction.hidden = true;
  statusToastHideTimer = setTimeout(() => {
    statusToastHideTimer = null;
    if (statusToast) statusToast.hidden = true;
    if (statusToastMessage) statusToastMessage.textContent = '';
  }, 180);
  if (commitPending && onExpire) onExpire();
}

function showStatusToast(message, options = {}) {
  dismissStatusToast(true);
  if (!statusToast || !statusToastMessage) return;
  const { actionLabel, onAction, onExpire, duration = 1800 } = options;
  if (statusToastHideTimer) clearTimeout(statusToastHideTimer);
  statusToastHideTimer = null;
  statusToast.hidden = false;
  statusToast.setAttribute('aria-hidden', 'false');
  statusToastMessage.textContent = message;
  statusToastActionHandler = typeof onAction === 'function' ? onAction : null;
  statusToastExpireHandler = typeof onExpire === 'function' ? onExpire : null;
  if (statusToastAction && statusToastActionHandler) {
    statusToastAction.textContent = actionLabel || '撤销';
    statusToastAction.hidden = false;
  }
  statusToast.classList.add('visible');
  statusToastTimer = setTimeout(() => dismissStatusToast(true), duration);
}

if (statusToastAction) {
  statusToastAction.addEventListener('click', () => {
    const handler = statusToastActionHandler;
    dismissStatusToast(false);
    if (handler) handler();
  });
}

window.addEventListener('beforeunload', () => dismissStatusToast(true));

// 待办的数据、页面与提醒都在 todo-page.js（window.NotchTodos）。

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 首页「今天」的时间标签每分钟刷新一次。
setInterval(() => renderTodayCard(), 60_000);
document.addEventListener('notch:todos-changed', () => renderTodayCard());

// ============ 首页 · 今天 ============
// 今天到期和已逾期的待办。勾选即完成（可撤销），点击文字跳到待办页的那一条。
function renderTodayCard() {
  const homeTodayList = document.getElementById('home-today-list');
  const homeTodaySummary = document.getElementById('home-today-summary');
  const todos = window.NotchTodos;
  if (!homeTodayList || !todos) return;
  const categories = todos.categories();
  const items = window.NotchDomain.todayTodoItems(todos.items(), Date.now(), categories.map((category) => category.id));
  const doingId = todos.doing()?.id || '';
  const overdue = items.filter((item) => item.overdue).length;
  if (homeTodaySummary) {
    homeTodaySummary.textContent = items.length
      ? `${items.length} 项${overdue ? ` · ${overdue} 项逾期` : ''}`
      : '';
  }
  homeTodayList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('li');
    empty.className = 'today-empty';
    empty.textContent = '今天没有到期的待办';
    homeTodayList.append(empty);
    return;
  }
  // 卡片不滚动：只放得下的行数；放不下时最后一行换成「还有 N 项」。
  const ROW_HEIGHT = 34;
  const capacity = homeTodayList.clientHeight > 0
    ? Math.max(1, Math.floor(homeTodayList.clientHeight / ROW_HEIGHT))
    : items.length;
  const shown = items.length > capacity ? items.slice(0, Math.max(0, capacity - 1)) : items;
  shown.forEach((item) => {
    const row = document.createElement('li');
    row.className = `today-item${item.id === doingId ? ' doing' : ''}`;
    row.dataset.id = item.id;
    row.dataset.color = todos.categoryColor(item.priority);
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'today-check';
    check.dataset.action = 'complete';
    check.setAttribute('aria-label', `完成「${item.text}」`);
    const text = document.createElement('button');
    text.type = 'button';
    text.className = 'today-text';
    text.dataset.action = 'open';
    text.textContent = item.text;
    text.title = `${todos.categoryName(item.priority)} · ${item.text}`;
    row.append(check, text);
    if (item.id === doingId) {
      const chip = document.createElement('span');
      chip.className = 'today-doing';
      chip.textContent = '在做';
      row.append(chip);
    }
    const time = document.createElement('span');
    time.className = `today-time${item.label.tone ? ` ${item.label.tone}` : ''}`;
    time.textContent = item.label.text;
    row.append(time);
    homeTodayList.append(row);
  });
  if (shown.length < items.length) {
    const more = document.createElement('li');
    more.className = 'today-more';
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = 'more';
    button.textContent = `还有 ${items.length - shown.length} 项 ›`;
    more.append(button);
    homeTodayList.append(more);
  }
}

// 卡片尺寸随首页布局变化时，重新计算能放下几行。
if (window.ResizeObserver && document.getElementById('home-today-list')) {
  let lastTodayListHeight = -1;
  new ResizeObserver(([entry]) => {
    const height = Math.round(entry.contentRect.height);
    if (height === lastTodayListHeight) return;
    lastTodayListHeight = height;
    renderTodayCard();
  }).observe(document.getElementById('home-today-list'));
}

document.getElementById('home-today-list')?.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'more') {
    setActiveTab('todo');
    return;
  }
  const row = event.target.closest('.today-item');
  if (!action || !row) return;
  const { id } = row.dataset;
  if (action === 'complete') {
    const item = window.NotchTodos?.list().find((todo) => todo.id === id);
    if (!item || item.done) return;
    const result = window.NotchTodos.complete(id);
    if (!result) return;
    showStatusToast(`已完成「${item.text}」`, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => window.NotchTodos.reopen(result.id, result.spawnedId),
    });
    return;
  }
  window.NotchTodos?.focus(id);
});
document.getElementById('home-today-all')?.addEventListener('click', () => setActiveTab('todo'));

let isExpanded = false;
let modeBusy = false;
let pendingMode = null;
let restoreNotchFocusAfterCollapse = false;
// 从折叠态展开的瞬间置 true，岛体落定后自动清除；
// setActiveTab 读取此标志决定是否延后重活，已展开态切 Tab 不受影响。
let _justExpanded = false;

const PANEL_MOTION_FALLBACK_MS = 440;
const OPENING_SETTLE_MS = 360;
const HEAVY_LOAD_AFTER_OPEN_MS = 360;

function nextAnimationFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function waitForPanelMotion() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      panel.removeEventListener('transitionend', onEnd);
      resolve();
    };
    const onEnd = (event) => {
      if (
        event.target === panel &&
        event.propertyName === 'opacity' &&
        event.pseudoElement === '::before'
      ) {
        finish();
      }
    };
    const timer = setTimeout(finish, PANEL_MOTION_FALLBACK_MS);
    panel.addEventListener('transitionend', onEnd);
  });
}

async function ipcSetMode(mode) {
  if (!window.notchAPI || typeof window.notchAPI.setMode !== 'function') return;
  try {
    await window.notchAPI.setMode(mode);
  } catch (e) {
    // ignore
  }
}

async function ipcBeginCollapse() {
  if (!window.notchAPI || typeof window.notchAPI.beginCollapse !== 'function') return;
  try {
    await window.notchAPI.beginCollapse();
  } catch (e) {
    // ignore
  }
}

function syncPanelAccessibility(expanded) {
  const focusWasInPanel = !!(panel && panel.contains(document.activeElement));
  if (!expanded) {
    restoreNotchFocusAfterCollapse = document.hasFocus();
    if (focusWasInPanel) document.activeElement.blur();
  } else {
    restoreNotchFocusAfterCollapse = false;
  }
  if (panel) {
    panel.inert = !expanded;
    panel.setAttribute('aria-hidden', String(!expanded));
  }
  if (!notch) return;
  notch.setAttribute('aria-expanded', String(expanded));
  notch.setAttribute('aria-label', expanded ? '收起 SoloDock' : '展开 SoloDock');
  if (expanded && document.activeElement === notch) {
    const activeTabButton = document.querySelector(`.tab[data-tab="${activeTab}"]`);
    if (activeTabButton) activeTabButton.focus({ preventScroll: true });
  }
  notch.setAttribute('aria-hidden', String(expanded));
  notch.tabIndex = expanded ? -1 : 0;
}

// 原生窗口只提供动画需要的透明画布；用户看到的黑色岛体由 CSS 连续形变。
// 收起必须等岛体退场完成后再缩原生窗口，避免最后一帧被裁掉。
async function setMode(expanded) {
  if (modeBusy) {
    pendingMode = expanded;
    return;
  }
  if (expanded === isExpanded) return;
  modeBusy = true;
  isExpanded = expanded;
  try {
    if (expanded) {
      // 每次召回使用设置中的默认页，不沿用上次收起时的停留页。
      _justExpanded = true;
      setTimeout(() => {
        _justExpanded = false;
      }, OPENING_SETTLE_MS);
      const openingTab = window.NotchDomain.resolveDefaultPanelTab(defaultOpenTab, TABS);
      if (activeTab !== openingTab) await setActiveTab(openingTab);
      else applyTabDom(openingTab);
      syncPanelAccessibility(true);
      app.classList.remove('collapsed', 'closing');
      app.classList.add('opening');
      void panel.offsetWidth;
      // offsetWidth 只强制布局，不强制绘制；而 rAF 回调发生在绘制之前。
      // 必须等两帧、确认 .opening 的透明折叠条真的进了合成器，再让主进程放大窗口，
      // 否则放大时被钉在新原点上的仍是那条黑色折叠条（菜单栏黑块闪烁的成因）。
      await nextAnimationFrame();
      await nextAnimationFrame();
      await ipcSetMode('expanded');
      await nextAnimationFrame();
      await nextAnimationFrame();
      app.classList.remove('opening');
      app.classList.add('expanded');
      // 展开后面板从隐藏变为可见，tab 尺寸此时才可量：先判断是否要切成图标模式，再校准激活胶囊
      requestAnimationFrame(() => requestAnimationFrame(fitTabsToPanel));
      setTimeout(() => {
        if (!isExpanded) return;
        if (activeTab === 'clip') renderClipList();
      }, HEAVY_LOAD_AFTER_OPEN_MS);
    } else {
      const motion = waitForPanelMotion();
      syncPanelAccessibility(false);
      await ipcBeginCollapse();
      app.classList.add('closing');
      await nextAnimationFrame();
      await motion;
      await nextAnimationFrame();
      await nextAnimationFrame();
      await ipcSetMode('collapsed');
      app.classList.remove('expanded', 'closing', 'opening');
      app.classList.add('collapsed');
      if (restoreNotchFocusAfterCollapse && document.hasFocus() && notch) {
        notch.focus({ preventScroll: true });
      }
      restoreNotchFocusAfterCollapse = false;
    }
    document.dispatchEvent(new CustomEvent('notch:modechange', {
      detail: { expanded: isExpanded },
    }));
  } finally {
    modeBusy = false;
    if (pendingMode !== null) {
      const nextMode = pendingMode;
      pendingMode = null;
      if (nextMode !== isExpanded) setMode(nextMode);
    }
  }
}

notch.addEventListener('click', (e) => {
  e.stopPropagation();
  setMode(!isExpanded);
});

notch.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  setMode(!isExpanded);
});

document.addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const editable = Boolean(target && target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), audio, video'
  ));
  if (!window.NotchDomain.shouldTogglePanelForSpace({
    key: event.key,
    code: event.code,
    repeat: event.repeat,
    isComposing: event.isComposing,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    editable,
  })) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setMode(!isExpanded);
}, true);

syncPanelAccessibility(false);

panel.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Esc 收起面板（菜单栏会拦截顶部刘海条的点击，给收起多一条可靠路径）；
// 焦点在输入框/速记里时，第一次 Esc 只退出输入。
// Escape 不会原生到达页面（被浏览器层吞掉），由主进程 before-input-event 转发
if (window.notchAPI && typeof window.notchAPI.onEscape === 'function') {
  window.notchAPI.onEscape(() => {
    // 浮层（⌘K 搜索等）先关自己，不收起面板。
    if (window.NotchPalette?.close?.()) return;
    if (window.NotchTodoPage?.escape?.()) return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      el.blur();
      return;
    }
    if (document.querySelector('.multi-selected')) {
      document.dispatchEvent(new CustomEvent('notch:clear-selection'));
      return;
    }
    if (isExpanded) setMode(false);
  });
}

if (window.notchAPI && typeof window.notchAPI.onToggleShortcut === 'function') {
  window.notchAPI.onToggleShortcut(() => setMode(!isExpanded));
}

// 失焦与点击收起共用同一个状态机，保证退场节奏一致。
if (window.notchAPI && typeof window.notchAPI.onCollapseRequest === 'function') {
  window.notchAPI.onCollapseRequest(() => {
    if (isExpanded) setMode(false);
  });
}

// 全局快捷键召唤也走同一套 Tab 与展开状态机，避免出现另一种突兀的入场路径。
if (window.notchAPI && typeof window.notchAPI.onOpenClip === 'function') {
  window.notchAPI.onOpenClip(async () => {
    await setActiveTab('clip');
    if (!isExpanded) await setMode(true);
  });
}

// 布局度量（主进程按屏计算下发）：折叠条高 / 菜单栏占位高 / 各 Tab 目标尺寸
let layoutMetrics = null;

function applyLayoutMetrics(metrics) {
  if (!metrics) return;
  layoutMetrics = metrics;
  if (metrics.stripHeight) {
    document.documentElement.style.setProperty('--notch-h', `${metrics.stripHeight}px`);
  }
  if (metrics.menuBarHeight) {
    document.documentElement.style.setProperty('--mb-h', `${metrics.menuBarHeight}px`);
  }
}

if (window.notchAPI && typeof window.notchAPI.getMetrics === 'function') {
  window.notchAPI
    .getMetrics()
    .then(applyLayoutMetrics)
    .catch(() => {});
}

if (window.notchAPI && typeof window.notchAPI.onMetricsChanged === 'function') {
  window.notchAPI.onMetricsChanged(applyLayoutMetrics);
}

// ============ Tab 切换 ============
const TAB_KEY = 'notch-active-tab';
// 左组（刘海左侧）：天天用的页面；右组（刘海右侧）：录制、可选页面与设置。
const ALL_TABS = ['home', 'todo', 'notes', 'links', 'clip', 'credentials', 'time', 'recordings', 'resets', 'life', 'settings'];
let TABS = ALL_TABS.filter((name) => name !== 'clip');
let tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));
const tabIndicator = document.getElementById('tab-indicator');
const collapseBtn = document.getElementById('collapse-btn');

let activeTab = 'home';
let defaultOpenTab = 'home';

function applyFeatureSettings(settings) {
  const features = { ...(settings && settings.features || {}), home: true, settings: true };
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    const enabled = button.dataset.tab === 'home'
      || button.dataset.tab === 'settings'
      || features[button.dataset.tab] !== false;
    button.hidden = !enabled;
    button.setAttribute('aria-hidden', String(!enabled));
  });
  TABS = window.NotchDomain.visiblePanelTabs(ALL_TABS, features);
  defaultOpenTab = window.NotchDomain.resolveDefaultPanelTab(settings?.defaultTab, TABS);
  tabButtons = Array.from(document.querySelectorAll('.tab:not([hidden])'));
  document.querySelectorAll('.tab-group').forEach((group) => {
    group.hidden = !group.querySelector('.tab:not([hidden])');
  });
  if (!TABS.includes(activeTab)) setActiveTab('home');
  requestAnimationFrame(fitTabsToPanel);
}

// 两组页签各自只能用到刘海一侧的宽度；放不下时整体切成只显示图标，
// 而不是让某一组越过刘海。
function fitTabsToPanel() {
  const tabs = document.getElementById('tabs');
  if (!tabs) return;
  tabs.classList.remove('is-compact');
  const sideWidth = (tabs.clientWidth - 224) / 2;
  const overflowing = [...tabs.querySelectorAll('.tab-group:not([hidden])')]
    .some((group) => group.scrollWidth > sideWidth + 0.5);
  tabs.classList.toggle('is-compact', overflowing);
  positionIndicator();
}

window.addEventListener('resize', () => requestAnimationFrame(fitTabsToPanel));

if (window.notchAPI?.getAppSettings) {
  window.notchAPI.getAppSettings().then(applyFeatureSettings).catch(() => {});
  window.notchAPI.onAppSettingsChanged?.(applyFeatureSettings);
}

function positionIndicator() {
  const btn = tabButtons.find((b) => b.dataset.tab === activeTab);
  if (!btn || !tabIndicator) return;
  // 页签分在两个定位的组里，offsetLeft 只相对各自的组，所以按 #tabs 的矩形换算。
  const container = tabIndicator.offsetParent || tabIndicator.parentElement;
  const origin = container.getBoundingClientRect();
  const rect = btn.getBoundingClientRect();
  if (!rect.width) return;
  tabIndicator.style.width = `${rect.width}px`;
  tabIndicator.style.height = `${rect.height}px`;
  tabIndicator.style.transform = `translate(${rect.left - origin.left}px, ${rect.top - origin.top}px)`;
}

function applyTabDom(name) {
  tabButtons.forEach((b) => {
    const selected = b.dataset.tab === name;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-selected', String(selected));
    b.tabIndex = selected ? 0 : -1;
  });
  tabPanels.forEach((p) => {
    const selected = p.id === `tab-${name}`;
    p.classList.toggle('active', selected);
    p.inert = !selected;
    p.setAttribute('aria-hidden', String(!selected));
  });
  positionIndicator();
  requestAnimationFrame(() => requestAnimationFrame(positionIndicator));
  document.dispatchEvent(new CustomEvent('notch:tabchange', { detail: { tab: name } }));
}

async function ipcSetTab(name) {
  if (!window.notchAPI || typeof window.notchAPI.setTab !== 'function') return;
  try {
    await window.notchAPI.setTab(name);
  } catch (e) {
    // ignore
  }
}

// 固定展开尺寸下，Tab 只切换内容与指示器，不再改变原生窗口边界。
async function morphToTab(name) {
  await ipcSetTab(name);
  applyTabDom(name);
  positionIndicator();
}

let tabBusy = false;
let pendingTab = null;

async function setActiveTab(name) {
  if (!TABS.includes(name)) name = 'home';
  if (tabBusy) {
    pendingTab = name; // 补间中连点：记住最后目标，结束后追赶
    return;
  }
  if (name === activeTab) {
    applyTabDom(name);
    return;
  }
  tabBusy = true;
  activeTab = name;
  try {
    // 图片预加载等重活的调度策略：
    //   - 已展开态切 Tab：_justExpanded=false → 立即执行，保持即时响应
    //   - 从折叠态展开（_justExpanded=true）：延后到展开动画基本落定后再跑，
    //     避免与面板 scale 手势争首帧 CPU/GPU，消除展开卡顿
    // renderClipList 延后只是缩略图晚一点出现，可接受。
    const _tabNameForDeferred = name; // 闭包捕获当前目标 Tab
    const runHeavyLoads = () => {
      if (_tabNameForDeferred === 'clip') renderClipList();
      if (_tabNameForDeferred === 'notes') window.NotchNotes?.refresh?.();
    };
    if (_justExpanded) {
      // 双帧后再延迟重活，让岛体形变先完成，避免抢首帧 CPU/GPU。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTimeout(runHeavyLoads, HEAVY_LOAD_AFTER_OPEN_MS))
      );
    } else {
      // 已展开态切 Tab：立即执行，无感知延迟
      runHeavyLoads();
    }
    if (isExpanded) {
      await morphToTab(name);
    } else {
      // 折叠态只记录目标尺寸（主进程不变形），展开时一步到位
      await ipcSetTab(name);
      applyTabDom(name);
    }
    try {
      localStorage.setItem(TAB_KEY, name);
    } catch (e) {
      // ignore quota errors
    }
  } finally {
    tabBusy = false;
    if (pendingTab && pendingTab !== activeTab) {
      const next = pendingTab;
      pendingTab = null;
      setActiveTab(next);
    } else {
      pendingTab = null;
    }
  }
}

// 胶囊滑动结束后兜底再校准一次（窗口变形期间布局可能回流）
if (tabIndicator) {
  tabIndicator.addEventListener('transitionend', positionIndicator);
}

Array.from(document.querySelectorAll('.tab[data-tab]')).forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setActiveTab(btn.dataset.tab);
  });
  btn.addEventListener('keydown', (e) => {
    const currentIndex = tabButtons.indexOf(btn);
    let nextIndex = null;
    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabButtons.length;
    if (e.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + tabButtons.length) % tabButtons.length;
    }
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = tabButtons.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextButton = tabButtons[nextIndex];
    nextButton.focus({ preventScroll: true });
    setActiveTab(nextButton.dataset.tab);
  });
});

// 托盘里的“设置快捷键…”会把设置入口以内联浮层放到面板中。
// 这里绑定所有 Tab（包括启动时隐藏的剪贴板），避免功能启用后按钮仍没有事件。
const shortcutRecorder = document.getElementById('shortcut-recorder');
const shortcutRecorderValue = document.getElementById('shortcut-recorder-value');
const shortcutRecorderCancel = document.getElementById('shortcut-recorder-cancel');
const shortcutRecorderTitle = document.getElementById('shortcut-recorder-title');
const shortcutRecorderHint = document.getElementById('shortcut-recorder-hint');
let shortcutRecorderActive = false;
// 'panel'：唤出面板；'capture'：随手记（不能用空格，⌫ 关闭）。
let shortcutRecorderTarget = 'panel';
const SHORTCUT_ERRORS = {
  occupied: '该快捷键已被占用',
  'same-as-panel': '和唤出快捷键重复了',
  'same-as-capture': '和随手记快捷键重复了',
};

function closeShortcutRecorder() {
  shortcutRecorderActive = false;
  if (shortcutRecorder) shortcutRecorder.hidden = true;
}

function keyEventToAccelerator(event) {
  const keyAliases = {
    ' ': 'Space', Spacebar: 'Space', Escape: 'Escape', Esc: 'Escape',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  };
  let key = keyAliases[event.key] || event.key;
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (!/^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Escape|Left|Right|Up|Down|Home|End|PageUp|PageDown|Backspace|Delete|Enter)$/.test(key)) return '';
  const parts = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

shortcutRecorder?.addEventListener('keydown', async (event) => {
  if (!shortcutRecorderActive) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    closeShortcutRecorder();
    return;
  }
  const capture = shortcutRecorderTarget === 'capture';
  if (capture && ['Backspace', 'Delete'].includes(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    const off = await window.notchAPI?.setCaptureShortcut?.('').catch(() => ({ ok: false }));
    if (off?.ok) {
      showStatusToast('随手记快捷键已关闭');
      setTimeout(closeShortcutRecorder, 420);
    }
    return;
  }
  const accelerator = keyEventToAccelerator(event);
  if (!accelerator) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = '请按下完整按键组合';
    return;
  }
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (bare && (capture || accelerator !== 'Space')) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = capture ? '请搭配 ⌥ / ⌃ / ⇧ / ⌘' : '单键仅支持空格';
    return;
  }
  const label = capture ? window.NotchCapture?.shortcutLabel?.(accelerator) || accelerator : accelerator;
  if (shortcutRecorderValue) shortcutRecorderValue.textContent = label;
  const result = await (capture
    ? window.notchAPI?.setCaptureShortcut?.(accelerator)
    : window.notchAPI?.setPanelShortcut?.(accelerator))?.catch?.(() => ({ ok: false }));
  if (!result?.ok) {
    if (shortcutRecorderValue) shortcutRecorderValue.textContent = SHORTCUT_ERRORS[result?.error] || '无法使用该快捷键';
    return;
  }
  showStatusToast(capture ? `随手记快捷键已设为 ${label}` : `快捷键已设为 ${accelerator}`);
  setTimeout(closeShortcutRecorder, 420);
});

shortcutRecorderCancel?.addEventListener('click', closeShortcutRecorder);
function openShortcutRecorder(event) {
  if (!isExpanded) setMode(true);
  shortcutRecorderTarget = event?.detail?.target === 'capture' ? 'capture' : 'panel';
  const capture = shortcutRecorderTarget === 'capture';
  if (shortcutRecorderTitle) shortcutRecorderTitle.textContent = capture ? '按下新的随手记快捷键' : '按下新的唤出快捷键';
  if (shortcutRecorderHint) shortcutRecorderHint.textContent = capture ? '搭配 ⌥ / ⌃ / ⇧ / ⌘；按 ⌫ 关闭随手记快捷键' : '可直接使用空格；其他按键建议搭配 ⌘ / ⌥ / ⌃ / ⇧';
  shortcutRecorderActive = true;
  shortcutRecorder.hidden = false;
  shortcutRecorderValue.textContent = '等待输入…';
  requestAnimationFrame(() => shortcutRecorder.focus({ preventScroll: true }));
}
window.notchAPI?.onRecordShortcut?.(() => openShortcutRecorder());
document.addEventListener('notch:record-shortcut', openShortcutRecorder);

if (collapseBtn) {
  collapseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    setMode(false);
  });
}

// 顶栏空白处点按收起——黑条在展开态已退场，由顶栏接替这一角色。
// 排除交互区（Tab / 按钮 / 输入 / 搜索框），品牌区与空白处都可收起（明确的收起热区）。
// 注意：home/todo 下搜索框隐藏会让 .topbar-mid 高度塌成 0，点击其实落在 .topbar 上，
// 所以必须挂在 .topbar 上并用 closest 排除，不能只认 .topbar-mid 本体。
const topbarEl = document.querySelector('.topbar');
if (topbarEl) {
  topbarEl.addEventListener('click', (e) => {
    if (e.target.closest('.tabs, button, input, .notice-center')) return;
    e.stopPropagation();
    setMode(false);
  });
}

function initTab() {
  setActiveTab('home');
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

// ============ 首页 · 番茄钟 ============
const pomodoroToggle = document.getElementById('pomodoro-toggle');
const pomodoroReset = document.getElementById('pomodoro-reset');
const homePomodoro = document.getElementById('home-pomodoro');
const pomodoroEndTime = document.getElementById('pomodoro-end-time');
const pomodoroInputs = [
  document.getElementById('pomodoro-minutes'),
  document.getElementById('pomodoro-seconds'),
];
const POMODORO_DURATION_KEY = 'dynamic-panel-pomodoro-duration-v3';
let savedPomodoroParts = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(POMODORO_DURATION_KEY) || 'null');
    if (Array.isArray(value) && value.length === 3) {
      return [
        Math.max(0, Math.min(60, (Number(value[0]) || 0) * 60 + (Number(value[1]) || 0))),
        Math.max(0, Math.min(60, Number(value[2]) || 0)),
      ];
    }
    if (Array.isArray(value) && value.length === 2) {
      return value.map((part) => Math.max(0, Math.min(60, Number(part) || 0)));
    }
  } catch (error) {}
  return [5, 0];
})();
let pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
let pomodoroRemaining = pomodoroConfiguredSeconds;
let pomodoroRunning = false;
let pomodoroStarted = false;
let pomodoroTimer = null;
// 专注（计入专注记录）或休息（提醒浮窗里的「休息 5 分钟」，不计入）。
let pomodoroMode = 'focus';
let pomodoroSessionSeconds = pomodoroConfiguredSeconds;
const pomodoroCaption = homePomodoro?.querySelector('.pomodoro-caption');

function secondsToParts(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.min(60, Math.floor(safe / 60)), safe % 60];
}

function setPomodoroInputs(parts) {
  pomodoroInputs.forEach((input, index) => {
    if (!input) return;
    input.value = String(parts[index]).padStart(2, '0');
    input.readOnly = pomodoroRunning;
  });
}

function formatPomodoroEndTime(seconds) {
  const target = new Date(Date.now() + Math.max(0, seconds) * 1000);
  return `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
}

// 完成的专注时段记在本机，供首页时间线和之后的「时间」页使用（只保留最近 500 条）。
const FOCUS_LOG_KEY = 'notch-focus-log-v1';
function recordFocusSession(seconds) {
  const end = Date.now();
  const minutes = Math.max(1, Math.round(Number(seconds) / 60));
  try {
    const log = JSON.parse(localStorage.getItem(FOCUS_LOG_KEY) || '[]');
    const next = [...(Array.isArray(log) ? log : []), { start: end - minutes * 60000, end, minutes }].slice(-500);
    localStorage.setItem(FOCUS_LOG_KEY, JSON.stringify(next));
  } catch (error) {
    // 存储不可用时只影响统计，不影响计时本身。
  }
  document.dispatchEvent(new CustomEvent('notch:focus-logged'));
}

function renderPomodoro() {
  setPomodoroInputs(pomodoroStarted ? secondsToParts(pomodoroRemaining) : savedPomodoroParts);
  if (pomodoroEndTime) {
    pomodoroEndTime.textContent = formatPomodoroEndTime(pomodoroStarted ? pomodoroRemaining : pomodoroConfiguredSeconds);
  }
  const remainingRatio = pomodoroStarted
    ? pomodoroRemaining / Math.max(1, pomodoroSessionSeconds)
    : 1;
  homePomodoro?.style.setProperty('--pomodoro-progress', String(Math.max(0, Math.min(1, remainingRatio))));
  if (pomodoroToggle) {
    pomodoroToggle.innerHTML = pomodoroRunning
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7h3v10H8zM14 7h3v10h-3z" /></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5z" /></svg>';
    pomodoroToggle.setAttribute('aria-label', pomodoroRunning ? '暂停番茄钟' : '开始番茄钟');
  }
  if (pomodoroReset) pomodoroReset.hidden = !pomodoroStarted;
  homePomodoro?.setAttribute('data-state', pomodoroRunning ? 'running' : (pomodoroStarted ? 'paused' : 'idle'));
  homePomodoro?.setAttribute('data-mode', pomodoroStarted ? pomodoroMode : 'focus');
  if (pomodoroCaption) pomodoroCaption.textContent = pomodoroStarted && pomodoroMode === 'break' ? '休息中' : 'Timer';
}

// 告诉主进程是否在专注：专注期间 AI 完成提醒只计数，身体提醒延后。
function reportFocusState() {
  window.notchAPI?.setFocusState?.({
    running: pomodoroRunning,
    mode: pomodoroMode,
    endsAt: pomodoroRunning ? Date.now() + pomodoroRemaining * 1000 : 0,
  });
}

function stopPomodoroTimer() {
  clearInterval(pomodoroTimer);
  pomodoroTimer = null;
}

function finishPomodoroSession() {
  const mode = pomodoroMode;
  const seconds = pomodoroSessionSeconds;
  const minutes = Math.max(1, Math.round(seconds / 60));
  stopPomodoroTimer();
  pomodoroRunning = false;
  pomodoroStarted = false;
  pomodoroMode = 'focus';
  pomodoroSessionSeconds = pomodoroConfiguredSeconds;
  pomodoroRemaining = pomodoroConfiguredSeconds;
  if (mode === 'focus') {
    showStatusToast(`${minutes} 分钟专注完成`);
    recordFocusSession(seconds);
  } else {
    showStatusToast('休息结束');
  }
  window.notchAPI?.notifyPomodoro?.({ minutes, mode }).catch(() => {});
  reportFocusState();
}

function runPomodoroTimer() {
  stopPomodoroTimer();
  pomodoroTimer = setInterval(() => {
    pomodoroRemaining -= 1;
    if (pomodoroRemaining <= 0) finishPomodoroSession();
    renderPomodoro();
  }, 1000);
}

// 从提醒浮窗开始一段专注或休息（例如「休息 5 分钟」「再专注 5 分钟」）。
function startPomodoroSession(seconds, mode) {
  const safeSeconds = Math.max(1, Math.round(Number(seconds) || 0));
  pomodoroMode = mode === 'break' ? 'break' : 'focus';
  pomodoroSessionSeconds = safeSeconds;
  pomodoroRemaining = safeSeconds;
  pomodoroStarted = true;
  pomodoroRunning = true;
  runPomodoroTimer();
  renderPomodoro();
  reportFocusState();
}

function commitPomodoroInputs() {
  if (pomodoroRunning) return;
  savedPomodoroParts = pomodoroInputs.map((input) => Math.max(0, Math.min(60, Number.parseInt(input?.value || '0', 10) || 0)));
  pomodoroConfiguredSeconds = savedPomodoroParts[0] * 60 + savedPomodoroParts[1];
  pomodoroRemaining = pomodoroConfiguredSeconds;
  pomodoroSessionSeconds = pomodoroConfiguredSeconds;
  pomodoroMode = 'focus';
  pomodoroStarted = false;
  localStorage.setItem(POMODORO_DURATION_KEY, JSON.stringify(savedPomodoroParts));
  renderPomodoro();
}

pomodoroInputs.forEach((input) => {
  if (!input) return;
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '').slice(0, 2);
  });
  input.addEventListener('blur', commitPomodoroInputs);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitPomodoroInputs();
      input.blur();
    }
  });
  input.addEventListener('wheel', (event) => {
    if (pomodoroRunning) return;
    event.preventDefault();
    const current = Number.parseInt(input.value || '0', 10) || 0;
    input.value = String(Math.max(0, Math.min(60, current + (event.deltaY < 0 ? 1 : -1)))).padStart(2, '0');
    commitPomodoroInputs();
    input.focus({ preventScroll: true });
    input.select();
  }, { passive: false });
});

pomodoroToggle?.addEventListener('click', () => {
  if (!pomodoroStarted) {
    commitPomodoroInputs();
    if (pomodoroConfiguredSeconds <= 0) {
      showStatusToast('请先设置倒计时时间');
      return;
    }
    startPomodoroSession(pomodoroConfiguredSeconds, 'focus');
    return;
  }
  pomodoroRunning = !pomodoroRunning;
  if (pomodoroRunning) runPomodoroTimer();
  else stopPomodoroTimer();
  renderPomodoro();
  reportFocusState();
});

pomodoroReset?.addEventListener('click', () => {
  stopPomodoroTimer();
  pomodoroRunning = false;
  pomodoroStarted = false;
  pomodoroMode = 'focus';
  pomodoroSessionSeconds = pomodoroConfiguredSeconds;
  pomodoroRemaining = pomodoroConfiguredSeconds;
  renderPomodoro();
  reportFocusState();
});
renderPomodoro();

// ============ 提醒浮窗的按钮动作 ============
function completeTodoById(id) {
  return Boolean(window.NotchTodos?.complete(id));
}

// 「待办挪到明天」：今天到期和已经逾期、还没完成的待办，截止时间改到明天的同一钟点。
function moveDueTodosToTomorrow(now = Date.now()) {
  return window.NotchTodos?.moveDueToTomorrow(now) || 0;
}

window.notchAPI?.onReminderAction?.((payload) => {
  const action = payload?.action;
  if (action === 'break-5') startPomodoroSession(5 * 60, 'break');
  else if (action === 'focus-5') startPomodoroSession(5 * 60, 'focus');
  else if (action === 'focus-again') startPomodoroSession(pomodoroConfiguredSeconds || 25 * 60, 'focus');
  else if (action === 'todo-done') completeTodoById(String(payload.taskId || ''));
  else if (action === 'move-tomorrow') {
    const moved = moveDueTodosToTomorrow();
    window.notchAPI?.notifyReminderInfo?.({
      title: moved ? `已把 ${moved} 项待办挪到明天` : '今天没有要挪的待办',
      detail: moved ? '截止时间保持原来的钟点，早点休息' : '',
    }).catch(() => {});
  }
});

window.notchAPI?.onOpenTodo?.(async () => {
  if (!document.getElementById('app')?.classList.contains('expanded')) await setMode(true);
  setActiveTab('todo');
});

window.NotchPomodoro = {
  start: startPomodoroSession,
  toggle: () => pomodoroToggle?.click(),
  state: () => ({ running: pomodoroRunning, started: pomodoroStarted, mode: pomodoroMode, remaining: pomodoroRemaining, session: pomodoroSessionSeconds }),
};
window.NotchReminderActions = { completeTodoById, moveDueTodosToTomorrow };

// ============ 首页 · Markdown 速记 ============
// textarea 中的原始 Markdown 始终是唯一数据源；预览只用 DOM API + textContent 构建，
// 不执行用户输入的 HTML，也不自动加载远程图片。
const NOTE_KEY = 'notch-home-note';
const noteInput = document.getElementById('home-note');
const notePreview = document.getElementById('home-note-preview');
const noteSaveButton = document.getElementById('note-save-btn');
const noteFormatActions = document.getElementById('note-format-actions');
const noteModeButtons = Array.from(document.querySelectorAll('[data-note-mode]'));
const noteEditButton = document.getElementById('note-edit-btn');
const homeNote = document.querySelector('.home-note');

const NOTE_INLINE_PATTERNS = [
  { type: 'code', regex: /`([^`\n]+)`/g },
  { type: 'link', regex: /\[([^\]\n]+)\]\(([^)\s]+)\)/g },
  { type: 'strong', regex: /\*\*([^*\n]+)\*\*/g },
  { type: 'strong', regex: /__([^_\n]+)__/g },
  { type: 'delete', regex: /~~([^~\n]+)~~/g },
  { type: 'emphasis', regex: /\*([^*\n]+)\*/g },
  { type: 'emphasis', regex: /_([^_\n]+)_/g },
];

const NOTE_TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const NOTE_BULLET_RE = /^\s*[-*+]\s+(.*)$/;
const NOTE_ORDERED_RE = /^\s*(\d+)[.)]\s+(.*)$/;
const NOTE_QUOTE_RE = /^\s*>\s?(.*)$/;
const NOTE_HEADING_RE = /^\s{0,3}(#{1,6})\s+(.+)$/;
const NOTE_FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w-]+)?\s*$/;
const NOTE_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function findNextInlineToken(text, fromIndex) {
  let next = null;
  NOTE_INLINE_PATTERNS.forEach((pattern, priority) => {
    pattern.regex.lastIndex = fromIndex;
    const match = pattern.regex.exec(text);
    if (
      match &&
      (!next || match.index < next.match.index ||
        (match.index === next.match.index && priority < next.priority))
    ) {
      next = { type: pattern.type, match, priority };
    }
  });
  return next;
}

function safeMarkdownUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch (e) {
    return null;
  }
}

function appendInlineMarkdown(parent, source, depth = 0) {
  const text = String(source || '');
  if (!text || depth > 6) {
    if (text) parent.append(document.createTextNode(text));
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    const token = findNextInlineToken(text, cursor);
    if (!token) {
      parent.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    const { type, match } = token;
    if (match.index > cursor) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
    }

    if (type === 'code') {
      const code = document.createElement('code');
      code.textContent = match[1];
      parent.append(code);
    } else if (type === 'link') {
      const href = safeMarkdownUrl(match[2]);
      if (!href) {
        parent.append(document.createTextNode(match[0]));
      } else {
        const link = document.createElement('a');
        link.dataset.noteHref = href;
        link.setAttribute('role', 'link');
        link.tabIndex = 0;
        link.rel = 'noreferrer';
        appendInlineMarkdown(link, match[1], depth + 1);
        parent.append(link);
      }
    } else {
      const tagName = type === 'strong' ? 'strong' : type === 'delete' ? 'del' : 'em';
      const formatted = document.createElement(tagName);
      appendInlineMarkdown(formatted, match[1], depth + 1);
      parent.append(formatted);
    }

    cursor = match.index + match[0].length;
  }
}

function appendMarkdownLines(parent, lines) {
  lines.forEach((line, index) => {
    if (index > 0) parent.append(document.createElement('br'));
    appendInlineMarkdown(parent, line);
  });
}

function isMarkdownBlockStart(line) {
  if (!line.trim()) return true;
  return (
    NOTE_FENCE_RE.test(line) ||
    NOTE_HEADING_RE.test(line) ||
    NOTE_QUOTE_RE.test(line) ||
    NOTE_TASK_RE.test(line) ||
    NOTE_ORDERED_RE.test(line) ||
    NOTE_BULLET_RE.test(line) ||
    NOTE_RULE_RE.test(line)
  );
}

function buildMarkdownPreview(source) {
  const fragment = document.createDocumentFragment();
  const normalized = String(source || '').replace(/\r\n?/g, '\n');

  if (!normalized.trim()) {
    const empty = document.createElement('p');
    empty.className = 'note-preview-empty';
    empty.textContent = '写点内容后，在这里查看排版';
    fragment.append(empty);
    return fragment;
  }

  const lines = normalized.split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(NOTE_FENCE_RE);
    if (fenceMatch) {
      const fenceChar = fenceMatch[1][0];
      const fenceLength = fenceMatch[1].length;
      const closeFence = new RegExp('^\\s*' + fenceChar + '{' + fenceLength + ',}\\s*$');
      const codeLines = [];
      index += 1;
      while (index < lines.length && !closeFence.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (fenceMatch[2]) code.dataset.language = fenceMatch[2];
      code.textContent = codeLines.join('\n');
      pre.append(code);
      fragment.append(pre);
      continue;
    }

    const headingMatch = line.match(NOTE_HEADING_RE);
    if (headingMatch) {
      const heading = document.createElement('h' + headingMatch[1].length);
      appendInlineMarkdown(heading, headingMatch[2]);
      fragment.append(heading);
      index += 1;
      continue;
    }

    if (NOTE_RULE_RE.test(line)) {
      fragment.append(document.createElement('hr'));
      index += 1;
      continue;
    }

    const quoteMatch = line.match(NOTE_QUOTE_RE);
    if (quoteMatch) {
      const quoteLines = [];
      while (index < lines.length) {
        const match = lines[index].match(NOTE_QUOTE_RE);
        if (!match) break;
        quoteLines.push(match[1]);
        index += 1;
      }
      const quote = document.createElement('blockquote');
      appendMarkdownLines(quote, quoteLines);
      fragment.append(quote);
      continue;
    }

    const taskMatch = line.match(NOTE_TASK_RE);
    if (taskMatch) {
      const list = document.createElement('ul');
      list.className = 'note-task-list';
      while (index < lines.length) {
        const match = lines[index].match(NOTE_TASK_RE);
        if (!match) break;
        const done = match[1].toLowerCase() === 'x';
        const item = document.createElement('li');
        item.className = 'note-task-item' + (done ? ' done' : '');
        item.dataset.line = String(index);
        item.setAttribute('role', 'checkbox');
        item.setAttribute('aria-checked', String(done));
        const box = document.createElement('span');
        box.className = 'note-task-box';
        box.setAttribute('aria-hidden', 'true');
        box.textContent = done ? '✓' : '';
        const content = document.createElement('span');
        appendInlineMarkdown(content, match[2]);
        item.append(box, content);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const orderedMatch = line.match(NOTE_ORDERED_RE);
    if (orderedMatch) {
      const list = document.createElement('ol');
      const start = Number.parseInt(orderedMatch[1], 10);
      if (Number.isFinite(start) && start !== 1) list.start = start;
      while (index < lines.length) {
        const match = lines[index].match(NOTE_ORDERED_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[2]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const bulletMatch = line.match(NOTE_BULLET_RE);
    if (bulletMatch) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        if (NOTE_TASK_RE.test(lines[index])) break;
        const match = lines[index].match(NOTE_BULLET_RE);
        if (!match) break;
        const item = document.createElement('li');
        appendInlineMarkdown(item, match[1]);
        list.append(item);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendMarkdownLines(paragraph, paragraphLines);
    fragment.append(paragraph);
  }

  return fragment;
}

function renderNotePreview() {
  if (!noteInput || !notePreview) return;
  notePreview.replaceChildren(buildMarkdownPreview(noteInput.value));
}

function replaceNoteText(
  start,
  end,
  replacement,
  selectionStart,
  selectionEnd,
  selectionDirection = 'none'
) {
  if (!noteInput) return;
  noteInput.setRangeText(replacement, start, end, 'end');
  noteInput.focus({ preventScroll: true });
  noteInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  noteInput.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapNoteSelection(open, close, placeholder) {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);

  const hasOuterMarkers =
    selected &&
    start >= open.length &&
    noteInput.value.slice(start - open.length, start) === open &&
    noteInput.value.slice(end, end + close.length) === close;
  if (hasOuterMarkers) {
    replaceNoteText(
      start - open.length,
      end + close.length,
      selected,
      start - open.length,
      end - open.length,
      direction
    );
    return;
  }

  if (selected && selected.startsWith(open) && selected.endsWith(close)) {
    const unwrapped = selected.slice(open.length, selected.length - close.length);
    replaceNoteText(start, end, unwrapped, start, start + unwrapped.length, direction);
    return;
  }

  const content = selected || placeholder;
  const replacement = open + content + close;
  replaceNoteText(
    start,
    end,
    replacement,
    start + open.length,
    start + open.length + content.length,
    direction
  );
}

function stripNoteBlockPrefix(line) {
  return line.replace(
    /^(?:#{1,6}\s+|>\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)/,
    ''
  );
}

function applyNoteLineFormat(type) {
  if (!noteInput) return;
  const value = noteInput.value;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd;
  if (end > start && value[end - 1] === '\n') {
    lineEnd = end - 1;
  } else {
    const nextBreak = value.indexOf('\n', end);
    lineEnd = nextBreak === -1 ? value.length : nextBreak;
  }

  const original = value.slice(lineStart, lineEnd);
  const lines = original.split('\n');
  const matchers = {
    heading: /^#{1,6}\s+/,
    bullet: /^[-*+]\s+(?!\[[ xX]\]\s+)/,
    ordered: /^\d+[.)]\s+/,
    task: /^[-*+]\s+\[[ xX]\]\s+/,
    quote: /^>\s+/,
  };
  const matcher = matchers[type];
  if (!matcher) return;
  const nonEmptyLines = lines.filter((line) => line.trim());
  const shouldRemove =
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => matcher.test(line.trimStart()));
  let orderedIndex = 1;

  const transformed = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indentation = line.match(/^\s*/)[0];
    const body = line.slice(indentation.length);
    if (shouldRemove) return indentation + body.replace(matcher, '');
    const content = stripNoteBlockPrefix(body) || (
      type === 'heading' ? '标题' :
      type === 'task' ? '待办' :
      type === 'quote' ? '引用' : '项目'
    );
    if (type === 'ordered') return indentation + String(orderedIndex++) + '. ' + content;
    if (type === 'heading') return indentation + '# ' + content;
    if (type === 'task') return indentation + '- [ ] ' + content;
    if (type === 'quote') return indentation + '> ' + content;
    return indentation + '- ' + content;
  }).join('\n');

  const emptySingleLine = lines.length === 1 && !original.trim() && !shouldRemove;
  let nextStart = lineStart;
  let nextEnd = lineStart + transformed.length;
  if (emptySingleLine) {
    const indentationLength = original.match(/^\s*/)[0].length;
    const prefixLength =
      type === 'heading' ? 2 :
      type === 'task' ? 6 :
      type === 'ordered' ? 3 : 2;
    nextStart += indentationLength + prefixLength;
  }
  replaceNoteText(lineStart, lineEnd, transformed, nextStart, nextEnd, direction);
}

function applyNoteLink() {
  if (!noteInput) return;
  const start = noteInput.selectionStart;
  const end = noteInput.selectionEnd;
  const direction = noteInput.selectionDirection;
  const selected = noteInput.value.slice(start, end);
  const label = selected || '链接文字';
  const url = 'https://';
  const replacement = '[' + label + '](' + url + ')';
  if (selected) {
    const urlStart = start + label.length + 3;
    replaceNoteText(start, end, replacement, urlStart, urlStart + url.length, direction);
  } else {
    replaceNoteText(start, end, replacement, start + 1, start + 1 + label.length, direction);
  }
}

let noteComposing = false;

function applyNoteFormat(type) {
  if (!noteInput || noteComposing) return;
  if (type === 'bold') return wrapNoteSelection('**', '**', '加粗文字');
  if (type === 'italic') return wrapNoteSelection('*', '*', '斜体文字');
  if (type === 'code') return wrapNoteSelection('`', '`', '代码');
  if (type === 'link') return applyNoteLink();
  applyNoteLineFormat(type);
}

let noteMode = 'edit';
let noteSelection = { start: 0, end: 0, direction: 'none', scrollTop: 0 };

function setNoteMode(mode, focusTarget = true) {
  if (!noteInput || !notePreview) return;
  const previousMode = noteMode;
  noteMode = mode === 'preview' ? 'preview' : 'edit';
  const isPreview = noteMode === 'preview';

  if (isPreview) {
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
    renderNotePreview();
  } else if (previousMode === 'edit') {
    // 重复点击已选中的“编辑”时保留用户当下光标，而不是恢复旧选区。
    noteSelection = {
      start: noteInput.selectionStart,
      end: noteInput.selectionEnd,
      direction: noteInput.selectionDirection,
      scrollTop: noteInput.scrollTop,
    };
  }

  noteInput.hidden = isPreview;
  notePreview.hidden = !isPreview;
  if (noteFormatActions) noteFormatActions.hidden = isPreview;
  if (homeNote) homeNote.classList.toggle('is-preview', isPreview);
  noteModeButtons.forEach((button) => {
    const active = button.dataset.noteMode === noteMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (noteEditButton) {
    noteEditButton.classList.toggle('active', !isPreview);
    noteEditButton.textContent = isPreview ? '编辑' : '完成';
    noteEditButton.setAttribute('aria-pressed', String(!isPreview));
  }

  if (!focusTarget) return;
  requestAnimationFrame(() => {
    if (isPreview) {
      notePreview.focus({ preventScroll: true });
    } else {
      noteInput.focus({ preventScroll: true });
      noteInput.setSelectionRange(
        noteSelection.start,
        noteSelection.end,
        noteSelection.direction
      );
      noteInput.scrollTop = noteSelection.scrollTop;
    }
  });
}

function continueNoteList(event) {
  if (
    !noteInput ||
    event.key !== 'Enter' ||
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    noteComposing ||
    noteInput.selectionStart !== noteInput.selectionEnd
  ) {
    return false;
  }

  const value = noteInput.value;
  const cursor = noteInput.selectionStart;
  const lineStart = value.lastIndexOf('\n', cursor - 1) + 1;
  const nextBreak = value.indexOf('\n', cursor);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const line = value.slice(lineStart, lineEnd);
  const patterns = [
    {
      regex: /^(\s*)[-*+]\s+\[[ xX]\]\s*(.*)$/,
      prefix: () => '- [ ] ',
    },
    {
      regex: /^(\s*)(\d+)[.)]\s+(.*)$/,
      prefix: (match) => String(Number.parseInt(match[2], 10) + 1) + '. ',
    },
    {
      regex: /^(\s*)[-*+]\s+(.*)$/,
      prefix: () => '- ',
    },
    {
      regex: /^(\s*)>\s?(.*)$/,
      prefix: () => '> ',
    },
  ];

  const definition = patterns.find((candidate) => candidate.regex.test(line));
  if (!definition) return false;
  const match = line.match(definition.regex);
  const content = match[match.length - 1];
  const indentation = match[1];
  event.preventDefault();

  if (!content.trim()) {
    replaceNoteText(
      lineStart,
      lineEnd,
      indentation,
      lineStart + indentation.length,
      lineStart + indentation.length
    );
    return true;
  }

  const prefix = indentation + definition.prefix(match);
  const insertion = '\n' + prefix;
  replaceNoteText(cursor, cursor, insertion, cursor + insertion.length, cursor + insertion.length);
  return true;
}

if (noteInput) {
  try {
    noteInput.value = localStorage.getItem(NOTE_KEY) || '';
  } catch (e) {
    // ignore
  }

  let noteTimer = null;
  const saveNote = () => {
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = null;
    if (workspaceReloadPending) return;
    try {
      localStorage.setItem(NOTE_KEY, noteInput.value);
    } catch (e) {
      // ignore quota errors
    }
    // 首页随笔同步成笔记库里当天的「M月D日 随笔」。
    window.NotchNotes?.syncHomeNote?.(noteInput.value);
  };

  noteInput.addEventListener('input', () => {
    renderNotePreview();
    clearTimeout(noteTimer);
    noteTimer = setTimeout(saveNote, 300);
  });
  noteInput.addEventListener('blur', saveNote);
  noteInput.addEventListener('compositionstart', () => {
    noteComposing = true;
  });
  noteInput.addEventListener('compositionend', () => {
    noteComposing = false;
  });
  noteInput.addEventListener('keydown', (event) => {
    if (continueNoteList(event)) return;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    const key = event.key.toLowerCase();
    if (key !== 'b' && key !== 'i') return;
    event.preventDefault();
    applyNoteFormat(key === 'b' ? 'bold' : 'italic');
  });

  window.addEventListener('beforeunload', saveNote);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) saveNote();
  });

  noteInput.hidden = false;
}

// 笔记库（分组、预览 / 编辑、导出、今日随笔）在 notes-page.js（window.NotchNotes）。

// 首页随笔的读写口：笔记页里改今日随笔时写回这里，过了 0 点由笔记页清空。
window.NotchHomeNote = {
  get: () => noteInput?.value ?? '',
  set(value) {
    if (!noteInput) return;
    noteInput.value = String(value || '');
    renderNotePreview();
  },
};

noteSaveButton?.addEventListener('click', () => {
  const content = noteInput?.value.trim() || '';
  if (!content) {
    showStatusToast('先写点内容再存档');
    return;
  }
  try { localStorage.setItem(NOTE_KEY, noteInput.value); } catch (error) {}
  const id = window.NotchNotes?.syncHomeNote?.(noteInput.value);
  showStatusToast(id ? '已存进笔记库' : '没存上，请稍后再试');
});

if (noteFormatActions) {
  noteFormatActions.addEventListener('mousedown', (event) => {
    if (event.target.closest('[data-note-format]')) event.preventDefault();
  });
  noteFormatActions.addEventListener('click', (event) => {
    const button = event.target.closest('[data-note-format]');
    if (!button) return;
    applyNoteFormat(button.dataset.noteFormat);
  });
}

noteModeButtons.forEach((button) => {
  button.addEventListener('click', () => setNoteMode(button.dataset.noteMode));
});
noteEditButton?.addEventListener('click', () => setNoteMode(noteMode === 'preview' ? 'edit' : 'preview'));

if (notePreview) {
  notePreview.addEventListener('click', (event) => {
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
  notePreview.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const link = event.target.closest('[data-note-href]');
    if (!link) return;
    event.preventDefault();
    const href = safeMarkdownUrl(link.dataset.noteHref);
    if (href && window.notchAPI && typeof window.notchAPI.openExternal === 'function') {
      window.notchAPI.openExternal(href).catch(() => {});
    }
  });
}

// ============ 首页 · 自适应 Bento 布局（长按换位 + 迷你/小/中/大组件） ============
const HOME_ORDER_KEY = 'notch-home-order-v3';
const HOME_SIZES_KEY = 'notch-home-widget-sizes-v2';
const HOME_HIDDEN_MODULES_KEY = 'notch-home-hidden-modules-v1';
const HOME_MODULE_REGISTRY = ['note', 'today', 'pomodoro', 'usage', 'mirror', 'recorder', 'windows'];
const unavailableHomeModules = window.NotchPlatform.capabilities(window.notchAPI?.platform || 'darwin').unavailableHomeModules;
const effectiveHomeHidden = (hidden) => window.NotchPlatform.effectiveHiddenModules(hidden, HOME_MODULE_REGISTRY, unavailableHomeModules);
// v0.2 默认首页（与 docs/design/v0.2 原型一致）：随笔 · 今天 · 专注 · AI 用量 · 相框；
// 快速录音与当前窗口默认隐藏，可在设置中打开。汽水音乐与常用指令已从首页移除。
const HOME_ORDER_DEFAULTS = ['note', 'today', 'pomodoro', 'usage', 'mirror', 'recorder', 'windows'];
const HOME_HIDDEN_DEFAULTS = ['recorder', 'windows'];
const HOME_SIZE_DEFAULTS = {
  note: 'large',
  today: 'medium',
  pomodoro: 'small',
  usage: 'medium',
  mirror: 'medium',
  // 两张可选卡片默认「迷你」，这样 7 张全部打开时面积正好是 48 格。
  recorder: 'mini',
  windows: 'mini',
};
const HOME_LAYOUT_VERSION_KEY = 'notch-home-layout-version';
const HOME_LAYOUT_VERSION = '2';

// 升级到 v0.2 时只执行一次：旧布局按旧卡片排列，换成新卡片后会落进不合适的格子，
// 所以统一换成新的默认布局。之后用户的排序、尺寸和显隐照常保存。
(function migrateHomeLayoutToV2() {
  try {
    if (localStorage.getItem(HOME_LAYOUT_VERSION_KEY) === HOME_LAYOUT_VERSION) return;
    localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(HOME_ORDER_DEFAULTS));
    localStorage.setItem(HOME_SIZES_KEY, JSON.stringify(HOME_SIZE_DEFAULTS));
    localStorage.setItem(HOME_HIDDEN_MODULES_KEY, JSON.stringify(HOME_HIDDEN_DEFAULTS));
    localStorage.setItem(HOME_LAYOUT_VERSION_KEY, HOME_LAYOUT_VERSION);
  } catch (error) {
    // LocalStorage 不可用时使用内存中的默认布局。
  }
})();
const HOME_SIZE_LABELS = { mini: '迷你', small: '小', medium: '中', large: '大' };
const homeBento = document.getElementById('home-bento');
const homeTiles = homeBento
  ? Array.from(homeBento.querySelectorAll('[data-home-module]'))
  : [];

function loadHomeOrder() {
  try {
    const rawSaved = JSON.parse(localStorage.getItem(HOME_ORDER_KEY) || 'null');
    const saved = Array.isArray(rawSaved)
      ? rawSaved.filter((id) => HOME_ORDER_DEFAULTS.includes(id))
      : rawSaved;
    if (
      Array.isArray(saved)
      && saved.length >= HOME_ORDER_DEFAULTS.length - 1
      && new Set(saved).size === saved.length
      && saved.every((id) => HOME_ORDER_DEFAULTS.includes(id))
    ) return [...saved, ...HOME_ORDER_DEFAULTS.filter((id) => !saved.includes(id))];

    // 从旧固定槽位布局平滑迁移。
    const legacy = JSON.parse(localStorage.getItem('notch-home-layout-v2') || 'null');
    const legacySlots = ['tall-left', 'small-top', 'medium-top', 'square-top', 'tall-right', 'wide-bottom'];
    if (legacy && typeof legacy === 'object') {
      const migrated = Object.entries(legacy)
        .sort((a, b) => legacySlots.indexOf(a[1]) - legacySlots.indexOf(b[1]))
        .map(([id]) => id)
        .filter((id) => HOME_ORDER_DEFAULTS.includes(id));
      if (migrated.length === HOME_ORDER_DEFAULTS.length && new Set(migrated).size === migrated.length) {
        return migrated;
      }
    }
  } catch (error) {
    // 使用默认顺序。
  }
  return [...HOME_ORDER_DEFAULTS];
}

function loadHomeSizes() {
  try {
    return window.NotchDomain.normalizeHomeWidgetSizes(
      JSON.parse(localStorage.getItem(HOME_SIZES_KEY) || 'null'),
      HOME_SIZE_DEFAULTS,
      '',
      hiddenHomeModules.length ? Infinity : 48
    );
  } catch (error) {
    return { ...HOME_SIZE_DEFAULTS };
  }
}

function loadHiddenHomeModules() {
  try {
    const rawText = localStorage.getItem(HOME_HIDDEN_MODULES_KEY);
    if (rawText === null) return { hiddenIds: [], needsRepair: false };
    const parsed = JSON.parse(rawText);
    const hiddenIds = window.NotchDomain.normalizeHiddenHomeModules(parsed, HOME_MODULE_REGISTRY);
    return {
      hiddenIds,
      needsRepair: JSON.stringify(parsed) !== JSON.stringify(hiddenIds),
    };
  } catch (error) {
    return { hiddenIds: [], needsRepair: true };
  }
}

let homeOrder = loadHomeOrder();
const loadedHomeVisibility = loadHiddenHomeModules();
let hiddenHomeModules = loadedHomeVisibility.hiddenIds;
let homeSizes = loadHomeSizes();
let homeVisibilityPersisted = true;
let homeLayoutReadOnly = false;
let homeLayoutMotionGeneration = 0;
let homeLayoutMotionAnimations = [];
const HOME_LAYOUT_MOTION_MS = 560;
const HOME_LAYOUT_MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function saveHomeLayout() {
  try {
    localStorage.setItem(HOME_ORDER_KEY, JSON.stringify(homeOrder));
    localStorage.setItem(HOME_SIZES_KEY, JSON.stringify(homeSizes));
  } catch (error) {
    // LocalStorage 不可用时仍保留当前会话内的布局。
  }
}

function saveHiddenHomeModules() {
  try {
    localStorage.setItem(HOME_HIDDEN_MODULES_KEY, JSON.stringify(hiddenHomeModules));
    homeVisibilityPersisted = true;
    return true;
  } catch (error) {
    homeVisibilityPersisted = false;
    return false;
  }
}

if (loadedHomeVisibility.needsRepair) saveHiddenHomeModules();

function resolveValidatedHomeLayout(hiddenIds, order = homeOrder, sizes = homeSizes) {
  hiddenIds = effectiveHomeHidden(hiddenIds);
  const visibleIds = HOME_MODULE_REGISTRY.filter((id) => !hiddenIds.includes(id));
  const layout = window.NotchDomain.resolveHomeWidgetLayout(order, sizes, hiddenIds, 12, 4);
  return window.NotchDomain.validateHomeWidgetLayout(layout, visibleIds, 12, 4)
    ? layout
    : null;
}

function cancelHomeLayoutMotion() {
  homeLayoutMotionGeneration += 1;
  homeLayoutMotionAnimations.forEach((animation) => animation.cancel());
  homeLayoutMotionAnimations = [];
  homeBento?.classList.remove('layout-motion-active');
}

function captureHomeLayoutVisualState() {
  if (!homeBento) return null;
  const surface = homeBento.getBoundingClientRect();
  if (!surface.width || !surface.height) return null;
  const tiles = new Map();
  homeTiles.forEach((tile) => {
    if (tile.hidden) return;
    const rect = tile.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    tiles.set(tile.dataset.homeModule, {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  });
  return { surface: { left: surface.left, top: surface.top }, tiles };
}

function animateCommittedHomeLayout(reason, beforeState) {
  if (!homeBento || !beforeState || reason === 'initial' || reason === 'rollback'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const generation = homeLayoutMotionGeneration;
  const finalTiles = new Map();
  homeTiles.forEach((tile) => {
    if (tile.hidden) return;
    const rect = tile.getBoundingClientRect();
    if (rect.width && rect.height) finalTiles.set(tile.dataset.homeModule, { tile, rect });
  });
  homeBento.classList.add('layout-motion-active');

  finalTiles.forEach(({ tile, rect }, moduleId) => {
    const previous = beforeState.tiles.get(moduleId);
    const dx = previous ? previous.rect.left - rect.left : 0;
    const dy = previous ? previous.rect.top - rect.top : 0;
    const scaleX = previous ? previous.rect.width / Math.max(1, rect.width) : 1;
    const scaleY = previous ? previous.rect.height / Math.max(1, rect.height) : 1;
    const moved = Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5;
    const resized = Math.abs(scaleX - 1) >= 0.01 || Math.abs(scaleY - 1) >= 0.01;
    if (previous && !moved && !resized) return;
    const animation = tile.animate(
      previous
        ? [
          { opacity: 1, transform: `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})` },
          { opacity: 1, transform: 'translate(0, 0) scale(1, 1)' },
        ]
        : [
          { opacity: 0.72, transform: 'translateY(8px) scale(0.98)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' },
        ],
      { duration: HOME_LAYOUT_MOTION_MS, easing: HOME_LAYOUT_MOTION_EASING }
    );
    homeLayoutMotionAnimations.push(animation);
  });

  Promise.allSettled(homeLayoutMotionAnimations.map((animation) => animation.finished))
    .then(() => {
      if (generation !== homeLayoutMotionGeneration) return;
      homeLayoutMotionAnimations = [];
      homeBento.classList.remove('layout-motion-active');
    });
}

function applyHomeLayout(layout, { reason = 'initial' } = {}) {
  if (!homeBento || !layout) throw new Error('A validated homepage layout is required.');
  cancelHomeLayoutMotion();
  const beforeState = reason === 'initial' || reason === 'rollback'
    ? null
    : captureHomeLayoutVisualState();
  const automaticLayout = !homeLayoutReadOnly && effectiveHomeHidden(hiddenHomeModules).length > 0;
  const canResize = !homeLayoutReadOnly && Object.keys(layout.placements).length >= 7;
  homeBento.dataset.layoutMode = homeLayoutReadOnly ? 'safe' : automaticLayout ? 'automatic' : 'preferred';
  homeBento.dataset.resizeMode = canResize ? 'enabled' : 'disabled';
  homeTiles.forEach((tile) => {
    const moduleId = tile.dataset.homeModule;
    const orderIndex = Math.max(0, homeOrder.indexOf(moduleId));
    const placement = layout.placements[moduleId];
    const placementSize = placement && placement.width === 2 && placement.height === 1 ? 'mini'
      : placement && placement.width === 2 && placement.height === 2 ? 'small'
        : placement && placement.width === 4 && placement.height === 2 ? 'medium'
          : placement && placement.width === 4 && placement.height === 4 ? 'large' : null;
    const size = canResize && placementSize ? placementSize : homeSizes[moduleId] || HOME_SIZE_DEFAULTS[moduleId];
    tile.style.order = String(orderIndex);
    tile.dataset.widgetSize = size;
    tile.style.setProperty('--bento-index', String(orderIndex));
    tile.hidden = !placement;
    tile.setAttribute('aria-hidden', String(!placement));
    if (placement) {
      tile.dataset.layoutVariant = layout.variants[moduleId];
      tile.dataset.layoutColumn = String(placement.column);
      tile.dataset.layoutRow = String(placement.row);
      tile.dataset.layoutWidth = String(placement.width);
      tile.dataset.layoutHeight = String(placement.height);
      tile.style.gridColumn = `${placement.column + 1} / span ${placement.width}`;
      tile.style.gridRow = `${placement.row + 1} / span ${placement.height}`;
    } else {
      delete tile.dataset.layoutVariant;
      delete tile.dataset.layoutColumn;
      delete tile.dataset.layoutRow;
      delete tile.dataset.layoutWidth;
      delete tile.dataset.layoutHeight;
      tile.style.removeProperty('grid-column');
      tile.style.removeProperty('grid-row');
    }
    const sizeButton = tile.querySelector('[data-widget-size-cycle]');
    if (sizeButton) {
      sizeButton.dataset.currentSize = size;
      sizeButton.setAttribute('aria-label', `${HOME_SIZE_LABELS[size]}组件，点击切换尺寸`);
      sizeButton.title = `组件尺寸：${HOME_SIZE_LABELS[size]}`;
      sizeButton.hidden = !canResize || !placement;
      sizeButton.disabled = !canResize || !placement;
      sizeButton.tabIndex = canResize && placement ? 0 : -1;
    }
  });
  animateCommittedHomeLayout(reason, beforeState);
}

homeTiles.forEach((tile) => {
  const sizeButton = document.createElement('button');
  sizeButton.type = 'button';
  sizeButton.className = 'widget-size-control motion-icon';
  sizeButton.dataset.widgetSizeCycle = tile.dataset.homeModule;
  sizeButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>';
  tile.appendChild(sizeButton);
});

const homeModuleIds = new Set(homeTiles.map((tile) => tile.dataset.homeModule));
if (homeTiles.length !== HOME_MODULE_REGISTRY.length
  || homeModuleIds.size !== HOME_MODULE_REGISTRY.length
  || !HOME_MODULE_REGISTRY.every((id) => homeModuleIds.has(id))) {
  throw new Error('Homepage module registry does not match the rendered tiles.');
}

let initialHomeLayout = resolveValidatedHomeLayout(hiddenHomeModules);
if (!initialHomeLayout) {
  initialHomeLayout = resolveValidatedHomeLayout([], HOME_ORDER_DEFAULTS, HOME_SIZE_DEFAULTS);
  homeLayoutReadOnly = true;
  console.error('Homepage layout validation failed; using read-only defaults.');
}
if (!initialHomeLayout) throw new Error('Default homepage layout validation failed.');
applyHomeLayout(initialHomeLayout, { reason: 'initial' });

function visibilitySnapshot() {
  const effectiveHiddenIds = effectiveHomeHidden(homeLayoutReadOnly ? [] : hiddenHomeModules);
  return {
    hiddenIds: [...effectiveHiddenIds],
    visibleIds: HOME_MODULE_REGISTRY.filter((id) => !effectiveHiddenIds.includes(id)),
    storedHiddenIds: [...hiddenHomeModules],
    automaticLayout: !homeLayoutReadOnly && effectiveHiddenIds.length > 0,
    unavailableIds: [...unavailableHomeModules],
    readOnly: homeLayoutReadOnly,
    persisted: homeVisibilityPersisted,
  };
}

function setHomeModuleVisible(moduleId, visible) {
  const current = [...hiddenHomeModules];
  if (unavailableHomeModules.includes(moduleId)) return { ok: false, changed: false, error: 'unsupported', hiddenIds: current, persisted: homeVisibilityPersisted };
  const currentlyVisible = visibilitySnapshot().visibleIds;
  if (!visible && currentlyVisible.includes(moduleId) && currentlyVisible.length === 1) {
    return { ok: false, changed: false, error: 'at_least_one_required', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (homeLayoutReadOnly) {
    return { ok: false, changed: false, error: 'layout_read_only', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const next = window.NotchDomain.updateHomeModuleVisibility(
    current,
    HOME_MODULE_REGISTRY,
    moduleId,
    visible
  );
  if (!next.ok) return { ...next, changed: false, persisted: homeVisibilityPersisted };
  const changed = JSON.stringify(next.hiddenIds) !== JSON.stringify(current);
  if (!changed) {
    return { ok: true, changed: false, hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  if (moduleId === 'recorder' && visible === false
    && window.NotchWorkspace?.isRecordingActive?.()) {
    return { ok: false, changed: false, error: 'recording_active', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const previousSizes = homeSizes;
  const nextSizes = effectiveHomeHidden(next.hiddenIds).length === 0
    ? window.NotchDomain.normalizeHomeWidgetSizes(homeSizes, HOME_SIZE_DEFAULTS, moduleId, 48)
    : homeSizes;
  const layout = resolveValidatedHomeLayout(next.hiddenIds, homeOrder, nextSizes);
  const currentLayout = resolveValidatedHomeLayout(current);
  if (!layout || !currentLayout) {
    return { ok: false, changed: false, error: 'layout_invalid', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  try {
    const activeElement = document.activeElement;
    const changingTile = homeTiles.find((tile) => tile.dataset.homeModule === moduleId);
    if (visible === false && changingTile?.contains(activeElement)) activeElement.blur();
    hiddenHomeModules = next.hiddenIds;
    homeSizes = nextSizes;
    applyHomeLayout(layout, { reason: 'visibility' });
  } catch (error) {
    hiddenHomeModules = current;
    homeSizes = previousSizes;
    try { applyHomeLayout(currentLayout, { reason: 'rollback' }); } catch (rollbackError) {}
    return { ok: false, changed: false, error: 'dom_apply_failed', hiddenIds: current, persisted: homeVisibilityPersisted };
  }
  const persisted = saveHiddenHomeModules();
  if (nextSizes !== previousSizes) saveHomeLayout();
  const detail = visibilitySnapshot();
  document.dispatchEvent(new CustomEvent('notch:home-modules-changed', { detail }));
  return { ok: true, changed: true, hiddenIds: [...hiddenHomeModules], persisted };
}

window.NotchHome = Object.freeze({
  getVisibility: visibilitySnapshot,
  isVisible: (moduleId) => visibilitySnapshot().visibleIds.includes(String(moduleId || '')),
  setModuleVisible: setHomeModuleVisible,
});

document.dispatchEvent(new CustomEvent('notch:home-modules-changed', {
  detail: visibilitySnapshot(),
}));
if (homeLayoutReadOnly) document.dispatchEvent(new CustomEvent('notch:home-layout-error'));

if (homeBento) {
  let pendingLongPress = null;
  let dragState = null;
  let suppressHomeClickUntil = 0;

  const clearDropTarget = () => {
    homeTiles.filter((tile) => !tile.hidden).forEach((tile) => tile.classList.remove('layout-drop-target'));
  };

  const finishHomeDrag = (event, cancelled = false) => {
    if (pendingLongPress) clearTimeout(pendingLongPress.timer);
    pendingLongPress = null;
    if (!dragState) return;
    const { tile, target, pointerId } = dragState;
    if (tile.hasPointerCapture?.(pointerId)) tile.releasePointerCapture(pointerId);
    tile.classList.remove('is-dragging', 'hit-test-off');
    tile.style.removeProperty('--home-drag-x');
    tile.style.removeProperty('--home-drag-y');
    homeBento.classList.remove('layout-dragging');
    clearDropTarget();
    if (!cancelled && target && target !== tile) {
      const sourceId = tile.dataset.homeModule;
      const targetId = target.dataset.homeModule;
      const sourceIndex = homeOrder.indexOf(sourceId);
      const targetIndex = homeOrder.indexOf(targetId);
      [homeOrder[sourceIndex], homeOrder[targetIndex]] = [homeOrder[targetIndex], homeOrder[sourceIndex]];
      const layout = resolveValidatedHomeLayout(hiddenHomeModules);
      if (layout) {
        applyHomeLayout(layout, { reason: 'reorder' });
        saveHomeLayout();
        showStatusToast('首页布局已更新');
      } else {
        [homeOrder[sourceIndex], homeOrder[targetIndex]] = [homeOrder[targetIndex], homeOrder[sourceIndex]];
        showStatusToast('布局未更新，请重试');
      }
    }
    dragState = null;
    suppressHomeClickUntil = Date.now() + 260;
  };

  homeBento.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const tile = event.target.closest('[data-home-module]');
    if (!tile || tile.hidden || event.target.closest('button, input, textarea, select, a, audio, [contenteditable]')) return;
    const startX = event.clientX;
    const startY = event.clientY;
    pendingLongPress = {
      tile,
      startX,
      startY,
      pointerId: event.pointerId,
      timer: setTimeout(() => {
        if (!pendingLongPress) return;
        tile.setPointerCapture?.(event.pointerId);
        homeBento.classList.add('layout-dragging');
        tile.classList.add('is-dragging');
        dragState = {
          tile,
          target: null,
          pointerId: event.pointerId,
          startX,
          startY,
        };
        pendingLongPress = null;
        if (navigator.vibrate) navigator.vibrate(18);
      }, 420),
    };
  });

  homeBento.addEventListener('click', (event) => {
    const sizeButton = event.target.closest('[data-widget-size-cycle]');
    if (!sizeButton) return;
    event.preventDefault();
    event.stopPropagation();
    const visibleIds = visibilitySnapshot().visibleIds;
    if (visibleIds.length < 7 || homeLayoutReadOnly) return;
    const moduleId = sizeButton.dataset.widgetSizeCycle;
    const sequence = ['mini', 'small', 'medium', 'large'];
    const current = sizeButton.dataset.currentSize || homeSizes[moduleId] || HOME_SIZE_DEFAULTS[moduleId];
    const requested = sequence[(sequence.indexOf(current) + 1) % sequence.length];
    const previousSizes = homeSizes;
    const visibleSizes = Object.fromEntries(visibleIds.map((id) => [
      id,
      homeTiles.find((tile) => tile.dataset.homeModule === id)?.querySelector('[data-widget-size-cycle]')?.dataset.currentSize || homeSizes[id],
    ]));
    const fittedSizes = window.NotchDomain.normalizeHomeWidgetSizes({
      ...visibleSizes,
      [moduleId]: requested,
    }, visibleSizes, moduleId, 48);
    homeSizes = { ...homeSizes, ...fittedSizes };
    const layout = resolveValidatedHomeLayout(hiddenHomeModules);
    if (layout) {
      applyHomeLayout(layout, { reason: 'size' });
      saveHomeLayout();
      showStatusToast(`${HOME_SIZE_LABELS[homeSizes[moduleId]]}组件 · 其他模块已自适应`);
    } else {
      homeSizes = previousSizes;
      showStatusToast('当前布局无法使用这个尺寸，已保留原布局');
    }
  });

  homeBento.addEventListener('pointermove', (event) => {
    if (pendingLongPress) {
      const moved = Math.hypot(
        event.clientX - pendingLongPress.startX,
        event.clientY - pendingLongPress.startY
      );
      if (moved > 8) {
        clearTimeout(pendingLongPress.timer);
        pendingLongPress = null;
      }
      return;
    }
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { tile, startX, startY } = dragState;
    tile.style.setProperty('--home-drag-x', `${event.clientX - startX}px`);
    tile.style.setProperty('--home-drag-y', `${event.clientY - startY}px`);
    tile.classList.add('hit-test-off');
    const hovered = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-home-module]');
    tile.classList.remove('hit-test-off');
    clearDropTarget();
    dragState.target = hovered && !hovered.hidden && hovered !== tile && homeBento.contains(hovered) ? hovered : null;
    dragState.target?.classList.add('layout-drop-target');
  });

  homeBento.addEventListener('pointerup', (event) => finishHomeDrag(event));
  homeBento.addEventListener('pointercancel', (event) => finishHomeDrag(event, true));
  homeBento.addEventListener('pointerleave', () => {
    if (!dragState && pendingLongPress) {
      clearTimeout(pendingLongPress.timer);
      pendingLongPress = null;
    }
  });
  homeBento.addEventListener('click', (event) => {
    if (Date.now() >= suppressHomeClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

// ============ 距离感应 Dock 悬浮 ============
function bindDockSurface(surface, selector, maxScale = 1.14) {
  if (!surface) return;
  let frame = null;
  const reset = () => {
    surface.querySelectorAll(selector).forEach((item) => {
      item.style.removeProperty('--dock-scale');
      item.style.removeProperty('--dock-lift');
      item.style.removeProperty('--dock-glow');
    });
  };
  surface.addEventListener('pointermove', (event) => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      surface.querySelectorAll(selector).forEach((item) => {
        const rect = item.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(event.clientX - centerX, event.clientY - centerY);
        const radius = Math.max(72, Math.min(150, rect.width * 2.2));
        const strength = Math.max(0, 1 - distance / radius) ** 2;
        item.style.setProperty('--dock-scale', (1 + (maxScale - 1) * strength).toFixed(3));
        item.style.setProperty('--dock-lift', `${(-5 * strength).toFixed(2)}px`);
        item.style.setProperty('--dock-glow', strength.toFixed(3));
      });
    });
  });
  surface.addEventListener('pointerleave', reset);
}

[
  ['#window-list', '.window-item', 1.12],
].forEach(([surfaceSelector, itemSelector, scale]) => {
  document.querySelectorAll(surfaceSelector).forEach((surface) => {
    bindDockSurface(surface, itemSelector, scale);
  });
});

const clipfavListEl = document.getElementById('clipfav-list');

function renderClipFavs() {
  if (!clipfavListEl) return;
  // 脏标记：clipHistory / clipFavorites / clipImageCache 均未变则跳过重建
  if (clipDataVersion === lastRenderedFavsVersion) return;

  // 按 clipFavorites 顺序取条目（过滤掉已删的）
  const favEntries = clipFavorites
    .map((id) => clipHistory.find((e) => e.id === id))
    .filter(Boolean);

  if (!favEntries.length) {
    clipfavListEl.innerHTML =
      '<button class="clipfav-empty" type="button" data-action="goto-clip">' +
      '去"剪贴板"Tab 给常用记录加星 →' +
      '</button>';
    lastRenderedFavsVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  // 渲染每条收藏
  clipfavListEl.innerHTML = favEntries
    .map((entry) => {
      const safeId = escapeHtml(entry.id);

      if (entry.type === 'image') {
        const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
        const mediaHtml = dataUrl
          ? `<img class="clipfav-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
          : `<div class="clipfav-thumb-placeholder">图</div>`;
        return (
          `<div class="clipfav-item clip-type-image" data-id="${safeId}" role="button" tabindex="0" title="图片">` +
          mediaHtml +
          `<span class="clipfav-text">图片</span>` +
          `</div>`
        );
      }

      // text | url
      const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
      const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
      let preview = entry.text || '';
      if (isUrl) {
        try {
          preview = new URL(entry.text).hostname || entry.text;
        } catch (_) {
          preview = entry.text || '';
        }
      }
      const safePreview = escapeHtml(preview);
      const safeTitle = escapeHtml(entry.text || '');
      return (
        `<div class="clipfav-item ${typeClass}" data-id="${safeId}" role="button" tabindex="0" title="${safeTitle}">` +
        `<span class="clipfav-text">${safePreview}</span>` +
        `</div>`
      );
    })
    .join('');
  lastRenderedFavsVersion = clipDataVersion; // 标记本次渲染版本

  // 按需预加载图片缩略图（命中后二次渲染刷新）
  // preloadClipImage 会自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  const missingImageEntries = favEntries.filter(
    (e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath)
  );
  if (missingImageEntries.length > 0) {
    Promise.all(missingImageEntries.map((e) => preloadClipImage(e.imagePath))).then(() => {
      const anyLoaded = missingImageEntries.some((e) => clipImageCache.has(e.imagePath));
      if (anyLoaded) renderClipFavs();
    });
  }
}

if (clipfavListEl) {
  clipfavListEl.addEventListener('click', async (e) => {
    e.stopPropagation();
    // 空态：跳转 clip Tab
    if (e.target.closest('[data-action="goto-clip"]')) {
      setActiveTab('clip');
      return;
    }
    // 条目点击：复制
    const item = e.target.closest('.clipfav-item[data-id]');
    if (item) {
      const id = item.dataset.id;
      if (await copyClipEntry(id)) {
        item.classList.add('copied');
        setTimeout(() => item.classList.remove('copied'), 800);
      }
    }
  });
  clipfavListEl.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.repeat) return;
    const item = e.target.closest('.clipfav-item[data-id]');
    if (!item) return;
    e.preventDefault();
    if (await copyClipEntry(item.dataset.id)) {
      item.classList.add('copied');
      setTimeout(() => item.classList.remove('copied'), 800);
    }
  });
}

// ============ 剪贴板历史 ============
const CLIP_HISTORY_KEY = 'notch-clip-history';
const CLIP_FAV_KEY = 'notch-clip-favorites';
const CLIP_MAX = 100;
const CLIP_URL_RE = /^https?:\/\//i;
const starOutlineSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';
const starFilledSvg = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></svg>';

function loadClipHistory() {
  try {
    const raw = localStorage.getItem(CLIP_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeClipEntry).filter(Boolean);
  } catch (e) {
    return [];
  }
}

function normalizeClipEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const type = ['text', 'url', 'image'].includes(entry.type) ? entry.type : 'text';
  const text = typeof entry.text === 'string' ? entry.text : null;
  const imagePath = typeof entry.imagePath === 'string' ? entry.imagePath : null;
  if (type === 'image' ? !imagePath : text === null) return null;
  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : generateId(),
    type,
    text,
    imagePath,
    timestamp: Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now(),
  };
}

function saveClipHistory(list) {
  try {
    localStorage.setItem(CLIP_HISTORY_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

function loadClipFavorites() {
  try {
    const raw = localStorage.getItem(CLIP_FAV_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p === 'string');
  } catch (e) {
    return [];
  }
}

function saveClipFavorites(list) {
  try {
    localStorage.setItem(CLIP_FAV_KEY, JSON.stringify(list));
  } catch (e) {
    // ignore quota errors
  }
}

let clipHistory = loadClipHistory();
let clipFavorites = loadClipFavorites();
let clipFilter = 'all'; // all | text | image | faved
const clipImageCache = new Map(); // imagePath -> dataUrl，仅内存

// 脏标记 —— 单调递增版本号：凡影响 renderClipList / renderClipFavs 输出的变更都自增。
// 宁可多自增（多一次重建）也不能漏（界面不更新）。
// 注意：preloadClipImage 在图片入缓存后也要自增，确保二次渲染不被脏标记挡掉。
let clipDataVersion = 0;
let lastRenderedClipVersion = -1; // renderClipList 上次渲染时的版本号
let lastRenderedFavsVersion = -1; // renderClipFavs 上次渲染时的版本号

const clipListEl = document.getElementById('clip-list');
const clipToolbarEl = document.getElementById('clip-toolbar');
const clipClearBtn = document.getElementById('clip-clear-btn');
let clipClearArmed = false;

// 防重入标志：renderClipList 内按需图片预加载完成后的二次渲染
let clipRenderPending = false;

async function preloadClipImage(imagePath) {
  if (!imagePath) return;
  if (clipImageCache.has(imagePath)) return;
  if (!window.notchAPI || typeof window.notchAPI.readClipImage !== 'function') return;
  try {
    const dataUrl = await window.notchAPI.readClipImage(imagePath);
    if (dataUrl) {
      clipImageCache.set(imagePath, dataUrl);
      clipDataVersion++; // 图片入缓存 → 版本自增，确保二次渲染不被脏标记挡掉（缩略图必须显示）
    }
  } catch (e) {
    // ignore read errors
  }
}

async function addClipEntry(raw) {
  const id = generateId();
  const entry = {
    id,
    type: raw.type || 'text',
    text: raw.text || null,
    imagePath: raw.imagePath || null,
    timestamp: Date.now(),
  };

  // 每一次系统复制都是独立历史事件；相同内容也必须保留为两条记录。
  const updated = window.NotchDomain.prependClipboardHistory(clipHistory, entry, CLIP_MAX);
  clipHistory = updated.history;
  const evicted = updated.evicted;
  if (evicted.length > 0) {
    const evictedPaths = evicted
      .filter((e) => e.type === 'image' && e.imagePath)
      .map((e) => e.imagePath);
    if (evictedPaths.length > 0) {
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages(evictedPaths).catch(() => {});
      }
      evictedPaths.forEach((p) => clipImageCache.delete(p));
    }
  }

  saveClipHistory(clipHistory);

  // 图片条目预加载缩略图
  if (entry.type === 'image' && entry.imagePath) {
    await preloadClipImage(entry.imagePath);
  }

  clipDataVersion++; // clipHistory 已变（含 FIFO 淘汰）
  renderClipList();
  renderClipFavs();
}

function formatClipTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} 小时前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function clipEntryHtml(entry, faved) {
  const favClass = faved ? ' faved' : '';
  const star = faved ? starFilledSvg : starOutlineSvg;
  const favLabel = faved ? '取消收藏' : '收藏';
  const timeStr = escapeHtml(formatClipTime(entry.timestamp));
  const safeId = escapeHtml(entry.id);

  if (entry.type === 'image') {
    const dataUrl = entry.imagePath ? clipImageCache.get(entry.imagePath) : null;
    const thumbHtml = dataUrl
      ? `<img class="clip-thumb" src="${escapeHtml(dataUrl)}" alt="图片" draggable="false"/>`
      : `<span class="clip-thumb-placeholder">图片加载中…</span>`;
    return `<div class="clip-item clip-item-image clip-type-image" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制图片">
    <span class="clip-thumb-wrap">${thumbHtml}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span></span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
  }

  // text | url 条目
  const safeText = escapeHtml(entry.text || '');
  const isUrl = entry.type === 'url' || (entry.text && CLIP_URL_RE.test(entry.text));
  const typeClass = isUrl ? 'clip-type-url' : 'clip-type-text';
  const accessiblePreview = escapeHtml(
    (entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '空白内容'
  );
  return `<div class="clip-item clip-item-text ${typeClass}" data-id="${safeId}">
  <button class="clip-copy-target" type="button" data-action="copy" aria-label="复制：${accessiblePreview}">
    <span class="clip-text">${safeText}</span>
    <span class="clip-meta"><span class="clip-time">${timeStr}</span></span>
  </button>
  <button class="clip-fav-btn${favClass}" type="button" data-action="fav" aria-label="${favLabel}">${star}</button>
  <button class="clip-del-btn" type="button" data-action="delete" aria-label="删除">×</button>
</div>`;
}

function getFilteredClipItems() {
  if (clipFilter === 'all') return clipHistory;
  if (clipFilter === 'text') return clipHistory.filter((e) => e.type === 'text' || e.type === 'url');
  if (clipFilter === 'image') return clipHistory.filter((e) => e.type === 'image');
  if (clipFilter === 'faved') {
    const favSet = new Set(clipFavorites);
    return clipHistory.filter((e) => favSet.has(e.id));
  }
  return clipHistory;
}

function renderClipList() {
  if (!clipListEl) return;
  // 脏标记：数据/过滤器/图片缓存均未变则跳过全量重建
  if (clipDataVersion === lastRenderedClipVersion) return;

  const items = getFilteredClipItems();
  const favSet = new Set(clipFavorites);

  if (items.length === 0) {
    clipListEl.innerHTML =
      '<div class="clip-empty">' +
      (clipHistory.length ? '没有符合条件的记录' : '复制点什么，历史会出现在这里') +
      '</div>';
    lastRenderedClipVersion = clipDataVersion; // 空态也标记已渲染
    return;
  }

  clipListEl.innerHTML = items.map((e) => clipEntryHtml(e, favSet.has(e.id))).join('');
  lastRenderedClipVersion = clipDataVersion; // 标记本次渲染版本（在预加载之前）

  // 按需预加载图片：收集当前 items 里 cache 未命中的 image 条目
  // preloadClipImage 成功后自增 clipDataVersion，确保二次渲染不被脏标记挡掉
  if (clipRenderPending) return; // 防重入：已有预加载任务在途
  const missingPaths = items
    .filter((e) => e.type === 'image' && e.imagePath && !clipImageCache.has(e.imagePath))
    .map((e) => e.imagePath);

  if (missingPaths.length === 0) return;

  clipRenderPending = true;
  Promise.all(missingPaths.map((p) => preloadClipImage(p)))
    .then(() => {
      clipRenderPending = false;
      // 只有至少有一条路径成功填入 cache 才重渲，避免无意义刷新
      const anyLoaded = missingPaths.some((p) => clipImageCache.has(p));
      if (anyLoaded) renderClipList();
    })
    .catch(() => {
      clipRenderPending = false;
    });
}

// ---- 工具栏事件委托 ----
if (clipToolbarEl) {
  clipToolbarEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const filterBtn = e.target.closest('.clip-filter');
    if (filterBtn) {
      clipFilter = filterBtn.dataset.filter || 'all';
      clipToolbarEl.querySelectorAll('.clip-filter').forEach((b) => {
        const selected = b === filterBtn;
        b.classList.toggle('active', selected);
        b.setAttribute('aria-pressed', String(selected));
      });
      clipDataVersion++; // clipFilter 已变 → 输出变化
      renderClipList();
      return;
    }
    if (e.target.closest('#clip-clear-btn')) {
      requestClearClipHistory();
    }
  });
  clipToolbarEl.querySelectorAll('.clip-filter').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.classList.contains('active')));
  });
}

// ---- 列表事件委托 ----
if (clipListEl) {
  clipListEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const item = e.target.closest('.clip-item');
    if (!item) return;
    const id = item.dataset.id;
    if (!id) return;

    // 优先判断子按钮
    const favoriteButton = e.target.closest('.clip-fav-btn');
    if (favoriteButton) {
      toggleClipFavorite(id, {
        restoreFocus: document.activeElement === favoriteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    const deleteButton = e.target.closest('.clip-del-btn');
    if (deleteButton) {
      deleteClipEntry(id, {
        restoreFocus: document.activeElement === deleteButton,
        nextId: item.nextElementSibling && item.nextElementSibling.dataset.id,
        previousId: item.previousElementSibling && item.previousElementSibling.dataset.id,
      });
      return;
    }
    if (e.target.closest('[data-action="copy"]')) copyClipEntry(id);
  });
}

function focusClipControl(ids, action = 'copy') {
  if (!clipListEl) return;
  for (const id of ids.filter(Boolean)) {
    const target = clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="${action}"]`
    );
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
  }
  const activeFilter = clipToolbarEl && clipToolbarEl.querySelector('.clip-filter.active');
  if (activeFilter) activeFilter.focus({ preventScroll: true });
}

function toggleClipFavorite(id, focusContext = null) {
  const idx = clipFavorites.indexOf(id);
  if (idx === -1) {
    clipFavorites.push(id);
  } else {
    clipFavorites.splice(idx, 1);
  }
  clipDataVersion++; // clipFavorites 已变
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    const sameItemButton = clipListEl && clipListEl.querySelector(
      `.clip-item[data-id="${CSS.escape(id)}"] [data-action="fav"]`
    );
    if (sameItemButton) {
      sameItemButton.focus({ preventScroll: true });
    } else {
      focusClipControl([focusContext.nextId, focusContext.previousId]);
    }
  }
}

function deleteClipEntry(id, focusContext = null) {
  const idx = clipHistory.findIndex((e) => e.id === id);
  if (idx === -1) return;
  const entry = clipHistory[idx];
  const favoriteIndex = clipFavorites.indexOf(id);
  clipHistory.splice(idx, 1);
  clipFavorites = clipFavorites.filter((fid) => fid !== id);
  clipDataVersion++; // clipHistory + clipFavorites 已变
  saveClipHistory(clipHistory);
  saveClipFavorites(clipFavorites);
  renderClipList();
  renderClipFavs();
  if (focusContext && focusContext.restoreFocus) {
    focusClipControl([focusContext.nextId, focusContext.previousId]);
  }
  showStatusToast('已删除剪贴记录', {
    actionLabel: '撤销',
    duration: 5000,
    onAction: () => {
      if (clipHistory.some((item) => item.id === id)) return;
      clipHistory.splice(Math.min(idx, clipHistory.length), 0, entry);
      if (favoriteIndex !== -1) {
        clipFavorites.splice(Math.min(favoriteIndex, clipFavorites.length), 0, id);
      }
      clipDataVersion++;
      saveClipHistory(clipHistory);
      saveClipFavorites(clipFavorites);
      renderClipList();
      renderClipFavs();
      focusClipControl([id]);
      showStatusToast('已撤销删除');
    },
    onExpire: () => {
      if (entry.type !== 'image' || !entry.imagePath) return;
      clipImageCache.delete(entry.imagePath);
      if (window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
        window.notchAPI.deleteClipImages([entry.imagePath]).catch(() => {});
      }
    },
  });
}

function resetClipClearConfirmation() {
  clipClearArmed = false;
  if (clipClearBtn) {
    clipClearBtn.classList.remove('confirming');
    clipClearBtn.setAttribute('aria-label', '清空历史');
  }
}

function requestClearClipHistory() {
  if (clipHistory.length === 0) {
    showStatusToast('剪贴板历史已是空的');
    return;
  }
  if (!clipClearArmed) {
    clipClearArmed = true;
    if (clipClearBtn) {
      clipClearBtn.classList.add('confirming');
      clipClearBtn.setAttribute('aria-label', `再次点击确认清空 ${clipHistory.length} 条历史`);
    }
    showStatusToast(`再点一次垃圾桶，清空 ${clipHistory.length} 条记录`, {
      duration: 3000,
      onExpire: resetClipClearConfirmation,
    });
    return;
  }
  resetClipClearConfirmation();
  clearClipHistory();
}

if (clipClearBtn) {
  clipClearBtn.addEventListener('keydown', (event) => {
    if (event.repeat && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
    }
  });
}

function clearClipHistory() {
  const removedCount = clipHistory.length;
  const imagePaths = clipHistory
    .filter((e) => e.type === 'image' && e.imagePath)
    .map((e) => e.imagePath);
  clipHistory = [];
  clipFavorites = [];
  clipImageCache.clear();
  clipDataVersion++; // 全部数据已清空
  saveClipHistory([]);
  saveClipFavorites([]);
  if (imagePaths.length > 0 && window.notchAPI && typeof window.notchAPI.deleteClipImages === 'function') {
    window.notchAPI.deleteClipImages(imagePaths).catch(() => {});
  }
  renderClipList();
  renderClipFavs();
  showStatusToast(`已清空 ${removedCount} 条剪贴记录`);
}

async function copyClipEntry(id) {
  const entry = clipHistory.find((e) => e.id === id);
  if (!entry) return false;
  if (!window.notchAPI) return false;
  try {
    const result = typeof window.notchAPI.pasteClipboard === 'function'
      ? await window.notchAPI.pasteClipboard(entry)
      : { ok: await window.notchAPI.writeClipboard(entry), pasted: false };
    if (!result?.ok) {
      showStatusToast('复制失败，请重试');
      return false;
    }
    showStatusToast(result.pasted
      ? '已填入刚才的输入框'
      : result.permissionRequired
        ? '请开启辅助功能权限；内容已复制'
        : entry.type === 'image' ? '图片已复制，可直接粘贴' : '已复制，可直接粘贴');
  } catch (e) {
    showStatusToast('复制失败，请重试');
    return false;
  }
  // 视觉反馈：800ms 后移除 copied 类
  const itemEl = clipListEl && clipListEl.querySelector(`.clip-item[data-id="${CSS.escape(id)}"]`);
  if (itemEl) {
    itemEl.classList.add('copied');
    setTimeout(() => itemEl.classList.remove('copied'), 800);
  }
  return true;
}

// ---- IPC 推送监听 ----
if (window.notchAPI && typeof window.notchAPI.onNewClipEntry === 'function') {
  window.notchAPI.onNewClipEntry((raw) => {
    addClipEntry(raw);
  });
}

renderTodayCard();
renderClipList(); // 首屏确保 clip-list DOM 就绪时渲染一次（幂等）
renderClipFavs(); // 首屏渲染收藏剪贴块
initTab();
