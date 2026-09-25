const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Quick capture renderer timed out'); app.exit(1); }, 40000);

async function reducedMotion(win) {
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}

app.whenReady().then(async () => {
  const errors = [];
  const watch = (win) => win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });

  // ---------------- The capture window ----------------
  const capture = new BrowserWindow({
    width: 600,
    height: 360,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'capture-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  watch(capture);
  await capture.loadFile(path.join(__dirname, '..', 'renderer', 'capture.html'));
  // The window only reads the panel's data for its preview: category names, the latest todo, habits.
  await capture.webContents.executeJavaScript(`(() => {
    localStorage.setItem('notch-todo-category-names-v1', JSON.stringify({ P0: '课程', P1: '自媒体&写作', P2: 'Vibe coding', P3: '日常' }));
    localStorage.setItem('notch-todo-data', JSON.stringify({ P0: [], P1: [{ id: 'a', text: 'old', createdAt: 1 }], P2: [{ id: 'b', text: 'newest', createdAt: 9 }], P3: [] }));
    localStorage.removeItem('notch-life-v1');
    return true;
  })()`);
  await reducedMotion(capture);

  const result = await capture.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 90) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const input = $('capture-input');
    const key = (options) => input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
    const type = async (text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); await settle(30); };
    const view = () => ({
      type: $('capture-card').dataset.type,
      color: $('capture-card').dataset.color || '',
      selected: document.querySelector('.capture-types [aria-selected="true"]')?.textContent || '',
      pills: [...document.querySelectorAll('.capture-types button')].filter((button) => button.dataset.unavailable !== 'true').map((button) => button.textContent),
      target: $('capture-target-text').textContent,
      state: $('capture-target').dataset.state || '',
    });
    const submits = () => window.__calls.filter((call) => call[0] === 'submit').map((call) => call[1]);
    const out = {};

    out.closed = document.getElementById('capture-root').classList.contains('is-open');
    window.__handlers.open();
    await settle(120);
    out.opened = [$('capture-root').classList.contains('is-open'), document.activeElement === input, view()];

    // Live detection: a todo with a date, in the category of the latest todo.
    await type('明天下午3点 给王总回电话');
    out.todo = view();
    key({ key: '1', metaKey: true });
    out.category = view().target;
    key({ key: 'Tab' });
    out.tab = view().selected;
    key({ key: 'Tab', shiftKey: true });
    out.shiftTab = view().selected;
    // Enter while the input method is still composing belongs to the input method.
    key({ key: 'Enter', isComposing: true });
    out.composingSubmits = submits().length;
    key({ key: 'Enter' });
    await settle(200);
    out.submitted = submits()[0];
    out.cleared = input.value;

    // A link with its own title; ⌘↩ saves and opens.
    window.__handlers.open();
    await settle(120);
    await type('https://www.figma.com/files 封面稿');
    out.link = view();
    key({ key: 'Enter', metaKey: true });
    await settle(200);
    out.linkSubmit = submits()[1];

    // A todo that says only when: shake, do not save.
    window.__handlers.open();
    await settle(120);
    await type('明天3点');
    out.invalid = view();
    key({ key: 'Enter' });
    await settle();
    out.invalidSubmits = submits().length;
    out.shaking = $('capture-card').classList.contains('is-shaking');

    // Life: the habit colour, and a click on the target picks the next habit.
    await type('跑步 5km 32分钟');
    out.life = view();
    $('capture-target').click();
    out.lifeNext = view().target;

    // More lines grow the window; ⇧↩ is a new line, not a save.
    const heights = () => window.__calls.filter((call) => call[0] === 'resize').map((call) => call[1]);
    await type('一行');
    const single = heights().at(-1);
    await type('会议纪要\\n1. 初稿\\n2. 复盘\\n3. 发布');
    out.grew = [single, heights().at(-1)];
    out.note = view();
    key({ key: 'Enter', shiftKey: true });
    out.shiftEnterSubmits = submits().length;

    // Clicking elsewhere hides it and keeps the draft, selected, for next time.
    await type('草稿先放这');
    window.__handlers.hide('blur');
    window.__handlers.open();
    await settle(120);
    out.draft = [input.value, input.selectionStart, input.selectionEnd];

    // Esc cancels and clears; the forwarded Esc is ignored while composing.
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    window.__handlers.escape();
    await settle(160);
    out.escapeWhileComposing = [window.__calls.some((call) => call[0] === 'cancel'), input.value];
    input.dispatchEvent(new CompositionEvent('compositionend'));
    await settle(200);
    key({ key: 'Escape' });
    await settle(200);
    out.escaped = [window.__calls.filter((call) => call[0] === 'cancel').map((call) => call[1]), input.value];
    return out;
  })()`);

  assert.equal(result.closed, false, 'hidden until the shortcut opens it');
  assert.deepEqual(result.opened.slice(0, 2), [true, true]);
  assert.deepEqual(result.opened[2].pills, ['随笔', '待办', '生活'], 'link is only offered with a URL');
  assert.equal(result.opened[2].state, 'hint');
  assert.deepEqual(result.todo, { type: 'todo', color: 'cat-3', selected: '待办', pills: ['随笔', '待办', '生活'], target: 'Vibe coding · 明天 15:00', state: '' });
  assert.equal(result.category, '课程 · 明天 15:00', '⌘1 picks the first category');
  assert.equal(result.tab, '生活');
  assert.equal(result.shiftTab, '待办');
  assert.equal(result.composingSubmits, 0);
  assert.deepEqual(result.submitted, { text: '明天下午3点 给王总回电话', type: 'todo', category: 'P0', habitId: '', open: false });
  assert.equal(result.cleared, '');
  assert.deepEqual([result.link.type, result.link.target, result.link.pills], ['link', 'figma.com · 封面稿', ['随笔', '待办', '链接', '生活']]);
  assert.deepEqual(result.linkSubmit, { text: 'https://www.figma.com/files 封面稿', type: 'link', category: '', habitId: '', open: true });
  assert.deepEqual([result.invalid.state, result.invalid.target], ['invalid', '写上要做什么']);
  assert.equal(result.invalidSubmits, 2);
  assert.equal(result.shaking, true);
  assert.deepEqual([result.life.type, result.life.color, result.life.target], ['life', 'cat-3', '运动 · 跑步 · 32 分钟 · 5km']);
  assert.match(result.lifeNext, /^冥想/);
  assert.ok(result.grew[1] > result.grew[0] + 48, `four lines are taller than one (${result.grew})`);
  assert.equal(result.note.type, 'note');
  assert.equal(result.shiftEnterSubmits, 2);
  assert.deepEqual(result.draft, ['草稿先放这', 0, 5]);
  assert.deepEqual(result.escapeWhileComposing, [false, '草稿先放这']);
  assert.deepEqual(result.escaped, [['escape'], '']);

  if (process.env.SOLODOCK_CAPTURE_SCREENSHOT_DIR) {
    const dir = process.env.SOLODOCK_CAPTURE_SCREENSHOT_DIR;
    for (const [name, text] of [['capture-todo', '明天下午3点 给王总回电话'], ['capture-life', '跑步 5km 32分钟'], ['capture-empty', '']]) {
      await capture.webContents.executeJavaScript(`(async () => {
        window.__handlers.hide('submit');
        window.__handlers.open();
        const input = document.getElementById('capture-input');
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 300));
        return true;
      })()`);
      fs.writeFileSync(path.join(dir, `${name}.png`), (await capture.webContents.capturePage()).toPNG());
    }
  }
  // Keep the capture window until the end: destroying it right before loading another file:// page
  // can hand the new page a renderer process that is still shutting down (ERR_FAILED).

  // ---------------- The panel stores what the capture window hands it ----------------
  const panel = new BrowserWindow({
    width: 1240,
    height: 616,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'panel-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  watch(panel);
  await panel.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await reducedMotion(panel);
  const stored = await panel.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
    const add = async (entry) => { window.__handlers.onCaptureAdd.forEach((callback) => callback({ category: '', habitId: '', open: false, at: Date.now(), ...entry })); await settle(); };
    const flash = () => window.NotchNotchStatus.current()?.text || '';
    const out = {};
    out.collapsed = !document.getElementById('app').classList.contains('expanded');

    await add({ text: '明天下午3点 给王总回电话', type: 'todo', category: 'P0' });
    const todo = window.NotchTodos.items().P0.find((item) => item.text === '给王总回电话');
    const due = new Date(todo?.deadline || 0);
    out.todo = [Boolean(todo), due.getHours(), due.getMinutes(), new Date(Date.now() + 86400000).getDate() === due.getDate()];
    out.todoFlash = [flash(), window.NotchNotchStatus.current()?.kind, document.getElementById('notch-status').dataset.icon];

    await add({ text: '封面换暖色', type: 'note' });
    await add({ text: '第二条\\n还有一行', type: '' });
    const notes = JSON.parse(localStorage.getItem('notch-note-archive-v1') || '[]').filter((note) => note.title.startsWith('随手记 · '));
    out.notes = [notes.length, notes[0]?.content.replace(/\\d\\d:\\d\\d/g, 'HH:MM'), notes[0]?.titleSource];
    out.noteFlash = flash();

    await add({ text: 'https://www.figma.com/files 封面稿', type: 'link' });
    const links = JSON.parse(localStorage.getItem('notch-link-groups') || '[]').flatMap((group) => group.links || []);
    out.link = links.filter((link) => link.url === 'https://www.figma.com/files').map((link) => link.title);
    await add({ text: 'https://www.figma.com/files', type: 'link' });
    out.duplicate = flash();

    await add({ text: '跑步 5km 32分钟', type: 'life', habitId: 'exercise' });
    out.life = window.NotchLifePage.state().records.filter((record) => record.habitId === 'exercise').map((record) => [record.item, record.minutes, record.note]);
    out.lifeFlash = flash();

    // ⌘↩: open the panel on the saved item.
    await add({ text: '记得买猫粮', type: 'todo', category: 'P3', open: true });
    await settle(300);
    out.opened = [document.getElementById('app').classList.contains('expanded'), document.querySelector('#tab-todo.active') !== null, document.getElementById('status-toast-message').textContent];
    out.flashed = document.querySelector('.task-row.flash')?.dataset.id === window.NotchTodos.items().P3.find((item) => item.text === '买猫粮')?.id;

    // Settings: the capture shortcut row says when another app holds the shortcut.
    window.__handlers.onAppSettingsChanged.forEach((callback) => callback({ features: {}, shortcut: 'Space', captureShortcut: 'Alt+Shift+N', captureShortcutRegistered: false }));
    const row = document.getElementById('settings-capture-value');
    out.taken = [row.textContent, row.dataset.state];
    window.__handlers.onAppSettingsChanged.forEach((callback) => callback({ features: {}, shortcut: 'Space', captureShortcut: 'Alt+Shift+N', captureShortcutRegistered: true }));
    out.free = row.textContent;

    // The recorder sets the capture shortcut: modifiers required; a taken one is refused.
    window.notchAPI.setCaptureShortcut = async (accelerator) => {
      window.__calls.push(['capture-shortcut', accelerator]);
      return accelerator === 'Alt+Shift+K' ? { ok: true, shortcut: accelerator } : { ok: false, error: 'occupied' };
    };
    document.getElementById('settings-capture-change').click();
    await settle();
    const recorder = document.getElementById('shortcut-recorder');
    const press = async (init) => { recorder.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); await settle(); return document.getElementById('shortcut-recorder-value').textContent; };
    out.recorder = [!recorder.hidden, document.getElementById('shortcut-recorder-title').textContent];
    out.bare = await press({ key: 'k' });
    out.occupied = await press({ key: 'j', altKey: true, shiftKey: true });
    out.accepted = [await press({ key: 'k', altKey: true, shiftKey: true }), document.getElementById('status-toast-message').textContent];
    out.shortcutCalls = window.__calls.filter((call) => call[0] === 'capture-shortcut').map((call) => call[1]);
    return out;
  })()`);

  assert.equal(stored.collapsed, true);
  assert.deepEqual(stored.todo, [true, 15, 0, true]);
  assert.deepEqual(stored.todoFlash, ['已加待办 · 明天 15:00', 'saved', 'check']);
  assert.deepEqual(stored.notes, [1, '- HH:MM 封面换暖色\n- HH:MM 第二条\n  还有一行', 'user']);
  assert.equal(stored.noteFlash, '已存入随手记');
  assert.deepEqual(stored.link, ['封面稿']);
  assert.equal(stored.duplicate, '这个链接已经收藏过了');
  assert.deepEqual(stored.life, [['跑步', 32, '5km']]);
  assert.equal(stored.lifeFlash, '已记一笔 · 运动');
  assert.equal(stored.opened[0], true);
  assert.equal(stored.opened[1], true);
  assert.match(stored.opened[2], /^已加待办 · /);
  assert.equal(stored.flashed, true);
  assert.deepEqual(stored.taken, ['⌥⇧N 被其他应用占用，换一个', 'warning']);
  assert.equal(stored.free, '⌥⇧N · 在任何应用里记一条');
  assert.deepEqual(stored.recorder, [true, '按下新的随手记快捷键']);
  assert.equal(stored.bare, '请搭配 ⌥ / ⌃ / ⇧ / ⌘');
  assert.equal(stored.occupied, '该快捷键已被占用');
  assert.deepEqual(stored.accepted, ['⌥⇧K', '随手记快捷键已设为 ⌥⇧K']);
  assert.deepEqual(stored.shortcutCalls, ['Alt+Shift+J', 'Alt+Shift+K']);

  assert.deepEqual(errors, []);
  console.log('Quick capture checks passed');
  clearTimeout(deadline);
  panel.destroy();
  capture.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
