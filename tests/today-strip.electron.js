const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Today strip renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const shot = async (name, selector) => {
    if (!process.env.SOLODOCK_STRIP_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 250)); // let the compositor paint the latest frame
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_STRIP_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage(rect)).toPNG());
  };

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    const today = new Date();
    const at = (hour, minute = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, minute).getTime();
    const local = (time) => { const d = new Date(time); const pad = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
    window.__scheduled = [];
    window.notchAPI = {
      scheduleReminders: async (items) => { window.__scheduled = items; return true; },
      listTaskCompletions: async () => [
        { source: 'codex', title: '重构完成', completedAt: at(12) },
        { source: 'pomodoro', title: '专注结束', completedAt: at(13) },
      ],
    };
    await setMode(true);
    await setActiveTab('home');
    const strip = document.getElementById('today-strip');
    const line = document.getElementById('today-line');
    const out = { visible: !strip.hidden, title: document.getElementById('today-date-title').textContent };

    // A todo due today, a focus session and an AI completion all land on the axis.
    window.NotchTodos.items().P1.push({ id: 'due-1', text: '交付封面终稿', done: false, createdAt: Date.now(), deadline: local(at(23, 30)), remindedAt: 0 });
    document.dispatchEvent(new CustomEvent('notch:todos-changed'));
    localStorage.setItem('notch-focus-log-v1', JSON.stringify([{ start: at(8, 30), end: at(8, 55), minutes: 25 }]));
    document.dispatchEvent(new CustomEvent('notch:focus-logged'));
    await window.NotchTodayStrip.refreshCompletions();
    out.summary = document.getElementById('today-date-summary').textContent;
    out.deadlines = line.querySelectorAll('.tl-deadline').length;
    out.aiDots = line.querySelectorAll('.tl-ai').length;
    out.focus = line.querySelectorAll('.tl-focus').length;

    // Quick input fills the form; saving adds the event and schedules its reminder.
    document.getElementById('today-add-event').click();
    out.eventPopOpen = !document.getElementById('event-pop').hidden;
    out.expanded = document.getElementById('today-add-event').getAttribute('aria-expanded');
    const quick = document.getElementById('event-quick');
    quick.value = '22:00 客户电话 45分钟';
    quick.dispatchEvent(new Event('input', { bubbles: true }));
    out.parsed = [document.getElementById('event-title').value, document.getElementById('event-time').value, document.getElementById('event-duration').value];
    document.getElementById('event-save').click();
    await settle();
    out.events = window.NotchTodayStrip.events().map((item) => [item.title, item.durationMin]);
    out.pill = line.querySelector('.tl-event')?.textContent || '';
    out.scheduledEvent = window.__scheduled.some((item) => item.kind === 'event' && item.title === '客户电话');
    out.eventStillAhead = at(22, 45) > Date.now();

    // "Remind me later" in 30 minutes, then the main process fires it.
    document.getElementById('today-add-later').click();
    document.getElementById('later-note').value = '看导出进度';
    document.querySelector('[data-later="30"]').click();
    await settle();
    const laterItems = window.NotchTodayStrip.later();
    out.later = laterItems.map((item) => item.note);
    out.laterScheduled = window.__scheduled.some((item) => item.kind === 'later' && item.title === '看导出进度');
    out.toast = document.getElementById('status-toast-message')?.textContent || '';
    window.NotchTodayStrip.handleFired({ id: 'later-' + laterItems[0].id, firedAt: Date.now() });
    out.laterAfterFire = window.NotchTodayStrip.later().length;

    // Every mark stays inside the timeline.
    const box = line.getBoundingClientRect();
    out.outside = [...line.children].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.width && (r.left < box.left - 10 || r.right > box.right + 10);
    }).map((node) => node.className + ':' + node.textContent);
    const home = document.getElementById('tab-home').getBoundingClientRect();
    const bento = document.getElementById('home-bento').getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    out.stripHeight = Math.round(stripRect.height);
    out.bentoBelow = bento.top >= stripRect.bottom - 1 && bento.bottom <= home.bottom + 1;
    out.bentoHeight = bento.height;
    out.tilesOutside = [...document.querySelectorAll('#home-bento > [data-home-module]:not([hidden])')].filter((tile) => {
      const r = tile.getBoundingClientRect();
      return r.top < bento.top - 1 || r.bottom > bento.bottom + 1;
    }).map((tile) => tile.id);
    // The shorter bento must not squeeze the usage card's rows on top of each other.
    const rows = [...document.querySelectorAll('.usage-col-codex .usage-col-head, .usage-col-codex .usage-widget-body > *, .usage-col-codex .usage-widget-footer')]
      .filter((node) => node.getClientRects().length && getComputedStyle(node).display !== 'none')
      .map((node) => ({ id: node.id || node.className, rect: node.getBoundingClientRect() }));
    out.usageOverlaps = rows.slice(1).filter((row, index) => row.rect.top < rows[index].rect.bottom - 0.5).map((row) => row.id);
    return out;
  })()`);

  assert.equal(result.visible, true, 'the strip is on by default');
  assert.match(result.title, /^\d+月\d+日 周[日一二三四五六]$/);
  assert.match(result.summary, /1 项到期/);
  assert.match(result.summary, /已专注 25 分钟/);
  assert.equal(result.deadlines, 1);
  assert.equal(result.aiDots, 1, 'only AI completions become dots, not pomodoro');
  if (new Date().getHours() >= 9) assert.equal(result.focus, 1);
  assert.equal(result.eventPopOpen, true);
  assert.equal(result.expanded, 'true');
  assert.deepEqual(result.parsed, ['客户电话', '22:00', '45']);
  assert.deepEqual(result.events, [['客户电话', 45]]);
  assert.match(result.pill, /^22:00/);
  if (result.eventStillAhead) assert.equal(result.scheduledEvent, true);
  assert.deepEqual(result.later, ['看导出进度']);
  assert.equal(result.laterScheduled, true);
  assert.match(result.toast, /将在 \d\d:\d\d 提醒：看导出进度/);
  assert.equal(result.laterAfterFire, 0, 'a fired reminder is removed');
  assert.deepEqual(result.outside, []);
  assert.equal(result.stripHeight, 64);
  assert.equal(result.bentoBelow, true);
  assert.deepEqual(result.tilesOutside, []);
  assert.deepEqual(result.usageOverlaps, [], 'usage card rows do not overlap');
  await shot('strip', '#today-strip');
  await shot('home', '#tab-home');

  // Editing an event: delete, then undo from the toast.
  const edit = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
    document.querySelector('.tl-event').click();
    const title = document.getElementById('event-pop-title').textContent;
    const deleteVisible = !document.getElementById('event-delete').hidden;
    document.getElementById('event-delete').click();
    await settle();
    const afterDelete = window.NotchTodayStrip.events().length;
    document.getElementById('status-toast-action').click();
    await settle();
    const afterUndo = window.NotchTodayStrip.events().length;
    document.getElementById('today-add-event').click();
    document.getElementById('event-quick').value = '';
    document.getElementById('event-title').value = '';
    document.getElementById('event-save').click();
    const error = document.getElementById('event-error').textContent;
    return { title, deleteVisible, afterDelete, afterUndo, error, popOpen: !document.getElementById('event-pop').hidden };
  })()`);
  assert.equal(edit.title, '修改日程');
  assert.equal(edit.deleteVisible, true);
  assert.equal(edit.afterDelete, 0);
  assert.equal(edit.afterUndo, 1);
  assert.equal(edit.error, '写一下日程标题');
  assert.equal(edit.popOpen, true, 'the form stays open to fix the title');
  await shot('event-pop', '#tab-home');

  // The settings switch hides the strip and the bento takes the space.
  const toggled = await win.webContents.executeJavaScript(`(async () => {
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const before = document.getElementById('home-bento').getBoundingClientRect().height;
    const input = document.getElementById('settings-today-strip');
    const initiallyChecked = input.checked;
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 60));
    return {
      initiallyChecked,
      hidden: document.getElementById('today-strip').hidden,
      stored: localStorage.getItem('notch-home-strip-v1'),
      grew: document.getElementById('home-bento').getBoundingClientRect().height - before,
      popsClosed: document.getElementById('event-pop').hidden,
    };
  })()`);
  assert.equal(toggled.initiallyChecked, true);
  assert.equal(toggled.hidden, true);
  assert.equal(toggled.stored, 'false');
  assert.ok(toggled.grew >= 70, `bento grows when the strip is hidden (${toggled.grew})`);
  assert.equal(toggled.popsClosed, true);

  assert.deepEqual(errors, []);
  console.log('Today strip checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
