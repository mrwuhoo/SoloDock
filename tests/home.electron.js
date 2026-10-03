const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Home renderer timed out'); app.exit(1); }, 45000);

// 2026-09-29 14:20 (fixed by the preload): three focus sessions done, a doing todo due at 18:00,
// events at 16:00 and 20:30, and a work log with a long Friday.
const seed = `(() => {
  const at = (hour, minute = 0, day = 29) => new Date(2026, 8, day, hour, minute).getTime();
  const iso = (hour, minute = 0, day = 29) => new Date(at(hour, minute, day)).toISOString();
  const set = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  set('notch-todo-categories-v1', [
    { id: 'P0', name: '客户', color: 'cat-1' }, { id: 'P1', name: '课程', color: 'cat-3' },
    { id: 'P2', name: '内容', color: 'cat-4' }, { id: 'P3', name: '杂事', color: 'cat-6' },
  ]);
  set('notch-todo-data', {
    P0: [{ id: 't2', text: '交付封面终稿', done: false, createdAt: at(8), deadline: iso(21) }],
    P1: [{ id: 't1', text: '录制第 3 节课：Vibe coding 实战', done: false, createdAt: at(8), deadline: iso(18) }],
    P2: [{ id: 't3', text: '写本周 Newsletter', done: false, createdAt: at(8), deadline: iso(23, 30, 30) }],
    P3: [],
  });
  set('notch-todo-doing-v1', { id: 't1', since: at(14) });
  set('notch-events-v1', [
    { id: 'e1', title: '课程录制', start: at(10), durationMin: 90 },
    { id: 'e2', title: '客户电话 · 报价确认', start: at(16), durationMin: 30 },
    { id: 'e3', title: '周复盘', start: at(20, 30), durationMin: 45 },
  ]);
  set('notch-focus-log-v1', [
    { start: at(9, 50), end: at(10, 15), minutes: 25, complete: true },
    { start: at(11), end: at(11, 25), minutes: 25 },
    { start: at(13, 5), end: at(13, 30), minutes: 25, complete: true },
  ]);
  return true;
})()`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1240,
    height: 616,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'home-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(seed);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const run = (script) => win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const text = (id) => $(id).textContent.replace(/\\s+/g, ' ').trim();
    ${script}
  })()`);
  const shot = async (name) => {
    if (!process.env.SOLODOCK_HOME_SCREENSHOT_DIR) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(process.env.SOLODOCK_HOME_SCREENSHOT_DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };

  // Idle: the doing todo, the focus ring, what comes next, and the energy facts.
  const idle = await run(`
    const at = (hour, minute = 0, day = 29) => new Date(2026, 8, day, hour, minute).getTime();
    window.__worklog = {
      '2026-09-25': { runs: [[at(8, 0, 25), at(19, 30, 25), 'active']] },
      '2026-09-28': { runs: [[at(9, 40, 28), at(17, 30, 28), 'active']] },
      '2026-09-29': { runs: [[at(9, 5), at(9, 50), 'active'], [at(9, 50), at(10, 15), 'focus'], [at(10, 15), at(11, 50), 'active'], [at(13), at(14, 20), 'active']] },
    };
    await setMode(true);
    await setActiveTab('home');
    await window.NotchHomeNow.refreshEnergy();
    await settle(200);
    const rect = (el) => el.getBoundingClientRect();
    const bento = rect($('home-bento'));
    return {
      label: text('now-label'),
      meta: text('now-meta'),
      chip: text('now-task-chip'),
      title: text('now-task-title'),
      due: text('now-task-due'),
      dial: $('now-dial').getAttribute('aria-valuetext'),
      dialNow: $('now-dial').getAttribute('aria-valuenow'),
      readout: $('now-dial').querySelector('.now-dial-read').textContent,
      arc: $('now-dial').querySelector('.now-dial-arc:not(.lap)').getAttribute('d'),
      lap: $('now-dial').querySelector('.now-dial-arc.lap').getAttribute('d'),
      ticks: $('now-dial').querySelectorAll('.now-dial-ticks line').length,
      next: [...document.querySelectorAll('#now-next-list li')].map((row) => [...row.children].slice(1).map((node) => node.textContent)),
      key: text('now-capture-key'),
      runningHidden: $('now-running').hidden,
      energy: {
        state: text('energy-state'),
        total: text('energy-total'),
        breakValue: text('energy-break-value'),
        breakWarn: $('energy-break').classList.contains('warn'),
        restVisible: !$('energy-rest').hidden,
        focus: text('energy-focus'),
        offwork: text('energy-offwork-value'),
        ticks: [...$('energy-ticks').children].map((node) => node.textContent).join(' '),
        segments: $('energy-track').querySelectorAll('i').length,
        focusSegments: $('energy-track').querySelectorAll('i.focus').length,
        days: [...$('energy-days').children].map((node) => node.textContent),
        bars: [...$('energy-bars').children].map((node) => node.className),
        weekNote: !$('energy-week-note').hidden,
        cardText: $('home-energy').textContent,
      },
      tiles: [...document.querySelectorAll('#home-bento [data-home-module]:not([hidden])')].map((tile) => {
        const box = rect(tile);
        const inner = [...tile.querySelectorAll('#now-idle, #now-running, .energy-body')].filter((block) => !block.hidden).map((block) => block.scrollHeight - block.clientHeight);
        return { id: tile.dataset.homeModule, inside: box.left >= bento.left - 1 && box.right <= bento.right + 1 && box.top >= bento.top - 1 && box.bottom <= bento.bottom + 1, overflow: Math.max(tile.scrollHeight - tile.clientHeight, ...inner) };
      }),
      settings: [...document.querySelectorAll('[data-settings-home-module]')].map((input) => [input.dataset.settingsHomeModule, input.checked]),
    };
  `);
  await shot('home-idle');
  assert.equal(idle.label, '现在');
  assert.equal(idle.meta, '今天第 4 个番茄', 'three sessions today (an old entry without the flag counts as full) make this the fourth');
  assert.equal(idle.chip, '课程');
  assert.equal(idle.title, '录制第 3 节课：Vibe coding 实战');
  assert.equal(idle.due, '今天 18:00 截止 · 还剩 3 小时 40 分');
  assert.equal(idle.dial, '专注 25 分钟');
  assert.equal(idle.dialNow, '25');
  assert.equal(idle.readout, '25分钟专注时长', 'the length is always readable in the middle of the dial');
  assert.match(idle.arc, /^M50 \d/, 'the ring is pulled out to 25 minutes before focus starts');
  assert.equal(idle.lap, '', 'no second lap under an hour');
  assert.equal(idle.ticks, 24, 'one turn of the dial is an hour, sparse ticks');
  assert.deepEqual(idle.next, [['16:00', '客户电话 · 报价确认', '日程 · 1 小时 40 分后'], ['20:30', '周复盘', '日程 · 6 小时 10 分后']]);
  assert.equal(idle.key, '⌥⇧N');
  assert.equal(idle.runningHidden, true);
  assert.deepEqual({ ...idle.energy, cardText: undefined }, {
    state: '该歇一会儿了',
    total: '4小时5分',
    breakValue: '48 分钟',
    breakWarn: true,
    restVisible: true,
    focus: '1 小时 15 分',
    offwork: '22:30 · 还有 8 小时 10 分',
    ticks: '9 12 15 18 21',
    segments: 4,
    focusSegments: 1,
    days: ['三', '四', '五', '六', '日', '一', '今天'],
    bars: ['rest', 'rest', 'long long', 'rest', 'rest', 'normal', 'today'],
    weekNote: true,
    cardText: undefined,
  });
  assert.doesNotMatch(idle.energy.cardText, /平均|平时|比昨天|比上周|多了|少了/, 'the energy card never compares days');
  assert.deepEqual(idle.tiles.map((tile) => tile.id), ['now', 'energy', 'usage', 'mirror']);
  assert.ok(idle.tiles.every((tile) => tile.inside && tile.overflow <= 1), JSON.stringify(idle.tiles));
  assert.deepEqual(idle.settings, [['now', true], ['energy', true], ['usage', true], ['mirror', true]]);

  // Pulling the ring (keyboard / wheel / pointer) and 换一件事.
  const choose = await run(`
    const dial = $('now-dial');
    const key = (name) => dial.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    for (let index = 0; index < 4; index += 1) key('PageUp');
    key('ArrowUp');
    await settle(400);
    const readout46 = dial.getAttribute('aria-valuetext');
    const stored = localStorage.getItem('notch-focus-minutes-v1');
    key('End');
    await settle(400);
    const end = { text: dial.getAttribute('aria-valuetext'), lap: dial.querySelector('.now-dial-arc.lap').getAttribute('d') };
    dial.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true }));
    await settle(400);
    const wheel = dial.getAttribute('aria-valuetext');
    // Pointer: back to the first lap, then press the right edge of the face (3 o'clock) and let go -> 15 minutes.
    key('Home');
    await settle(400);
    const face = dial.getBoundingClientRect();
    const at = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: face.left + face.width * (x + 6) / 112, clientY: face.top + face.height * (y + 6) / 112 });
    dial.dispatchEvent(new PointerEvent('pointerdown', at(90, 50)));
    dial.dispatchEvent(new PointerEvent('pointerup', at(90, 50)));
    await settle(500);
    const pointer = dial.getAttribute('aria-valuetext');
    key('Home');
    for (let index = 0; index < 5; index += 1) key('PageUp');
    key('ArrowDown');
    await settle(400);
    const back = dial.getAttribute('aria-valuetext');
    $('now-switch').click();
    await settle();
    const picker = $('now-picker');
    const items = [...picker.querySelectorAll('[role="menuitemradio"]')].map((button) => [button.querySelector('span').textContent, button.querySelector('em').textContent, button.getAttribute('aria-checked')]);
    const card = $('home-now').getBoundingClientRect();
    const box = picker.getBoundingClientRect();
    const inside = box.top >= card.top && box.bottom <= card.bottom && box.left >= card.left && box.right <= card.right;
    picker.querySelector('[data-id="t2"]').click();
    await settle();
    const switched = { title: text('now-task-title'), chip: text('now-task-chip'), doing: window.NotchTodos.doing().id, pickerHidden: picker.hidden };
    $('now-switch').click();
    picker.querySelector('[data-id="t1"]').click();
    await settle();
    return { readout46, stored, end, wheel, pointer, back25: back, items, inside, switched, back: text('now-task-title') };
  `);
  assert.equal(choose.readout46, '专注 46 分钟', 'PageUp is 5 minutes, ArrowUp is 1');
  assert.equal(choose.stored, '46');
  assert.equal(choose.end.text, '专注 120 分钟');
  assert.match(choose.end.lap, /^M50 \d/, 'past an hour the ring goes round a second lap');
  assert.equal(choose.wheel, '专注 119 分钟');
  assert.equal(choose.pointer, '专注 15 分钟', 'tapping the face jumps the ring there');
  assert.equal(choose.back25, '专注 25 分钟');
  assert.deepEqual(choose.items, [['录制第 3 节课：Vibe coding 实战', '18:00', 'true'], ['交付封面终稿', '21:00', 'false'], ['写本周 Newsletter', '明天', 'false']]);
  assert.equal(choose.inside, true, 'the picker stays inside the card');
  assert.deepEqual(choose.switched, { title: '交付封面终稿', chip: '客户', doing: 't2', pickerHidden: true });
  assert.equal(choose.back, '录制第 3 节课：Vibe coding 实战');

  // Focus: the running layout, held AI notices, pause, +5 minutes and the energy card.
  const focus = await run(`
    $('now-start').click();
    await settle();
    window.__handlers.onFocusHeld.forEach((callback) => callback(2));
    await settle();
    const running = {
      state: $('home-now').dataset.state,
      label: text('now-label'),
      meta: text('now-meta'),
      title: text('now-running-title'),
      chip: text('now-running-chip'),
      remaining: $('now-dial').querySelector('.now-dial-read').textContent,
      discLabel: $('now-dial').getAttribute('aria-valuetext'),
      tone: $('now-dial').dataset.tone,
      tomatoes: text('now-tomatoes'),
      bars: $('now-tomatoes').querySelectorAll('i').length,
      held: $('now-held').hidden ? '' : text('now-held-text'),
      idleHidden: $('now-idle').hidden,
      energyState: text('energy-state'),
      energyBreak: text('energy-break-value'),
      restHidden: $('energy-rest').hidden,
      reported: window.__focus.at(-1).running === true && window.__focus.at(-1).mode === 'focus' && window.__focus.at(-1).endsAt > Date.now(),
    };
    $('now-pause').click();
    await settle();
    const paused = { state: $('home-now').dataset.state, label: text('now-label'), button: text('now-pause'), meta: text('now-meta'), reported: window.__focus.at(-1).running, tone: $('now-dial').dataset.tone };
    $('now-dial').dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true }));
    await settle(400);
    const redialed = { left: window.NotchPomodoro.state().remaining, text: $('now-dial').getAttribute('aria-valuetext') };
    $('now-pause').click();
    $('now-extend').click();
    await settle();
    const extended = window.NotchPomodoro.state().session;
    $('now-finish').click();
    await settle();
    return { running, paused, redialed, extended, after: { state: $('home-now').dataset.state, log: JSON.parse(localStorage.getItem('notch-focus-log-v1')).length, held: $('now-held').hidden } };
  `);
  await shot('home-focus');
  assert.deepEqual({ ...focus.running, meta: undefined }, {
    state: 'running',
    label: '专注中',
    meta: undefined,
    title: '录制第 3 节课：Vibe coding 实战',
    chip: '课程',
    remaining: focus.running.remaining,
    discLabel: focus.running.discLabel,
    tone: 'focus',
    tomatoes: '今天已完成 3 个',
    bars: 4,
    held: '收起了 2 条 AI 完成通知，专注结束后一起告诉你',
    idleHidden: true,
    energyState: '专注中',
    energyBreak: '这段专注 0 分钟',
    restHidden: true,
    reported: true,
  });
  assert.match(focus.running.meta, /^第 4 个番茄 · 14:4\d 结束$/);
  assert.match(focus.running.remaining, /^25分钟14:4\d 结束$/, 'the dial shows the minutes left and when it ends, same place as before starting');
  assert.match(focus.running.discLabel, /^还剩 25 分钟，14:4\d 结束$/);
  assert.deepEqual({ ...focus.paused, meta: undefined }, { state: 'paused', label: '已暂停', button: '继续', meta: undefined, reported: false, tone: 'paused' });
  assert.equal(focus.paused.meta, '第 4 个番茄 · 已暂停');
  assert.deepEqual(focus.redialed, { left: 20 * 60, text: '已暂停，还剩 20 分钟' }, 'the ring can be pulled back mid-session');
  assert.ok(Math.abs(focus.extended - 25 * 60) <= 1, '+5 分钟 lengthens what is left');
  assert.deepEqual(focus.after, { state: 'idle', log: 3, held: true }, 'ending within a minute does not log a session');

  // A session that runs to the end becomes a tomato; the reminder window hears about it.
  const complete = await run(`
    window.NotchPomodoro.start(4, 'focus', { task: window.NotchHomeNow.task() });
    await settle(2200);
    const midway = $('now-dial').querySelector('.now-dial-arc:not(.lap)').getAttribute('d');
    await settle(2600);
    const log = JSON.parse(localStorage.getItem('notch-focus-log-v1'));
    return { midway, state: $('home-now').dataset.state, last: log.at(-1).complete, count: log.length, meta: text('now-meta'), notified: window.__calls.filter((call) => call[0] === 'pomodoro').map((call) => call[1].mode) };
  `);
  assert.match(complete.midway, /^M50 \d/, 'halfway through, a sliver of ring is left');
  assert.deepEqual({ ...complete, midway: undefined }, { midway: undefined, state: 'idle', last: true, count: 4, meta: '今天第 5 个番茄', notified: ['focus'] });

  // 休息 5 分钟 from the energy card restarts the break timer and shows the break layout.
  const rest = await run(`
    // A paused focus session is ended (not silently dropped) before the break starts.
    window.NotchPomodoro.start(25 * 60, 'focus');
    window.NotchPomodoro.pause();
    await settle();
    const restVisibleWhilePaused = !$('energy-rest').hidden;
    $('energy-rest').click();
    await settle(200);
    const during = { restVisibleWhilePaused, logUnchanged: JSON.parse(localStorage.getItem('notch-focus-log-v1')).length === 4, state: $('home-now').dataset.state, label: text('now-label'), finish: text('now-finish'), extendHidden: $('now-extend').hidden, tomatoesHidden: $('now-tomatoes').hidden, energyState: text('energy-state'), calls: window.__calls.filter((call) => call[0] === 'take-break').length };
    $('now-finish').click();
    await settle();
    return { during, after: $('home-now').dataset.state };
  `);
  await shot('home-break-after');
  assert.deepEqual(rest, { during: { restVisibleWhilePaused: true, logUnchanged: true, state: 'break', label: '休息中', finish: '结束休息', extendHidden: true, tomatoesHidden: true, energyState: '休息中', calls: 1 }, after: 'idle' });

  // 记一笔: text with a time becomes a todo, plain text goes to today's capture note.
  const capture = await run(`
    const input = $('now-capture-input');
    input.value = '明天下午3点 给客户回电话';
    $('now-capture').requestSubmit();
    await settle(200);
    const todo = window.NotchTodos.list().find((item) => item.text.includes('回电话'));
    const deadline = todo ? new Date(todo.deadline) : null;
    const afterTodo = input.value;
    input.value = '灵感：首页可以放一句天气';
    $('now-capture').requestSubmit();
    await settle(200);
    const notes = localStorage.getItem('notch-note-archive-v1') || '';
    return { todo: todo ? [todo.text, deadline.getDate(), deadline.getHours()] : null, afterTodo, note: notes.includes('首页可以放一句天气'), afterNote: input.value };
  `);
  assert.deepEqual(capture, { todo: ['给客户回电话', 30, 15], afterTodo: '', note: true, afterNote: '' });

  // Visibility: hidden cards leave no gap, at least one card stays, old preferences carry over.
  const visibility = await run(`
    const widths = () => Object.fromEntries([...document.querySelectorAll('#home-bento [data-home-module]')].map((tile) => [tile.dataset.homeModule, Math.round(tile.getBoundingClientRect().width)]));
    const before = widths();
    const energy = window.NotchHome.setModuleVisible('energy', false);
    await settle();
    const withoutEnergy = widths();
    window.NotchHome.setModuleVisible('usage', false);
    window.NotchHome.setModuleVisible('mirror', false);
    await settle();
    const sideHidden = getComputedStyle($('home-side')).display === 'none';
    const onlyNow = widths().now;
    const refused = window.NotchHome.setModuleVisible('now', false);
    const stored = JSON.parse(localStorage.getItem('notch-home-hidden-modules-v2'));
    const toggles = [...document.querySelectorAll('[data-settings-home-module]')].map((input) => input.checked);
    ['energy', 'usage', 'mirror'].forEach((id) => window.NotchHome.setModuleVisible(id, true));
    await settle();
    return { energy, before, withoutEnergy, sideHidden, onlyNow, refused, stored, toggles, restored: window.NotchHome.getVisibility().visibleIds };
  `);
  assert.deepEqual(visibility.energy, { ok: true, changed: true, hiddenIds: ['energy'], persisted: true });
  assert.ok(visibility.withoutEnergy.now > visibility.before.now, 'the remaining cards fill the space');
  assert.equal(visibility.withoutEnergy.energy, 0);
  assert.equal(visibility.sideHidden, true);
  assert.ok(visibility.onlyNow > 1100, `现在 fills the row: ${visibility.onlyNow}`);
  assert.equal(visibility.refused.error, 'at_least_one_required');
  assert.deepEqual(visibility.stored, ['energy', 'usage', 'mirror']);
  assert.deepEqual(visibility.toggles, [true, false, false, false]);
  assert.deepEqual(visibility.restored, ['now', 'energy', 'usage', 'mirror']);

  // With work-time tracking off the energy card says so and links to settings.
  const off = await run(`
    window.__worklogEnabled = false;
    await window.NotchHomeNow.refreshEnergy();
    return { offVisible: !$('energy-off').hidden, bodyHidden: $('energy-body').hidden, state: text('energy-state') };
  `);
  assert.deepEqual(off, { offVisible: true, bodyHidden: true, state: '未开启' });

  // Upgrading from the old home keeps a hidden photo frame hidden; the old cards are gone.
  await win.webContents.executeJavaScript(`localStorage.removeItem('notch-home-hidden-modules-v2'); localStorage.setItem('notch-home-hidden-modules-v1', JSON.stringify(['recorder', 'windows', 'mirror', 'note'])); true`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const upgraded = await run(`return { hidden: window.NotchHome.getVisibility().hiddenIds, oldCards: ['home-pomodoro', 'home-recorder', 'home-note', 'home-today', 'window-list'].filter((id) => $(id)).length };`);
  assert.deepEqual(upgraded, { hidden: ['mirror'], oldCards: 0 });

  assert.deepEqual(errors, []);
  console.log('Home checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
