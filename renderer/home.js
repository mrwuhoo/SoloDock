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
    dial: get('now-dial'),
    start: get('now-start'),
    switcher: get('now-switch'),
    next: get('now-next-list'),
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

  // ---------------- 拉环表盘 ----------------
  // 参考锤子时钟的拉环计时器：一圈 60 分钟，从 12 点顺时针拖拉环定时长，整分钟吸附，拖过头有阻尼、松手回弹。
  // 蓝色弧是剩下的时间：计时中拉环沿表盘慢慢退回 12 点；超过 60 分钟的部分叠在第二圈。计时中也能再拨。
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ARC_R = 37;
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  function svgNode(tag, attrs, parent) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (parent) parent.append(node);
    return node;
  }

  const dial = (() => {
    const host = el.dial;
    const root = svgNode('svg', { viewBox: '-6 -6 112 112', class: 'now-dial-svg', 'aria-hidden': 'true' });
    const defs = svgNode('defs', {}, root);
    const gradient = svgNode('linearGradient', { id: 'now-dial-tint', x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
    svgNode('stop', { offset: 0, class: 'now-dial-stop-a' }, gradient);
    svgNode('stop', { offset: 1, class: 'now-dial-stop-b' }, gradient);
    // 比例参考温控旋钮：外圈稀疏刻度与 0/15/30/45，浅色底盘上一道粗弧，
    // 弧端是比弧更粗的白色旋钮，中间凸起的白色圆盘写分钟数。
    svgNode('circle', { cx: 50, cy: 50, r: 42, class: 'now-dial-bed' }, root);
    const ticks = svgNode('g', { class: 'now-dial-ticks' }, root);
    for (const tick of Home.dialTicks(50, 50, 47.5)) {
      svgNode('line', { x1: tick.x1, y1: tick.y1, x2: tick.x2, y2: tick.y2, class: tick.major ? 'major' : 'minor' }, ticks);
    }
    svgNode('circle', { cx: 50, cy: 50, r: ARC_R, class: 'now-dial-track' }, root);
    const arc = svgNode('path', { class: 'now-dial-arc', d: '' }, root);
    const lap = svgNode('path', { class: 'now-dial-arc lap', d: '' }, root);
    svgNode('circle', { cx: 50, cy: 50, r: 28.5, class: 'now-dial-disc' }, root);
    const tab = svgNode('g', { class: 'now-dial-tab' }, root);
    svgNode('circle', { r: 8, class: 'now-dial-tab-knob' }, tab);
    for (const [value, where] of [[0, 'top'], [15, 'right'], [30, 'bottom'], [45, 'left']]) {
      const mark = document.createElement('span');
      mark.className = 'now-dial-mark';
      mark.dataset.at = where;
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = String(value);
      host.append(mark);
    }
    const read = document.createElement('div');
    read.className = 'now-dial-read';
    read.setAttribute('aria-hidden', 'true');
    const line = document.createElement('span');
    const number = document.createElement('b');
    const unit = document.createElement('small');
    unit.textContent = '分钟';
    line.append(number, unit);
    const caption = document.createElement('em');
    read.append(line, caption);
    host.prepend(root);
    host.append(read);
    return { host, arc, lap, tab, number, caption, shown: Home.DEFAULT_FOCUS_MINUTES, drag: null, anim: 0, landed: 0 };
  })();

  // minutes 可以带小数：计时中拉环每秒退一点。readout 是表盘中间的整数。
  // caption 是数字下面那行小字：空闲写「专注时长」，计时中写几点结束。
  function paintDial(minutes, readout, caption, tone) {
    const m = Math.max(0, Math.min(Home.MAX_FOCUS_MINUTES, Number(minutes) || 0));
    const first = Math.min(Home.DIAL_MINUTES, m);
    const second = Math.max(0, m - Home.DIAL_MINUTES);
    dial.arc.setAttribute('d', Home.dialArc(first, ARC_R));
    dial.lap.setAttribute('d', Home.dialArc(second, ARC_R));
    const at = second > 0 ? second : first;
    const tabAt = Home.dialPoint(at, ARC_R);
    dial.tab.setAttribute('transform', `translate(${tabAt.x} ${tabAt.y})`);
    dial.number.textContent = String(readout);
    dial.caption.textContent = caption;
    dial.host.dataset.tone = tone;
    dial.host.classList.toggle('is-empty', m <= 0.01);
  }

  function dialPhase() {
    const state = pomodoro()?.state?.() || { started: false };
    return { state, phase: phaseOf(state) };
  }

  // 空闲时拨的是这一轮的时长；计时中拨的是「还剩多少」。
  function dialValue() {
    const { state, phase } = dialPhase();
    if (phase === 'idle') return pomodoro()?.minutes?.() || Home.DEFAULT_FOCUS_MINUTES;
    return Math.max(1, Home.remainingMinutes(state.remaining));
  }

  function paintDragging(value) {
    const { state, phase } = dialPhase();
    const minutes = Home.dialSettle(value);
    const tone = phase === 'idle' ? 'focus' : phase === 'paused' ? 'paused' : phase === 'break' ? 'break' : 'focus';
    paintDial(value, minutes, phase === 'idle' ? '专注时长' : state.mode === 'break' ? '休息还剩' : '还剩', tone);
    dial.host.setAttribute('aria-valuenow', String(minutes));
  }

  function commitDial(minutes) {
    const timer = pomodoro();
    if (!timer) return;
    const { phase } = dialPhase();
    if (phase === 'idle') timer.setMinutes(minutes);
    else timer.setRemaining(minutes * 60);
  }

  // 松手：带一点惯性停到最近的整分钟，越界的部分弹回（减弱动态效果时直接落位）。
  function settleDial(from, to) {
    cancelAnimationFrame(dial.anim);
    clearTimeout(dial.landed);
    commitDial(to);
    const land = () => {
      cancelAnimationFrame(dial.anim);
      clearTimeout(dial.landed);
      dial.host.classList.remove('is-dragging');
      renderNow();
    };
    if (reduceMotion() || Math.abs(from - to) < 0.01) {
      land();
      return;
    }
    const startedAt = performance.now();
    const duration = 280;
    const spring = (t) => 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.08;
    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      paintDragging(from + (to - from) * spring(t));
      if (t < 1) dial.anim = requestAnimationFrame(step);
      else land();
    };
    dial.host.classList.add('is-dragging');
    dial.anim = requestAnimationFrame(step);
    // 窗口在后台时不会有动画帧，到点直接落位，表盘不会卡在半路。
    dial.landed = setTimeout(land, duration + 120);
  }

  function dialPointer(event) {
    const box = dial.host.getBoundingClientRect();
    const scale = 112 / box.width;
    const x = (event.clientX - box.left) * scale - 6;
    const y = (event.clientY - box.top) * scale - 6;
    return { x, y, distance: Math.hypot(x - 50, y - 50), minutes: Home.dialMinutesAt(x, y, 50, 50) };
  }

  dial.host.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const point = dialPointer(event);
    if (point.distance < 26) return; // 中间的数字不是拨盘
    event.preventDefault();
    cancelAnimationFrame(dial.anim);
    clearTimeout(dial.landed);
    const current = dialValue();
    const onTab = event.target.closest?.('.now-dial-tab');
    // 点在表盘别处：拉环直接跳过去（停在当前这一圈）。
    const lapBase = current > Home.DIAL_MINUTES ? Home.DIAL_MINUTES : 0;
    const start = onTab ? current : Math.max(0.5, lapBase + point.minutes);
    dial.drag = { raw: start, last: point.minutes, shown: start, at: performance.now(), speed: 0, pointer: event.pointerId };
    try { dial.host.setPointerCapture(event.pointerId); } catch {}
    dial.host.classList.add('is-dragging');
    dial.host.focus({ preventScroll: true, focusVisible: false });
    paintDragging(Home.dialResist(start));
  });
  dial.host.addEventListener('pointermove', (event) => {
    const drag = dial.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    const point = dialPointer(event);
    const now = performance.now();
    const step = Home.dialStep(drag.last, point.minutes);
    drag.last = point.minutes;
    drag.raw += step;
    // 阻尼：表盘跟手但略慢半拍；拖过 1–120 的范围只跟三成。
    const target = Home.dialResist(drag.raw);
    drag.speed = drag.speed * 0.6 + (step / Math.max(8, now - drag.at)) * 0.4;
    drag.at = now;
    drag.shown += (target - drag.shown) * 0.6;
    paintDragging(drag.shown);
  });
  const endDrag = (event) => {
    const drag = dial.drag;
    if (!drag || event.pointerId !== drag.pointer) return;
    dial.drag = null;
    // 快速一甩才带惯性（最多 5 分钟）；停稳了再松手就落在手指下的那一格。
    const still = performance.now() - drag.at > 90;
    const fling = still || Math.abs(drag.speed) < 0.03 ? 0 : Math.max(-5, Math.min(5, drag.speed * 60));
    settleDial(drag.shown, Home.dialSettle(Home.dialResist(drag.raw) + fling));
  };
  dial.host.addEventListener('pointerup', endDrag);
  dial.host.addEventListener('pointercancel', endDrag);
  dial.host.addEventListener('keydown', (event) => {
    const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
    const current = dialValue();
    let next = null;
    if (event.key in steps) next = current + steps[event.key];
    else if (event.key === 'Home') next = Home.MIN_FOCUS_MINUTES;
    else if (event.key === 'End') next = Home.MAX_FOCUS_MINUTES;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    settleDial(current, Home.dialSettle(next));
  });
  dial.host.addEventListener('wheel', (event) => {
    if (!event.deltaY) return;
    event.preventDefault();
    const current = dialValue();
    settleDial(current, Home.dialSettle(current + (event.deltaY < 0 ? 1 : -1)));
  }, { passive: false });

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
    if (!dial.drag && !dial.host.classList.contains('is-dragging')) paintDial(minutes, minutes, '专注时长', 'focus');
    el.dial.setAttribute('aria-label', '专注时长');
    el.dial.setAttribute('aria-valuenow', String(minutes));
    el.dial.setAttribute('aria-valuetext', `专注 ${minutes} 分钟`);
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

  // 每秒只更新表盘（拉环退回一点、中间的剩余分钟）与当前这个番茄的进度（完成数在切换状态时已经算好）。
  function tick(state, tomatoes = lastTomatoes) {
    const fraction = state.remaining / Math.max(1, state.session);
    const tone = state.mode === 'break' ? 'break' : state.running ? 'focus' : 'paused';
    const left = Home.remainingText(state.remaining, state.mode);
    if (!dial.drag && !dial.host.classList.contains('is-dragging')) {
      const ends = state.running ? `${Home.clock(state.endsAt)} 结束` : '已暂停';
      paintDial(state.remaining / 60, Home.remainingMinutes(state.remaining), state.mode === 'break' && state.running ? `休息 · ${ends}` : ends, tone);
    }
    el.dial.setAttribute('aria-label', state.mode === 'break' ? '休息剩余时间' : '专注剩余时间');
    el.dial.setAttribute('aria-valuenow', String(Math.max(1, Home.remainingMinutes(state.remaining))));
    el.dial.setAttribute('aria-valuetext', state.running ? `${left}，${Home.clock(state.endsAt)} 结束` : `已暂停，${left}`);
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
