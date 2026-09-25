// 刘海下沿状态：每秒汇总专注、录音、日程、额度等，只显示最要紧的一条（规则见 notch-status-domain.js）。
// 有状态时先让主进程把收起的窗口加高 24pt，再让下沿长出来；没状态时先收回下沿，再恢复窗口。
(function bootstrapNotchStatus() {
  'use strict';

  const Status = window.NotchStatus;
  const get = (id) => document.getElementById(id);
  const app = get('app');
  const notch = get('notch');
  const view = get('notch-status');
  if (!Status || !app || !notch || !view) return;

  const TICK_MS = 1000;
  const SHRINK_MS = 300;
  const els = { text: get('notch-status-text'), detail: get('notch-status-detail'), progress: get('notch-status-progress') };
  const api = () => window.notchAPI || {};

  let needsYou = null;
  let offwork = null;
  let current = null;
  let shown = false;
  let generation = 0;
  let pendingTarget = '';

  function gather() {
    const quota = [
      { name: 'Codex', remaining: window.NotchCodexUsage?.remaining?.() ?? null },
      { name: 'Claude', remaining: window.NotchAiUsageState?.claudeRemaining?.() ?? null },
    ].filter((item) => Number.isFinite(item.remaining));
    return {
      needsYou,
      recording: window.NotchWorkspace?.recordingState?.() || null,
      pomodoro: window.NotchPomodoro?.state?.() || null,
      quota,
      events: window.NotchTodayStrip?.events?.() || [],
      later: window.NotchTodayStrip?.later?.() || [],
      offwork,
    };
  }

  function fill(status) {
    view.dataset.kind = status.kind;
    view.dataset.icon = status.icon;
    view.dataset.tone = status.tone;
    view.dataset.progress = status.progress === null ? 'false' : 'true';
    app.dataset.notchTone = status.tone;
    els.text.textContent = status.text;
    els.detail.textContent = status.detail;
    if (status.progress !== null) els.progress.style.width = `${Math.round(Math.max(0, Math.min(1, status.progress)) * 1000) / 10}%`;
    notch.setAttribute('aria-label', `展开 SoloDock · ${status.text}${status.detail ? ` ${status.detail}` : ''}`);
  }

  async function show(status) {
    fill(status);
    if (shown) return;
    shown = true;
    const token = ++generation;
    view.hidden = false;
    // 窗口先加高（瞬时、透明），下沿再用 CSS 长出来，避免被窗口边界裁掉。
    await api().setNotchStatus?.(true)?.catch?.(() => false);
    if (token !== generation) return;
    app.classList.add('has-notch-status');
  }

  function hide() {
    if (!shown) return;
    shown = false;
    const token = ++generation;
    app.classList.remove('has-notch-status');
    delete app.dataset.notchTone;
    notch.setAttribute('aria-label', '展开 SoloDock');
    setTimeout(() => {
      if (token !== generation) return;
      view.hidden = true;
      api().setNotchStatus?.(false)?.catch?.(() => {});
    }, SHRINK_MS);
  }

  function tick() {
    const status = Status.pickNotchStatus(gather(), Date.now());
    current = status;
    if (status) show(status);
    else hide();
  }

  // 点有状态的下沿：展开后直接去对应位置。
  notch.addEventListener('click', () => {
    pendingTarget = shown && current ? current.target : '';
  }, true);
  document.addEventListener('notch:modechange', (event) => {
    if (event.detail?.expanded && pendingTarget) {
      const target = pendingTarget;
      pendingTarget = '';
      if (typeof window.setActiveTab === 'function') window.setActiveTab(target);
    }
    if (!event.detail?.expanded) tick();
  });

  // 右键：原生快捷菜单（暂停专注、结束录音、稍后提醒…、打开设置）。
  notch.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const pomodoro = window.NotchPomodoro?.state?.();
    const recording = window.NotchWorkspace?.recordingState?.();
    api().showNotchMenu?.({
      pomodoro: pomodoro?.started ? (pomodoro.running ? 'running' : 'paused') : '',
      recording: Boolean(recording && ['recording', 'paused'].includes(recording.status)),
    })?.catch?.(() => {});
  });

  async function openPanel(tab) {
    if (!app.classList.contains('expanded') && typeof window.setMode === 'function') await window.setMode(true);
    if (tab && typeof window.setActiveTab === 'function') window.setActiveTab(tab);
  }

  api().onNotchMenuAction?.((payload) => {
    const action = payload?.action;
    if (action === 'pomodoro-toggle') window.NotchPomodoro?.toggle?.();
    else if (action === 'stop-recording') window.NotchWorkspace?.stopRecording?.();
    else if (action === 'settings') openPanel('settings');
    else if (action === 'later') {
      const at = window.NotchTodayStrip?.addLater?.(payload.value);
      if (at) api().notifyReminderInfo?.({ title: `将在 ${Status.clock(at)} 提醒你`, detail: '到点会在这里弹出提醒' })?.catch?.(() => {});
    }
    tick();
  });

  // AI 需要你确认：主进程收到 Claude Code 的权限请求时推送。
  api().onNeedsYou?.((state) => {
    needsYou = state && state.title ? state : null;
    tick();
  });
  api().getNeedsYou?.()?.then?.((state) => {
    needsYou = state && state.title ? state : null;
    tick();
  })?.catch?.(() => {});

  // 收工时间来自「设置 → 身体与作息」。
  async function loadOffwork() {
    const settings = await api().getAppSettings?.()?.catch?.(() => null);
    if (settings?.body?.offwork) offwork = settings.body.offwork;
  }
  loadOffwork();
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'settings') setTimeout(loadOffwork, 1000);
  });

  const timer = setInterval(tick, TICK_MS);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  tick();

  window.NotchNotchStatus = {
    tick,
    current: () => (current ? { ...current } : null),
    setOffwork: (value) => { offwork = value; tick(); },
    setNeedsYou: (value) => { needsYou = value; tick(); },
  };
})();
