// 首页「现在」与「精力」两张卡片。
// 现在：当前这件事（「在做」或今天最急的一件）、番茄钟、接下来、记一笔。
// 精力：今天在电脑前多久、距离上次休息、今天专注、收工与最近 7 天；只陈述事实，不和平时比。
(function setupHome() {
  'use strict';

  const Home = window.NotchHomeDomain;
  const get = (id) => document.getElementById(id);
  const nowCard = get('home-now');
  const energyCard = get('home-energy');
  if (!Home || !nowCard) return;

  const FOCUS_LOG_KEY = 'notch-focus-log-v1';
  const EVENTS_KEY = 'notch-events-v1';
  const REFRESH_MS = 30_000;
  const PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" /></svg>';
  const PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" /><rect x="13.5" y="5" width="4" height="14" rx="1.2" /></svg>';

  const el = {
    label: get('now-label'),
    meta: get('now-meta'),
    idle: get('now-idle'),
    running: get('now-running'),
    chip: get('now-task-chip'),
    title: get('now-task-title'),
    due: get('now-task-due'),
    disc: get('now-disc'),
    duration: get('now-duration'),
    start: get('now-start'),
    switcher: get('now-switch'),
    next: get('now-next-list'),
    bigDisc: get('now-disc-big'),
    peek: get('now-peek'),
    runChip: get('now-running-chip'),
    runTitle: get('now-running-title'),
    runDue: get('now-running-due'),
    tomatoes: get('now-tomatoes'),
    pause: get('now-pause'),
    extend: get('now-extend'),
    finish: get('now-finish'),
    held: get('now-held'),
    heldText: get('now-held-text'),
    capture: get('now-capture'),
    captureInput: get('now-capture-input'),
    captureKey: get('now-capture-key'),
    picker: get('now-picker'),
  };

  let heldCount = 0;
  let lastPhase = '';
  let lastTomatoes = 0;
  let energyStatus = null;
  let energyDays = {};
  let energyEnabled = true;
  let energyLoading = false;

  const pomodoro = () => window.NotchPomodoro;
  const todos = () => window.NotchTodos;
  const toast = (message, options) => { if (typeof window.showStatusToast === 'function') window.showStatusToast(message, options); };

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function visible() {
    return document.visibilityState !== 'hidden'
      && get('app')?.classList.contains('expanded')
      && get('tab-home')?.classList.contains('active');
  }

  function todayKey(now = Date.now()) {
    return window.NotchWorklog ? window.NotchWorklog.dayKey(now) : new Date(now).toISOString().slice(0, 10);
  }

  function dayStart(now = Date.now()) {
    return window.NotchWorklog ? window.NotchWorklog.dayStart(todayKey(now)) : new Date(new Date(now).setHours(4, 0, 0, 0)).getTime();
  }

  function focusStats(now = Date.now()) {
    return Home.focusToday(readJson(FOCUS_LOG_KEY, []), dayStart(now));
  }

  function todayItems(now = Date.now()) {
    const store = todos();
    if (!store || !window.NotchDomain?.todayTodoItems) return [];
    return window.NotchDomain.todayTodoItems(store.items(), now, store.categories().map((category) => category.id));
  }

  // 「现在」这件事，也供计时器开始专注时带上。
  function currentTask(now = Date.now()) {
    return Home.currentTask({ doing: todos()?.doing?.() || null, today: todayItems(now) });
  }

  // ---------------- 现在：空闲 ----------------
  function paintChip(chip, categoryId) {
    const name = categoryId ? todos()?.categoryName?.(categoryId) : '';
    chip.hidden = !name;
    if (!name) return;
    chip.textContent = name;
    chip.style.setProperty('--chip', `var(--sd-${todos().categoryColor(categoryId)})`);
  }

  function paintDue(target, deadline, now) {
    const line = Home.dueLine(deadline, now);
    target.replaceChildren();
    target.hidden = !line;
    if (!line) return;
    const lead = document.createElement('b');
    lead.textContent = line.lead;
    if (line.tone) lead.dataset.tone = line.tone;
    target.append(lead);
    if (line.rest) target.append(` · ${line.rest}`);
  }

  // ---------------- 时间圆盘 ----------------
  // 仿实体 Time Timer：一圈是 60 分钟，60 格刻度（每 5 分钟一格长刻度，一刻钟最长），扇形是剩下的时间。
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WEDGE_R = 38;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let discSeq = 0;

  function svgNode(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (parent) parent.append(node);
    return node;
  }

  function buildDisc(host) {
    if (!host) return null;
    const id = `now-disc-${++discSeq}`;
    const root = svgNode('svg', { viewBox: '0 0 100 100', class: 'now-disc-svg', 'aria-hidden': 'true' });
    const defs = svgNode('defs', {}, root);
    for (const [tone, from, to] of [['focus', '#86bdf6', '#2f6fca'], ['paused', '#bdcadb', '#8fa2ba'], ['break', '#a6e3cb', '#3da67f']]) {
      const gradient = svgNode('linearGradient', { id: `${id}-${tone}`, x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
      svgNode('stop', { offset: 0, 'stop-color': from }, gradient);
      svgNode('stop', { offset: 1, 'stop-color': to }, gradient);
    }
    const face = svgNode('radialGradient', { id: `${id}-face`, cx: 0.4, cy: 0.32, r: 0.75 }, defs);
    svgNode('stop', { offset: 0, 'stop-color': '#ffffff' }, face);
    svgNode('stop', { offset: 1, 'stop-color': '#e6effb' }, face);
    svgNode('circle', { cx: 50, cy: 50, r: 48.5, class: 'now-disc-face', fill: `url(#${id}-face)` }, root);
    svgNode('circle', { cx: 50, cy: 50, r: 47.4, class: 'now-disc-shine' }, root);
    const ticks = svgNode('g', { class: 'now-disc-ticks' }, root);
    for (let index = 0; index < 60; index += 1) {
      const angle = (index / 60) * Math.PI * 2 - Math.PI / 2;
      const inner = index % 15 === 0 ? 40.5 : index % 5 === 0 ? 42 : 44;
      svgNode('line', {
        x1: (50 + Math.cos(angle) * 46).toFixed(2), y1: (50 + Math.sin(angle) * 46).toFixed(2),
        x2: (50 + Math.cos(angle) * inner).toFixed(2), y2: (50 + Math.sin(angle) * inner).toFixed(2),
        class: index % 5 === 0 ? 'major' : 'minor',
      }, ticks);
    }
    const wedge = svgNode('path', { class: 'now-disc-wedge', fill: `url(#${id}-focus)`, d: '' }, root);
    const overflow = svgNode('circle', { cx: 50, cy: 50, r: 41.5, class: 'now-disc-overflow', pathLength: 100, 'stroke-dasharray': '0 100' }, root);
    svgNode('circle', { cx: 50, cy: 50, r: 6.5, class: 'now-disc-knob' }, root);
    host.prepend(root);
    return { id, wedge, overflow, fraction: null, tone: 'focus', frame: 0 };
  }

  // seconds 是扇形代表的时间；animate 时扇形用 0.32 秒缓动到新大小（换时长时用）。
  function paintDisc(disc, seconds, tone, animate = false) {
    if (!disc) return;
    const { fraction, overflow } = Home.discFraction(seconds);
    if (disc.tone !== tone) {
      disc.wedge.setAttribute('fill', `url(#${disc.id}-${tone})`);
      disc.tone = tone;
    }
    disc.overflow.setAttribute('stroke-dasharray', `${(overflow * 100).toFixed(2)} 100`);
    const from = disc.fraction === null ? fraction : disc.fraction;
    disc.fraction = fraction;
    cancelAnimationFrame(disc.frame);
    if (!animate || reducedMotion || Math.abs(from - fraction) < 0.002) {
      disc.wedge.setAttribute('d', Home.wedgePath(50, 50, WEDGE_R, fraction));
      return;
    }
    const started = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - started) / 320);
      const eased = 1 - Math.pow(1 - k, 3);
      disc.wedge.setAttribute('d', Home.wedgePath(50, 50, WEDGE_R, from + (fraction - from) * eased));
      if (k < 1) disc.frame = requestAnimationFrame(step);
    };
    disc.frame = requestAnimationFrame(step);
  }

  const idleDisc = buildDisc(el.disc);
  const runningDisc = buildDisc(el.bigDisc);

  function renderIdle(now) {
    const task = currentTask(now);
    const minutes = pomodoro()?.minutes?.() || Home.DEFAULT_FOCUS_MINUTES;
    const { tomatoes } = focusStats(now);
    el.label.textContent = '现在';
    el.meta.innerHTML = `今天第 <b>${tomatoes + 1}</b> 个番茄`;
    if (task) {
      paintChip(el.chip, task.categoryId);
      el.title.textContent = task.text;
      el.title.title = task.text;
      paintDue(el.due, task.deadline, now);
    } else {
      el.chip.hidden = true;
      el.title.textContent = '现在没有要赶的事';
      el.title.title = '';
      el.due.hidden = false;
      el.due.textContent = '挑一件事，或者直接开始专注';
    }
    el.switcher.textContent = task ? '换一件事' : '选一件事';
    paintDisc(idleDisc, minutes * 60, 'focus', true);
    el.disc.setAttribute('aria-label', `专注 ${minutes} 分钟`);
    el.duration.querySelectorAll('[data-minutes]').forEach((button) => {
      const on = Number(button.dataset.minutes) === minutes;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
    });
    renderNext(now, task);
  }

  function renderNext(now, task) {
    const events = window.NotchTodayStrip?.events?.() || readJson(EVENTS_KEY, []);
    const items = Home.upcoming({ events, todos: todayItems(now), now, excludeId: task?.id || '', limit: 2 });
    el.next.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'now-next-empty';
      empty.textContent = '今天接下来没有日程和截止';
      el.next.append(empty);
      return;
    }
    for (const item of items) {
      const row = document.createElement('li');
      row.className = 'now-next-row';
      row.dataset.kind = item.kind;
      const dot = document.createElement('i');
      const time = document.createElement('b');
      time.textContent = item.time;
      const title = document.createElement('span');
      title.textContent = item.title;
      title.title = item.title;
      const note = document.createElement('em');
      note.textContent = item.note;
      row.append(dot, time, title, note);
      el.next.append(row);
    }
  }

  // ---------------- 现在：专注中 / 休息中 ----------------
  function phaseOf(state) {
    if (!state || !state.started) return 'idle';
    if (state.mode === 'break') return 'break';
    return state.running ? 'running' : 'paused';
  }

  function renderRunning(state, now) {
    const phase = phaseOf(state);
    const isBreak = phase === 'break';
    const { tomatoes } = focusStats(now);
    el.label.textContent = isBreak ? '休息中' : phase === 'paused' ? '已暂停' : '专注中';
    const end = state.running ? `<b>${Home.clock(state.endsAt)}</b> 结束` : '已暂停';
    el.meta.innerHTML = isBreak ? end : `第 ${tomatoes + 1} 个番茄 · ${end}`;
    if (isBreak) {
      el.runChip.hidden = true;
      el.runTitle.textContent = '离开屏幕，走动一下';
      el.runDue.hidden = false;
      el.runDue.textContent = '喝口水，看看远处，回来再继续';
    } else if (state.task) {
      paintChip(el.runChip, state.task.categoryId);
      el.runTitle.textContent = state.task.text;
      paintDue(el.runDue, state.task.deadline, now);
    } else {
      el.runChip.hidden = true;
      el.runTitle.textContent = '自由专注';
      el.runDue.hidden = false;
      el.runDue.textContent = '这段时间只做一件事';
    }
    el.tomatoes.hidden = isBreak;
    el.pause.innerHTML = `${state.running ? PAUSE_ICON : PLAY_ICON}${state.running ? '暂停' : '继续'}`;
    el.pause.setAttribute('aria-label', state.running ? (isBreak ? '暂停休息' : '暂停专注') : '继续');
    el.extend.hidden = isBreak;
    el.finish.textContent = isBreak ? '结束休息' : '结束';
    lastTomatoes = tomatoes;
    tick(state);
  }

  // 每秒只更新圆盘扇形、悬停提示与当前这个番茄的进度（完成数在切换状态时已经算好）。
  function tick(state, tomatoes = lastTomatoes) {
    const fraction = state.remaining / Math.max(1, state.session);
    const tone = state.mode === 'break' ? 'break' : state.running ? 'focus' : 'paused';
    paintDisc(runningDisc, state.remaining, tone);
    const left = Home.remainingText(state.remaining, state.mode);
    el.peek.textContent = left;
    el.bigDisc.setAttribute('aria-label', state.running ? `${left}，${Home.clock(state.endsAt)} 结束` : `已暂停，${left}`);
    if (state.mode !== 'break') renderTomatoes(tomatoes, 1 - fraction);
  }

  function renderTomatoes(done, progress) {
    const shown = Math.min(done, 7);
    const bars = [];
    for (let index = 0; index < shown; index += 1) bars.push('<i class="done"></i>');
    bars.push(`<i class="now" style="--p: ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%"></i>`);
    const label = done ? `今天已完成 ${done} 个` : '这是今天第 1 个';
    el.tomatoes.innerHTML = `${bars.join('')}<span>${label}</span>`;
  }

  function renderHeld(state) {
    const show = heldCount > 0 && state && state.started && state.mode === 'focus';
    el.held.hidden = !show;
    if (show) el.heldText.textContent = `收起了 ${heldCount} 条 AI 完成通知，专注结束后一起告诉你`;
  }

  function renderNow() {
    const now = Date.now();
    const state = pomodoro()?.state?.() || { started: false };
    const phase = phaseOf(state);
    lastPhase = `${phase}|${state.session}|${state.task?.id || ''}`;
    nowCard.dataset.state = phase;
    el.idle.hidden = phase !== 'idle';
    el.running.hidden = phase === 'idle';
    if (phase === 'idle') renderIdle(now);
    else renderRunning(state, now);
    renderHeld(state);
  }

  // ---------------- 换一件事 ----------------
  function pickerItems(now = Date.now()) {
    const store = todos();
    if (!store) return [];
    const today = todayItems(now);
    const todayIds = new Set(today.map((item) => item.id));
    const rest = store.list()
      .filter((item) => !item.done && !todayIds.has(String(item.id)))
      .map((item) => ({ id: String(item.id), text: String(item.text || ''), categoryId: item.categoryId, due: Date.parse(item.deadline || ''), createdAt: Number(item.createdAt) || 0 }))
      .sort((left, right) => (Number.isFinite(left.due) ? left.due : Infinity) - (Number.isFinite(right.due) ? right.due : Infinity) || right.createdAt - left.createdAt);
    return [...today.map((item) => ({ id: item.id, text: item.text, categoryId: item.priority, due: item.due })), ...rest].slice(0, 6);
  }

  function closePicker() {
    if (el.picker.hidden) return false;
    el.picker.hidden = true;
    el.switcher.setAttribute('aria-expanded', 'false');
    return true;
  }

  // 贴着「换一件事」按钮：下面放得下就放下面，否则放上面；始终留在卡片里面（卡片会裁掉溢出的部分）。
  function placePicker() {
    const card = nowCard.getBoundingClientRect();
    const anchor = el.switcher.getBoundingClientRect();
    const width = el.picker.offsetWidth;
    const height = el.picker.offsetHeight;
    const gap = 6;
    const below = anchor.bottom - card.top + gap;
    const above = anchor.top - card.top - gap - height;
    const top = below + height <= card.height - 8 ? below : Math.max(8, above);
    const left = Math.max(8, Math.min(anchor.left - card.left, card.width - width - 8));
    el.picker.style.top = `${Math.round(Math.min(top, card.height - height - 8))}px`;
    el.picker.style.left = `${Math.round(left)}px`;
  }

  function openPicker() {
    const now = Date.now();
    const store = todos();
    const doingId = store?.doing?.()?.id || '';
    const items = pickerItems(now);
    el.picker.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'now-picker-empty';
      empty.textContent = '待办是空的';
      el.picker.append(empty);
    }
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(item.id === doingId));
      button.dataset.id = item.id;
      const dot = document.createElement('i');
      dot.style.setProperty('--chip', `var(--sd-${store.categoryColor(item.categoryId)})`);
      const text = document.createElement('span');
      text.textContent = item.text;
      const due = document.createElement('em');
      due.textContent = Home.shortDue(item.due, now);
      button.append(dot, text, due);
      el.picker.append(button);
    }
    const footer = document.createElement('button');
    footer.type = 'button';
    footer.className = 'now-picker-more';
    footer.dataset.action = 'todo';
    footer.textContent = items.length ? '去待办页 ›' : '去添加待办 ›';
    el.picker.append(footer);
    el.picker.hidden = false;
    placePicker();
    el.switcher.setAttribute('aria-expanded', 'true');
    el.picker.querySelector('[aria-checked="true"], button')?.focus({ preventScroll: true });
  }

  el.switcher.addEventListener('click', () => (el.picker.hidden ? openPicker() : closePicker()));
  el.picker.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    closePicker();
    if (button.dataset.action === 'todo') {
      window.setActiveTab?.('todo');
      return;
    }
    const store = todos();
    if (store && store.doing()?.id !== button.dataset.id) store.setDoing(button.dataset.id);
    renderNow();
  });
  el.picker.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...el.picker.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!el.picker.hidden && !el.picker.contains(event.target) && !el.switcher.contains(event.target)) closePicker();
  }, true);

  // ---------------- 专注控制 ----------------
  el.duration.addEventListener('click', (event) => {
    const button = event.target.closest('[data-minutes]');
    if (!button) return;
    pomodoro()?.setMinutes(Number(button.dataset.minutes));
    renderNow();
  });
  el.duration.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const choices = Home.FOCUS_CHOICES;
    const current = choices.indexOf(pomodoro()?.minutes?.());
    const next = choices[Math.max(0, Math.min(choices.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)))];
    pomodoro()?.setMinutes(next);
    renderNow();
    el.duration.querySelector(`[data-minutes="${next}"]`)?.focus();
  });
  el.start.addEventListener('click', () => {
    const timer = pomodoro();
    if (!timer) return;
    closePicker();
    timer.start(timer.minutes() * 60, 'focus', { task: currentTask() });
  });
  el.pause.addEventListener('click', () => {
    const timer = pomodoro();
    if (!timer) return;
    if (timer.state().running) timer.pause();
    else timer.resume();
  });
  el.extend.addEventListener('click', () => pomodoro()?.extend(300));
  el.finish.addEventListener('click', () => pomodoro()?.finish());

  // ---------------- 记一笔 ----------------
  el.capture.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = el.captureInput.value.trim();
    if (!text) return;
    if (!window.NotchCaptureApply) {
      toast('没存上，请稍后再试');
      return;
    }
    const saved = await window.NotchCaptureApply.apply({ text, at: Date.now() });
    if (saved) {
      el.captureInput.value = '';
      renderNow();
    }
  });

  function showCaptureShortcut(settings) {
    const accelerator = settings?.captureShortcut ?? 'Alt+Shift+N';
    el.captureKey.hidden = !accelerator;
    if (accelerator) el.captureKey.textContent = window.NotchCapture?.shortcutLabel?.(accelerator) || accelerator;
  }
  window.notchAPI?.getAppSettings?.()?.then?.(showCaptureShortcut)?.catch?.(() => {});
  window.notchAPI?.onAppSettingsChanged?.(showCaptureShortcut);

  // ---------------- 精力 ----------------
  const energy = energyCard ? {
    state: get('energy-state'),
    body: get('energy-body'),
    off: get('energy-off'),
    total: get('energy-total'),
    track: get('energy-track'),
    ticks: get('energy-ticks'),
    breakRow: get('energy-break'),
    breakValue: get('energy-break-value'),
    breakMeter: get('energy-break-meter'),
    rest: get('energy-rest'),
    focus: get('energy-focus'),
    offworkRow: get('energy-offwork'),
    offworkValue: get('energy-offwork-value'),
    bars: get('energy-bars'),
    days: get('energy-days'),
    weekNote: get('energy-week-note'),
  } : null;

  function renderEnergy() {
    if (!energy) return;
    const now = Date.now();
    const state = pomodoro()?.state?.() || null;
    const running = state && state.started && state.mode === 'focus';
    const view = Home.energyView({
      now,
      todayKey: todayKey(now),
      days: energyDays,
      enabled: energyEnabled && energyStatus?.worklogEnabled !== false,
      activeSince: energyStatus ? energyStatus.activeSince : null,
      focus: state && state.started ? { running: state.running, mode: state.mode, elapsedMinutes: state.elapsedMinutes } : null,
      focusMinutesToday: focusStats(now).minutes + (running ? state.elapsedMinutes : 0),
      breakMinutes: energyStatus?.breakMinutes,
      offwork: energyStatus?.offwork,
    });
    energy.body.hidden = !view.enabled;
    energy.off.hidden = view.enabled;
    energyCard.dataset.state = view.enabled ? 'on' : 'off';
    if (!view.enabled) {
      energy.state.textContent = '未开启';
      energy.state.dataset.tone = 'muted';
      return;
    }
    energy.state.textContent = view.state.text;
    energy.state.dataset.tone = view.state.tone;
    energy.total.innerHTML = view.parts.map((part) => `${part.value}<small>${part.unit}</small>`).join('');
    energy.track.innerHTML = view.track.segments
      .map((segment) => `<i class="${segment.kind}" style="left: ${segment.left}%; width: ${segment.width}%"></i>`)
      .join('') + `<b style="left: ${view.track.now}%"></b>`;
    energy.track.setAttribute('aria-label', `今天 ${view.track.startHour} 点到 ${view.track.endHour % 24} 点：浅色是在用电脑，深色是专注`);
    energy.ticks.innerHTML = view.track.ticks.map((tickLabel) => `<span>${tickLabel}</span>`).join('');
    energy.breakValue.textContent = view.sinceBreak.text;
    energy.breakRow.classList.toggle('warn', view.sinceBreak.warn);
    energy.breakRow.classList.toggle('has-meter', view.sinceBreak.fraction !== null);
    energy.breakMeter.style.width = `${Math.round((view.sinceBreak.fraction || 0) * 100)}%`;
    energy.rest.hidden = !view.canRest;
    energy.focus.textContent = view.focusText;
    energy.offworkRow.hidden = !view.offwork;
    if (view.offwork) {
      energy.offworkValue.textContent = view.offwork.text;
      energy.offworkRow.classList.toggle('warn', view.offwork.passed);
    }
    energy.bars.innerHTML = view.week
      .map((bar) => `<i class="${bar.kind}${bar.long ? ' long' : ''}" style="height: ${bar.height}%" title="${bar.label} · ${Home.durationText(bar.minutes)}"></i>`)
      .join('');
    energy.bars.setAttribute('aria-label', `最近 7 天：${view.week.map((bar) => `${bar.label} ${Home.durationText(bar.minutes)}`).join('，')}`);
    energy.days.innerHTML = view.week.map((bar) => `<span class="${bar.kind === 'today' ? 'today' : ''}">${bar.label}</span>`).join('');
    energy.weekNote.hidden = !view.hasLongDay;
  }

  async function refreshEnergy() {
    if (!energy || energyLoading || !window.notchAPI) return;
    energyLoading = true;
    try {
      const key = todayKey();
      const keys = Home.recentDayKeys(key);
      const [status, worklog] = await Promise.all([
        window.notchAPI.getEnergyStatus?.()?.catch?.(() => null),
        window.notchAPI.getWorklog?.(keys[0], key)?.catch?.(() => null),
      ]);
      if (status) {
        energyStatus = status;
        heldCount = Number(status.held) || 0;
      }
      if (worklog) {
        energyDays = worklog.days || {};
        energyEnabled = worklog.enabled !== false;
      }
    } finally {
      energyLoading = false;
    }
    renderEnergy();
    renderHeld(pomodoro()?.state?.());
  }

  energy?.rest.addEventListener('click', async () => {
    await window.notchAPI?.takeBreak?.()?.catch?.(() => {});
    // 暂停着的专注先结束（满 1 分钟照常记下），再开始休息。
    if (pomodoro()?.state?.().started && pomodoro().state().mode === 'focus') pomodoro().finish();
    pomodoro()?.start(5 * 60, 'break');
    toast('休息 5 分钟，离开屏幕走动一下');
    refreshEnergy();
  });
  get('energy-open-settings')?.addEventListener('click', async () => {
    await window.setActiveTab?.('settings');
    window.NotchSettings?.reveal?.('settings-body-card');
  });

  // ---------------- 刷新时机 ----------------
  function refreshAll() {
    renderNow();
    refreshEnergy();
  }

  document.addEventListener('notch:pomodoro-changed', (event) => {
    const state = event.detail || pomodoro()?.state?.();
    const phase = `${phaseOf(state)}|${state.session}|${state.task?.id || ''}`;
    if (phase !== lastPhase) {
      renderNow();
      renderEnergy();
      return;
    }
    if (state.started && visible()) tick(state);
  });
  for (const name of ['notch:todos-changed', 'notch:focus-logged', 'notch:events-changed']) {
    document.addEventListener(name, () => renderNow());
  }
  document.addEventListener('notch:tabchange', (event) => {
    closePicker();
    if (event.detail?.tab === 'home') refreshAll();
  });
  document.addEventListener('notch:modechange', (event) => {
    if (!event.detail?.expanded) closePicker();
    else if (visible()) refreshAll();
  });
  window.notchAPI?.onFocusHeld?.((count) => {
    heldCount = count;
    renderHeld(pomodoro()?.state?.());
  });
  const timer = setInterval(() => { if (visible()) refreshAll(); }, REFRESH_MS);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });

  window.NotchHomeNow = {
    task: () => currentTask(),
    render: renderNow,
    refreshEnergy,
    closePicker,
  };

  renderNow();
  renderEnergy();
  if (visible()) refreshEnergy();
})();
