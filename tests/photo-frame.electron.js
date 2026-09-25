const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Photo frame renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const shot = async (name, selector) => {
    if (!process.env.SOLODOCK_FRAME_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_FRAME_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  };

  const empty = await win.webContents.executeJavaScript(`(async () => {
    await setMode(true);
    await setActiveTab('home');
    const tile = document.getElementById('home-mirror');
    return {
      state: tile.dataset.state,
      emptyVisible: getComputedStyle(document.getElementById('frame-empty')).display !== 'none',
      text: document.querySelector('.frame-empty b').textContent,
      moreHidden: getComputedStyle(document.getElementById('frame-more')).display === 'none',
    };
  })()`);
  assert.deepEqual(empty, { state: 'empty', emptyVisible: true, text: '放一张让你开心的照片', moreHidden: true });
  await shot('frame-empty', '#home-mirror');

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    // Canvas-drawn stand-ins for photos: a sky gradient with a sun.
    const paint = (top, bottom, sun) => {
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 640;
      const context = canvas.getContext('2d');
      const gradient = context.createLinearGradient(0, 0, 0, 640);
      gradient.addColorStop(0, top); gradient.addColorStop(1, bottom);
      context.fillStyle = gradient; context.fillRect(0, 0, 480, 640);
      context.fillStyle = sun; context.beginPath(); context.arc(330, 250, 70, 0, Math.PI * 2); context.fill();
      return canvas.toDataURL('image/jpeg', 0.9);
    };
    const images = {
      'photo-kyoto': paint('#f6c9a8', '#5a6fa8', '#ffe9b0'),
      'photo-family': paint('#9fd3f2', '#2f6c9e', '#ffffff'),
      'photo-sea': paint('#bfe6e0', '#1f6f8b', '#fff6c8'),
      'photo-new': paint('#e3d4f5', '#6a5aa8', '#ffe3f1'),
    };
    let disk = [{ id: 'photo-kyoto', addedAt: 1 }, { id: 'photo-family', addedAt: 2 }, { id: 'photo-sea', addedAt: 3 }];
    window.__deleted = [];
    window.__addResult = { ok: true, canceled: false, added: [{ id: 'photo-new', addedAt: 4 }], skipped: 1, limit: 50 };
    window.notchAPI = {
      listFramePhotos: async () => disk.slice(),
      readFramePhoto: async (id) => images[id] || null,
      addFramePhotos: async () => { if (window.__addResult.added?.length) disk = disk.concat(window.__addResult.added); return window.__addResult; },
      deleteFramePhoto: async (id) => { window.__deleted.push(id); return true; },
    };
    const tile = document.getElementById('home-mirror');
    const Frame = window.NotchPhotoFrame;
    const out = {};
    await Frame.reload();
    await settle();
    out.state = tile.dataset.state;
    out.first = Frame.shownId();
    out.dots = [...document.querySelectorAll('#frame-dots i')].map((dot) => dot.className === 'active');

    // Opening the panel moves the album on; arrows step through it.
    document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
    await settle();
    out.afterOpen = Frame.shownId();
    document.getElementById('frame-next').click();
    await settle();
    out.afterNext = Frame.shownId();
    document.getElementById('frame-prev').click();
    document.getElementById('frame-prev').click();
    await settle();
    out.afterPrev = Frame.shownId();

    // Settings: pick the Kyoto photo, give it a caption and a countdown.
    await setActiveTab('settings');
    const thumbs = () => [...document.querySelectorAll('.settings-frame-thumb')];
    out.thumbs = thumbs().map((thumb) => thumb.dataset.id);
    out.count = document.getElementById('settings-frame-count').textContent;
    thumbs()[0].click();
    const caption = document.getElementById('settings-frame-caption');
    caption.focus();
    caption.value = '京都，明年春天';
    caption.dispatchEvent(new Event('input', { bubbles: true }));
    const target = new Date(); target.setDate(target.getDate() + 12);
    const pad = (n) => String(n).padStart(2, '0');
    const countdown = document.getElementById('settings-frame-countdown');
    countdown.value = target.getFullYear() + '-' + pad(target.getMonth() + 1) + '-' + pad(target.getDate());
    countdown.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    out.shownAfterPick = Frame.shownId();
    out.caption = [document.getElementById('frame-caption-text').textContent, document.getElementById('frame-countdown').textContent, document.getElementById('frame-caption').hidden];
    out.thumbLabel = thumbs()[0].getAttribute('aria-label');

    // Pin keeps the photo when the panel opens again; the rotation mode is saved.
    document.getElementById('settings-frame-pin').click();
    document.getElementById('settings-frame-rotate').value = 'daily';
    document.getElementById('settings-frame-rotate').dispatchEvent(new Event('change', { bubbles: true }));
    document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
    await settle();
    out.pinned = [Frame.state().pinnedId, Frame.shownId(), Frame.state().rotate, thumbs()[0].classList.contains('pinned')];
    out.stored = JSON.parse(localStorage.getItem('notch-frame-v1')).photos[0];

    // Remove with undo, then remove for real: the file is deleted only when the toast expires.
    document.getElementById('settings-frame-remove').click();
    await settle();
    out.afterRemove = thumbs().length;
    document.getElementById('status-toast-action').click();
    await settle();
    out.afterUndo = [thumbs().length, Frame.state().pinnedId];
    thumbs()[2].click();
    document.getElementById('settings-frame-remove').click();
    await settle();
    out.deletedBeforeExpire = window.__deleted.slice();
    dismissStatusToast(true);
    await settle();
    out.deletedAfterExpire = window.__deleted.slice();

    out.shownWhilePinned = Frame.shownId();

    // The ⋯ menu unpins; then adding photos shows the newest and the limit is reported.
    await setActiveTab('home');
    document.getElementById('frame-more').click();
    out.menuOpen = !document.getElementById('frame-menu').hidden;
    out.menuPinLabel = document.querySelector('[data-frame-action="pin"]').textContent;
    document.querySelector('[data-frame-action="pin"]').click();
    out.unpinned = Frame.state().pinnedId === '' && document.getElementById('frame-menu').hidden;
    await Frame.addPhotos();
    await settle();
    out.added = [Frame.shownId(), document.getElementById('status-toast-message').textContent];
    window.__addResult = { ok: false, error: 'limit', added: [], limit: 50 };
    await Frame.addPhotos();
    out.limitToast = document.getElementById('status-toast-message').textContent;

    // The ⋯ menu opens settings.
    document.getElementById('frame-more').click();
    document.querySelector('[data-frame-action="settings"]').click();
    await settle();
    out.menuTab = document.querySelector('#tab-settings.active') !== null;
    await setActiveTab('home');
    await settle();
    const box = tile.getBoundingClientRect();
    out.outside = [...tile.querySelectorAll('.frame-caption, .frame-dots, .frame-nav, .frame-more')].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.width && (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1);
    }).map((node) => node.className);
    return out;
  })()`);

  assert.equal(result.state, 'photo');
  assert.equal(result.first, 'photo-kyoto');
  assert.deepEqual(result.dots, [true, false, false]);
  assert.equal(result.afterOpen, 'photo-family', 'each panel open shows the next photo');
  assert.equal(result.afterNext, 'photo-sea');
  assert.equal(result.afterPrev, 'photo-kyoto');
  assert.deepEqual(result.thumbs, ['photo-kyoto', 'photo-family', 'photo-sea']);
  assert.equal(result.count, '3 / 50');
  assert.equal(result.shownAfterPick, 'photo-kyoto');
  assert.deepEqual(result.caption, ['京都，明年春天', '还有 12 天', false]);
  assert.match(result.thumbLabel, /京都/);
  assert.deepEqual(result.pinned, ['photo-kyoto', 'photo-kyoto', 'daily', true]);
  assert.equal(result.stored.caption, '京都，明年春天');
  assert.equal(result.afterRemove, 2);
  assert.deepEqual(result.afterUndo, [3, 'photo-kyoto'], 'undo restores the photo and its pin');
  assert.deepEqual(result.deletedBeforeExpire, []);
  assert.deepEqual(result.deletedAfterExpire, ['photo-sea']);
  assert.equal(result.shownWhilePinned, 'photo-kyoto', 'editing another photo does not change the pinned one');
  assert.equal(result.menuOpen, true);
  assert.equal(result.menuPinLabel, '取消固定');
  assert.equal(result.unpinned, true);
  assert.deepEqual(result.added, ['photo-new', '已添加 1 张照片，1 张未能添加']);
  assert.equal(result.limitToast, '相框最多放 50 张照片');
  assert.equal(result.menuTab, true);
  assert.deepEqual(result.outside, []);
  // Pin the captioned photo so the screenshot shows the caption and countdown.
  await win.webContents.executeJavaScript(`(async () => {
    await setActiveTab('settings');
    document.querySelector('.settings-frame-thumb').click();
    document.getElementById('settings-frame-pin').click();
    await setActiveTab('home');
  })()`);
  await shot('frame-photo', '#home-mirror');
  await win.webContents.executeJavaScript(`(async () => {
    await setActiveTab('settings');
    document.querySelector('.settings-frame-thumb').click();
    document.getElementById('settings-frame-card').scrollIntoView({ block: 'start' });
  })()`);
  await shot('frame-settings', '#settings-frame-card');

  assert.deepEqual(errors, []);
  console.log('Photo frame checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
