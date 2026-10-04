'use strict';

// 休息陪伴：大猫窗口的渲染层。主进程在休息开始时发 show（附结束时刻、菜单栏高度和底部程序坞的高度），
// 休息结束、暂停或点「让它走」时发 hide。窗口默认点击穿透，指针停在猫或倒计时上才接收点击。
// 猫是两段带透明通道的视频：arrive 走进来、伸懒腰、打哈欠、打滚后睡下，只播一次；sleep 是睡觉循环。
(function setupBreakCat() {
  const api = window.notchAPI || {};
  const root = document.getElementById('break-cat');
  const stage = document.getElementById('break-cat-stage');
  const arrive = document.getElementById('break-cat-arrive');
  const sleep = document.getElementById('break-cat-sleep');
  const pill = document.getElementById('break-cat-pill');
  const timeElement = document.getElementById('break-cat-time');
  const leaveButton = document.getElementById('break-cat-leave');
  if (!root || !stage || !arrive || !sleep || !pill) return;

  const FRAME_RATIO = 16 / 9;
  // 猫睡下以后在视频画面里的范围（占画面宽高的比例，逐帧量出来的）。
  // 按它摆位：睡下的猫在屏幕上居中、约占屏宽七成，倒计时放在它下方。
  const SLEEP_BOX = { left: 0.183, right: 0.845, bottom: 0.9 };
  const SCREEN_SHARE = 0.7;
  const PILL_GAP = 12;
  const SAFE_EDGE = 24;
  const HIT_ALPHA = 230; // 只有猫身上才算点中，半透明的影子不算
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let endsAt = 0;
  let menuBar = 0;
  let bottomInset = 0;
  let visible = false;
  let ticker = null;
  let pillTimer = null;
  let leaveTimer = null;
  let interactive = false;
  let lastPoint = null;
  let probeFrame = 0;

  const probe = document.createElement('canvas');
  probe.width = 160;
  probe.height = 90;
  const probeContext = probe.getContext('2d', { willReadFrequently: true });

  // 视频画面的上沿贴着菜单栏下沿：伸懒腰时翘起的尾巴像是伸到菜单栏后面，不会盖住菜单栏。
  // 猫从画面右边走进来，所以画面右沿要碰到屏幕右沿，它才像是从屏幕外走进来的。
  function layout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight - bottomInset;
    const top = menuBar;
    const pillHeight = pill.offsetHeight || 96;
    const sleepWidth = SLEEP_BOX.right - SLEEP_BOX.left;
    let width = (vw * SCREEN_SHARE) / sleepWidth;
    // 矮屏：睡下的猫下面要放得下倒计时。
    const maxHeight = (vh - top - SAFE_EDGE - pillHeight - PILL_GAP) / SLEEP_BOX.bottom;
    if (width / FRAME_RATIO > maxHeight) width = Math.max(0, maxHeight) * FRAME_RATIO;
    const height = width / FRAME_RATIO;
    let left = vw / 2 - ((SLEEP_BOX.left + SLEEP_BOX.right) / 2) * width;
    // 特别宽的屏：画面够不到屏幕右沿时整体右移，但睡下的猫不出屏。
    const gap = vw - (left + width);
    if (gap > 0) left += Math.min(gap, Math.max(0, vw - SAFE_EDGE - (left + SLEEP_BOX.right * width)));
    const style = document.documentElement.style;
    style.setProperty('--cat-left', `${Math.round(left)}px`);
    style.setProperty('--cat-top', `${Math.round(top)}px`);
    style.setProperty('--cat-width', `${Math.round(width)}px`);
    style.setProperty('--cat-height', `${Math.round(height)}px`);
    style.setProperty('--pill-x', `${Math.round(left + ((SLEEP_BOX.left + SLEEP_BOX.right) / 2) * width)}px`);
    style.setProperty('--pill-top', `${Math.round(top + SLEEP_BOX.bottom * height + PILL_GAP)}px`);
  }

  function formatRemaining(ms) {
    const seconds = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function tick() {
    timeElement.textContent = formatRemaining(endsAt - Date.now());
  }

  function play(video) {
    const result = video.play();
    if (result && typeof result.catch === 'function') result.catch(() => {});
  }

  function setActive(video) {
    arrive.dataset.active = String(video === arrive);
    sleep.dataset.active = String(video === sleep);
    root.classList.toggle('is-sleeping', video === sleep);
  }

  function activeVideo() {
    return arrive.dataset.active === 'true' ? arrive : sleep;
  }

  function startVideos() {
    sleep.pause();
    try { sleep.currentTime = 0; } catch (error) {}
    // 减少动态效果：不走进来，直接是一只睡着不动的猫。
    if (reducedMotion.matches) {
      setActive(sleep);
      return;
    }
    setActive(arrive);
    try { arrive.currentTime = 0; } catch (error) {}
    play(arrive);
  }

  // arrive 的最后一帧就是 sleep 的第一帧：先让 sleep 播起来，再藏起 arrive，接缝看不出来。
  function settleIntoSleep() {
    if (!visible) return;
    sleep.addEventListener('playing', () => { if (visible) setActive(sleep); }, { once: true });
    play(sleep);
  }

  function setInteractive(next) {
    if (interactive === next) return;
    interactive = next;
    api.breakCatInteractive?.(next);
  }

  function inside(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  // 按视频当前这一帧的透明度判断指针是不是在猫身上。
  function catAt(x, y) {
    if (!visible || !probeContext) return false;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !inside(rect, x, y)) return false;
    const video = activeVideo();
    if (video.readyState < 2) return false;
    try {
      probeContext.clearRect(0, 0, probe.width, probe.height);
      probeContext.drawImage(video, 0, 0, probe.width, probe.height);
      const px = Math.min(probe.width - 1, Math.floor(((x - rect.left) / rect.width) * probe.width));
      const py = Math.min(probe.height - 1, Math.floor(((y - rect.top) / rect.height) * probe.height));
      return probeContext.getImageData(px, py, 1, 1).data[3] >= HIT_ALPHA;
    } catch (error) {
      return false;
    }
  }

  function overPill(x, y) {
    return root.classList.contains('is-pill-visible') && inside(pill.getBoundingClientRect(), x, y);
  }

  function probeHover() {
    probeFrame = 0;
    if (!visible || !lastPoint) {
      setInteractive(false);
      return;
    }
    const [x, y] = lastPoint;
    const onPill = overPill(x, y);
    const onCat = !onPill && catAt(x, y);
    root.classList.toggle('is-hovering-cat', onCat);
    setInteractive(onPill || onCat);
  }

  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.1 4.3 2.4.7-1.3 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21Z"/></svg>';

  function heart(x, y, delay) {
    const element = document.createElement('span');
    element.className = 'break-cat-heart';
    element.innerHTML = HEART;
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.animationDelay = `${delay}ms`;
    root.appendChild(element);
    setTimeout(() => element.remove(), 1100 + delay + 100);
  }

  // 摸一下：身体轻轻一缩，冒两颗心。
  function pat(x, y) {
    stage.classList.remove('is-patted');
    void stage.offsetWidth;
    stage.classList.add('is-patted');
    heart(x, y - 8, 0);
    heart(x + 20, y + 4, 160);
  }

  function show(payload) {
    const data = payload && typeof payload === 'object' ? payload : {};
    endsAt = Number(data.endsAt) || Date.now() + 5 * 60 * 1000;
    menuBar = Math.max(0, Number(data.menuBar) || 0);
    bottomInset = Math.max(0, Number(data.bottom) || 0);
    clearTimeout(leaveTimer);
    clearTimeout(pillTimer);
    clearInterval(ticker);
    visible = true;
    root.hidden = false;
    root.classList.remove('is-leaving', 'is-pill-visible', 'is-visible', 'is-hovering-cat');
    layout();
    tick();
    ticker = setInterval(tick, 1000);
    startVideos();
    requestAnimationFrame(() => { if (visible) root.classList.add('is-visible'); });
    pillTimer = setTimeout(() => { if (visible) root.classList.add('is-pill-visible'); }, reducedMotion.matches ? 0 : 1200);
  }

  function update(payload) {
    const next = Number(payload && payload.endsAt);
    if (!next) return;
    endsAt = next;
    tick();
  }

  function hide() {
    clearTimeout(pillTimer);
    clearInterval(ticker);
    if (!visible) {
      api.breakCatLeft?.();
      return;
    }
    visible = false;
    lastPoint = null;
    setInteractive(false);
    root.classList.remove('is-hovering-cat');
    root.classList.add('is-leaving');
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (visible) return;
      arrive.pause();
      sleep.pause();
      root.hidden = true;
      root.classList.remove('is-leaving', 'is-visible', 'is-pill-visible');
      api.breakCatLeft?.();
    }, reducedMotion.matches ? 240 : 700);
  }

  arrive.addEventListener('ended', settleIntoSleep);
  arrive.addEventListener('error', settleIntoSleep);

  window.addEventListener('mousemove', (event) => {
    lastPoint = [event.clientX, event.clientY];
    if (!probeFrame) probeFrame = requestAnimationFrame(probeHover);
  });
  document.addEventListener('mouseleave', () => {
    lastPoint = null;
    root.classList.remove('is-hovering-cat');
    setInteractive(false);
  });
  window.addEventListener('click', (event) => {
    if (event.target instanceof Node && pill.contains(event.target)) return;
    if (catAt(event.clientX, event.clientY)) pat(event.clientX, event.clientY);
  });
  leaveButton.addEventListener('click', () => api.breakCatDismiss?.());
  window.addEventListener('resize', () => { if (visible) layout(); });

  api.onBreakCatShow?.(show);
  api.onBreakCatUpdate?.(update);
  api.onBreakCatHide?.(hide);

  window.NotchBreakCat = { show, update, hide, layout, formatRemaining };
})();
