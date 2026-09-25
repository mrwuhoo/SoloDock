const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Command palette renderer timed out'); app.exit(1); }, 40000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1240,
    height: 616,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'panel-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Seed notes, prompts, links and clipboard, then reload so every module reads them at start.
  await win.webContents.executeJavaScript(`(() => {
    const now = Date.now();
    localStorage.setItem('notch-note-archive-v1', JSON.stringify([
      { id: 'n1', title: '第 12 期脚本', content: '一人公司怎么排一周，封面用暖色', createdAt: now - 5000, updatedAt: now - 5000 },
      ...Array.from({ length: 6 }, (_, index) => ({ id: 'w' + index, title: '周报 ' + index, content: '本周进展', createdAt: now - index * 1000, updatedAt: now - index * 1000 })),
    ]));
    localStorage.setItem('notch-prompts-v1', JSON.stringify([
      { id: 'p1', title: '封面文案', text: '给这期视频写三个封面标题', group: '写作', createdAt: now, updatedAt: now },
      { id: 'p2', title: '改写成口播', text: '把 {原文} 改成口语', group: '写作', createdAt: now, updatedAt: now },
    ]));
    localStorage.setItem('notch-link-groups', JSON.stringify([{ id: 'g1', name: '设计', links: [{ id: 'l1', url: 'https://www.figma.com/files', title: 'Figma 封面稿', createdAt: now }] }]));
    localStorage.setItem('notch-clip-history', JSON.stringify([{ id: 'c1', type: 'text', text: '封面主色 #397DDD', createdAt: now }]));
    return true;
  })()`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const key = (options) => $('palette-input').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options }));
    const type = async (text) => { $('palette-input').value = text; $('palette-input').dispatchEvent(new Event('input', { bubbles: true })); await settle(); };
    const view = () => ({
      groups: [...document.querySelectorAll('.palette-group header span')].map((node) => node.textContent),
      rows: [...document.querySelectorAll('.palette-row b')].map((node) => node.textContent),
      active: document.querySelector('.palette-row[aria-selected="true"] b')?.textContent || '',
    });
    window.__credentials = [{ id: 'k1', kind: 'apikey', service: 'OpenAI 封面生成', account: 'OPENAI_API_KEY', url: '', passwordMask: '**********', createdAt: 1 }];
    data.P1.push({ id: 'todo-cover', text: '交付封面终稿', done: false, createdAt: Date.now(), deadline: '', remindedAt: 0 });
    saveData(data);
    renderList('P1');
    await setMode(true);
    await setActiveTab('home');
    const out = {};

    // ⌘K opens with quick actions; the input has focus.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await settle(150);
    out.opened = [!$('palette').hidden, document.activeElement === $('palette-input')];
    out.empty = view();

    // One search across everything, grouped by type.
    await type('封面');
    out.search = view();
    key({ key: 'ArrowDown' });
    out.afterDown = view().active;
    key({ key: 'Tab' });
    await settle();
    out.filtered = [document.querySelector('.palette-filters [aria-selected="true"]').textContent, view().groups];
    key({ key: 'Tab', shiftKey: true });
    await settle();

    // Enter on the todo: the palette closes and the todo flashes on its page.
    key({ key: 'Enter' });
    await settle(250);
    out.todo = [$('palette').hidden, document.querySelector('#tab-todo.active') !== null, document.querySelector('.todo-item[data-id="todo-cover"]')?.classList.contains('flash')];

    // A note opens on the notes page, selected.
    await window.NotchPalette.open();
    await type('第 12 期');
    key({ key: 'Enter' });
    await settle(250);
    out.note = [document.querySelector('#tab-notes.active') !== null, document.getElementById('notes-page').dataset.library, document.querySelector('#notes-list .notes-list-item.active')?.textContent.includes('第 12 期脚本')];

    // A link opens in the browser; the clipboard entry pastes with ⌘↩; a prompt without variables copies.
    await window.NotchPalette.open();
    await type('figma');
    key({ key: 'Enter' });
    await settle();
    await window.NotchPalette.open();
    await type('主色');
    key({ key: 'Enter', metaKey: true });
    await settle();
    await window.NotchPalette.open();
    await type('封面文案');
    key({ key: 'Enter' });
    await settle(150);
    out.calls = window.__calls.filter((call) => ['open-external', 'paste', 'write-clipboard'].includes(call[0])).map((call) => [call[0], call[1].text || call[1].url || call[1]]);

    // A prompt that needs input opens for filling instead.
    await window.NotchPalette.open();
    await type('口播');
    key({ key: 'Enter' });
    await settle(200);
    out.promptNeedsInput = [document.querySelector('#tab-notes.active') !== null, document.getElementById('notes-page').dataset.library, $('status-toast-message').textContent];

    // Credentials: copy only; ⌘↩ never pastes a secret.
    await window.NotchPalette.open();
    await type('openai');
    key({ key: 'Enter', metaKey: true });
    await settle();
    out.secretPaste = [$('status-toast-message').textContent, window.__calls.some((call) => call[0] === 'paste' && JSON.stringify(call[1]).includes('OPENAI'))];
    key({ key: 'Enter' });
    await settle();
    out.secretCopy = window.__calls.filter((call) => call[0] === 'copy-credential').map((call) => call.slice(1));

    // Locked vault: say so instead of pretending there is nothing.
    window.__vaultLocked = true;
    await window.NotchPalette.open();
    await type('openai');
    out.locked = view();
    // Esc (forwarded by the main process) closes the palette, not the panel.
    window.__handlers.onEscape.forEach((callback) => callback());
    await settle();
    out.escape = [$('palette').hidden, document.getElementById('app').classList.contains('expanded')];
    window.__vaultLocked = false;

    // "查看全部" jumps to the page with the query.
    await window.NotchPalette.open();
    await type('周报');
    out.more = document.querySelector('.palette-more')?.textContent || '';
    document.querySelector('.palette-more')?.click();
    await settle(250);
    out.moreLanded = [document.querySelector('#tab-notes.active') !== null, $('notes-search').value];

    // Recently used items come back on an empty search.
    await window.NotchPalette.open();
    await settle();
    out.recent = view();
    window.NotchPalette.close();
    return out;
  })()`);

  assert.deepEqual(result.opened, [true, true]);
  assert.deepEqual(result.empty.groups, ['快捷操作']);
  assert.deepEqual(result.empty.rows, ['新建笔记', '添加待办', '开始专注', '开始录音']);
  assert.deepEqual(result.search.groups, ['待办', '笔记', '提示词', '链接', '剪贴板', '密钥']);
  assert.equal(result.search.active, '交付封面终稿');
  assert.equal(result.afterDown, '第 12 期脚本');
  assert.deepEqual(result.filtered, ['待办', ['待办']]);
  assert.deepEqual(result.todo, [true, true, true]);
  assert.deepEqual(result.note, [true, 'notes', true]);
  assert.deepEqual(result.calls, [
    ['open-external', 'https://www.figma.com/files'],
    ['paste', '封面主色 #397DDD'],
    ['write-clipboard', '给这期视频写三个封面标题'],
  ]);
  assert.deepEqual(result.promptNeedsInput, [true, 'prompts', '先填好变量再复制']);
  assert.deepEqual(result.secretPaste, ['密钥只能复制，不会粘贴到其他应用', false]);
  assert.deepEqual(result.secretCopy, [['k1', 'password']]);
  assert.deepEqual(result.locked.rows, ['密钥已锁定']);
  assert.deepEqual(result.escape, [true, true]);
  assert.equal(result.more, '查看全部 6 条');
  assert.deepEqual(result.moreLanded, [true, '周报']);
  assert.deepEqual(result.recent.groups, ['最近使用', '快捷操作']);
  assert.equal(result.recent.rows[0], 'OpenAI 封面生成', 'the latest used first');

  if (process.env.SOLODOCK_PALETTE_SCREENSHOT_DIR) {
    await win.webContents.executeJavaScript(`(async () => {
      await setActiveTab('home');
      await window.NotchPalette.open();
      document.getElementById('palette-input').value = '封面';
      document.getElementById('palette-input').dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    fs.writeFileSync(path.join(process.env.SOLODOCK_PALETTE_SCREENSHOT_DIR, 'palette.png'), (await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Command palette checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
