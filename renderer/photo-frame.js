// Home photo frame (album) and its settings manager.
// Photos live in the data folder (main process); captions, countdowns, order and the switching
// mode live in LocalStorage under notch-frame-v1.
(function bootstrapPhotoFrame() {
  'use strict';

  const Frame = window.NotchFrame;
  const tile = document.getElementById('home-mirror');
  if (!Frame || !tile) return;

  const STORAGE_KEY = 'notch-frame-v1';
  const get = (id) => document.getElementById(id);
  const layers = [...tile.querySelectorAll('.frame-layer')];
  const menu = get('frame-menu');
  const moreButton = get('frame-more');
  const toast = (message, options) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message, options);
  };

  let state = Frame.normalizeFrame(readState());
  let shownId = '';
  let selectedId = '';
  let loadToken = 0;
  const photoCache = new Map();
  const thumbCache = new Map();

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveState(next) {
    state = Frame.normalizeFrame(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (error) { /* keep session state */ }
  }

  async function readPhoto(id, thumb = false) {
    const cache = thumb ? thumbCache : photoCache;
    if (cache.has(id)) return cache.get(id);
    const dataUrl = await window.notchAPI?.readFramePhoto?.(id, thumb).catch(() => null);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
    cache.set(id, dataUrl);
    // Full-size photos are large; keep only a few in memory.
    if (!thumb && cache.size > 4) cache.delete(cache.keys().next().value);
    return dataUrl;
  }

  // ---------------- Tile ----------------
  function renderOverlay() {
    const photo = state.photos.find((item) => item.id === shownId);
    const count = get('frame-countdown');
    const countdown = photo ? Frame.countdown(photo.countdownTo) : null;
    get('frame-caption-text').textContent = photo?.caption || '';
    count.textContent = countdown ? countdown.text : '';
    count.hidden = !countdown;
    get('frame-caption').hidden = !photo || (!photo.caption && !countdown);

    const dots = get('frame-dots');
    const total = state.photos.length;
    const index = state.photos.findIndex((item) => item.id === shownId);
    dots.replaceChildren();
    if (total > 1) {
      // Long albums show at most 7 dots around the current photo.
      const start = Math.max(0, Math.min(index - 3, total - 7));
      for (let position = start; position < Math.min(total, start + 7); position += 1) {
        const dot = document.createElement('i');
        if (position === index) dot.className = 'active';
        dots.append(dot);
      }
    }
    tile.dataset.count = String(total);
    tile.dataset.pinned = state.pinnedId ? 'true' : 'false';
    menu.querySelector('[data-frame-action="pin"]').textContent = state.pinnedId ? '取消固定' : '固定这张';
  }

  async function show(id, { immediate = false } = {}) {
    const token = ++loadToken;
    tile.dataset.state = state.photos.length ? 'photo' : 'empty';
    if (!id) {
      shownId = '';
      const front = layers.find((layer) => layer.classList.contains('is-front'));
      front.src = 'assets/solodock-mirror.png';
      renderOverlay();
      return;
    }
    const dataUrl = await readPhoto(id);
    if (token !== loadToken || !dataUrl) return;
    const front = layers.find((layer) => layer.classList.contains('is-front'));
    const back = layers.find((layer) => layer !== front);
    shownId = id;
    renderOverlay();
    if (front.src === dataUrl) return;
    back.src = dataUrl;
    if (typeof back.decode === 'function') await back.decode().catch(() => {});
    if (token !== loadToken) return;
    tile.classList.toggle('frame-instant', immediate);
    back.classList.add('is-front');
    front.classList.remove('is-front');
    // Warm the next photo so the next open fades in without waiting.
    const nextId = Frame.stepId(state, 1);
    if (nextId && nextId !== id) readPhoto(nextId);
  }

  function step(delta) {
    const id = Frame.stepId(state, delta);
    if (!id) return;
    saveState({ ...state, currentId: id, pinnedId: state.pinnedId ? id : '' });
    show(id);
    renderSettings();
  }

  function closeMenu() {
    menu.hidden = true;
    moreButton.setAttribute('aria-expanded', 'false');
  }

  function togglePin(id = shownId) {
    if (!id) return;
    const pinned = state.pinnedId === id;
    saveState({ ...state, pinnedId: pinned ? '' : id, currentId: id });
    if (id !== shownId) show(id, { immediate: true });
    else renderOverlay();
    renderSettings();
    toast(pinned ? '已取消固定，展开面板时会换照片' : '已固定这张照片');
  }

  async function addPhotos() {
    const result = await window.notchAPI?.addFramePhotos?.().catch(() => null);
    if (!result || result.canceled) return;
    if (result.error === 'limit') {
      toast(`相框最多放 ${result.limit || Frame.MAX_PHOTOS} 张照片`);
      return;
    }
    await reload();
    const added = Array.isArray(result.added) ? result.added : [];
    if (added.length) {
      // Show the newest photo right away, unless a photo is pinned.
      const lastId = added[added.length - 1].id;
      selectedId = lastId;
      if (!state.pinnedId) {
        saveState({ ...state, currentId: lastId });
        show(lastId);
      }
      renderSettings();
    }
    const skipped = Number(result.skipped) || 0;
    toast(added.length
      ? `已添加 ${added.length} 张照片${skipped ? `，${skipped} 张未能添加` : ''}`
      : '没有可添加的照片，请选择有效的图片');
  }

  get('frame-prev').addEventListener('click', () => step(-1));
  get('frame-next').addEventListener('click', () => step(1));
  get('frame-empty-add').addEventListener('click', addPhotos);
  moreButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    moreButton.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector('button').focus();
  });
  menu.addEventListener('click', (event) => {
    const action = event.target.closest('[data-frame-action]')?.dataset.frameAction;
    if (!action) return;
    closeMenu();
    if (action === 'pin') togglePin();
    if (action === 'add') addPhotos();
    if (action === 'settings') {
      window.setActiveTab?.('settings');
      requestAnimationFrame(() => get('settings-frame-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeMenu();
      moreButton.focus();
    }
  });
  document.addEventListener('pointerdown', (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== moreButton && !moreButton.contains(event.target)) closeMenu();
  });

  // ---------------- Settings ----------------
  const grid = get('settings-frame-grid');
  const editor = get('settings-frame-editor');
  const captionInput = get('settings-frame-caption');
  const countdownInput = get('settings-frame-countdown');
  const rotateSelect = get('settings-frame-rotate');

  function renderSettings() {
    if (!grid) return;
    get('settings-frame-count').textContent = `${state.photos.length} / ${Frame.MAX_PHOTOS}`;
    rotateSelect.value = state.rotate;
    rotateSelect.disabled = state.photos.length < 2;
    if (!state.photos.some((photo) => photo.id === selectedId)) selectedId = Frame.visibleId(state);
    const existing = new Map([...grid.children].map((node) => [node.dataset.id, node]));
    const nodes = state.photos.map((photo, index) => {
      const button = existing.get(photo.id) || document.createElement('button');
      if (!button.dataset.id) {
        button.type = 'button';
        button.className = 'settings-frame-thumb';
        button.dataset.id = photo.id;
        button.setAttribute('role', 'option');
        const image = document.createElement('img');
        image.alt = '';
        image.draggable = false;
        button.append(image);
        readPhoto(photo.id, true).then((dataUrl) => { if (dataUrl) image.src = dataUrl; });
      }
      button.setAttribute('aria-selected', String(photo.id === selectedId));
      button.setAttribute('aria-label', `第 ${index + 1} 张${photo.caption ? `：${photo.caption}` : ''}${state.pinnedId === photo.id ? '（已固定）' : ''}`);
      button.classList.toggle('pinned', state.pinnedId === photo.id);
      button.classList.toggle('showing', Frame.visibleId(state) === photo.id);
      return button;
    });
    grid.replaceChildren(...nodes);
    grid.hidden = !nodes.length;
    const photo = state.photos.find((item) => item.id === selectedId);
    editor.hidden = !photo;
    if (!photo) return;
    readPhoto(photo.id, true).then((dataUrl) => { if (dataUrl && selectedId === photo.id) get('settings-frame-editor-thumb').src = dataUrl; });
    // Do not overwrite a field while the user is typing in it.
    if (document.activeElement !== captionInput) captionInput.value = photo.caption;
    if (document.activeElement !== countdownInput) countdownInput.value = photo.countdownTo;
    get('settings-frame-pin').textContent = state.pinnedId === photo.id ? '取消固定' : '固定这张';
  }

  grid?.addEventListener('click', (event) => {
    const button = event.target.closest('.settings-frame-thumb');
    if (!button) return;
    // Selecting only picks the photo to edit; what the home frame shows changes via 「固定这张」.
    selectedId = button.dataset.id;
    renderSettings();
  });

  captionInput?.addEventListener('input', () => {
    saveState(Frame.updatePhoto(state, selectedId, { caption: captionInput.value }));
    if (selectedId === shownId) renderOverlay();
    renderSettings();
  });
  countdownInput?.addEventListener('change', () => {
    saveState(Frame.updatePhoto(state, selectedId, { countdownTo: countdownInput.value }));
    if (selectedId === shownId) renderOverlay();
  });
  rotateSelect?.addEventListener('change', () => saveState({ ...state, rotate: rotateSelect.value }));
  get('settings-frame-add')?.addEventListener('click', addPhotos);
  get('settings-frame-pin')?.addEventListener('click', () => togglePin(selectedId));
  get('settings-frame-remove')?.addEventListener('click', () => {
    const id = selectedId;
    if (!id) return;
    const before = state;
    saveState(Frame.removePhoto(state, id));
    selectedId = Frame.visibleId(state);
    show(Frame.visibleId(state), { immediate: true });
    renderSettings();
    // The file is deleted only after the undo window closes.
    toast('已移除这张照片', {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => {
        saveState(before);
        selectedId = id;
        show(Frame.visibleId(state), { immediate: true });
        renderSettings();
      },
      onExpire: () => {
        if (!state.photos.some((photo) => photo.id === id)) {
          window.notchAPI?.deleteFramePhoto?.(id).catch(() => {});
          photoCache.delete(id);
          thumbCache.delete(id);
        }
      },
    });
  });

  // ---------------- Lifecycle ----------------
  async function reload() {
    const disk = await window.notchAPI?.listFramePhotos?.().catch(() => null);
    if (Array.isArray(disk)) saveState(Frame.reconcile(state, disk));
    renderSettings();
    return state;
  }

  document.addEventListener('notch:modechange', (event) => {
    if (!event.detail?.expanded) {
      closeMenu();
      return;
    }
    const next = Frame.onPanelOpen(state);
    if (next.currentId !== state.currentId) saveState(next);
    show(Frame.visibleId(state));
  });
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'settings') renderSettings();
  });
  window.notchAPI?.onFramePhotosChanged?.(async (payload) => {
    await reload();
    const added = Array.isArray(payload?.added) ? payload.added : [];
    if (added.length && !state.pinnedId) {
      saveState({ ...state, currentId: added[added.length - 1].id });
      show(Frame.visibleId(state), { immediate: true });
    }
  });

  reload().then(() => show(Frame.visibleId(state), { immediate: true }));

  window.NotchPhotoFrame = {
    reload: async () => { await reload(); await show(Frame.visibleId(state), { immediate: true }); },
    state: () => Frame.normalizeFrame(state),
    shownId: () => shownId,
    addPhotos,
  };
})();
