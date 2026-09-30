const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Notes page renderer timed out'); app.exit(1); }, 50000);

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
  await win.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    const now = Date.now();
    const day = 86400000;
    const monday = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() - ((d.getDay() + 6) % 7) * day; })();
    localStorage.setItem('notch-note-archive-v1', JSON.stringify([
      { id: 'today', title: '客户电话要点', titleSource: 'user', content: '合同第 4 条的交付时间要改到 11 月 20 日', createdAt: now - 60000, updatedAt: now - 60000 },
      { id: 'tools', title: '一人公司工具栈', titleSource: 'user', content: '## 原则\\n工具要少而精。\\n\\n- [ ] 把密码迁到密钥\\n- [x] 清理剪贴板\\n\\n> 扶手不是工作台', createdAt: monday - 30 * day, updatedAt: (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12).getTime(); })() },
      { id: 'old', title: '会议纪要', titleSource: 'user', content: '讨论了发布节奏', createdAt: monday - 5 * day, updatedAt: monday - 5 * day },
    ]));
    localStorage.setItem('notch-prompts-v1', JSON.stringify([
      { id: 'p1', title: '客户报价回复', text: '{称呼}好，关于{项目}的报价，日期 {日期}', group: '客户', createdAt: now, updatedAt: now },
    ]));
    return true;
  })()`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const archive = () => JSON.parse(localStorage.getItem('notch-note-archive-v1'));
    const note = (id) => archive().find((item) => item.id === id);
    const key = (keyName, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, metaKey: true, bubbles: true, cancelable: true, ...extra }));
    window.notchAPI.exportNote = async (payload) => { window.__exported = payload; return { ok: true }; };
    await setMode(true);
    await setActiveTab('notes');
    window.NotchPromptLibrary.setLibrary('notes');
    await settle(150);
    const out = {};

    // Groups by update time; each row shows a time on the right and a one-line excerpt.
    const view = () => [...$('notes-list').children].map((node) => node.classList.contains('notes-group') ? '#' + node.textContent : node.querySelector('strong').textContent);
    out.groups = view();
    out.excerpt = document.querySelector('[data-note-id="tools"] .notes-row-excerpt').textContent;

    // A 随笔 left over from the old home card becomes today's 「M月D日 随笔」, pinned first with a chip.
    // (The home card itself is gone; its text lives on in notch-home-note until the day rolls over.)
    const home = {
      get value() { return localStorage.getItem('notch-home-note') || ''; },
      set value(text) { localStorage.setItem('notch-home-note', text); window.NotchNotes.syncHomeNote(text); },
      dispatchEvent() {},
    };
    home.value = '今日重点：回复王总的报价邮件';
    home.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(450);
    const today = new Date();
    const suibiTitle = (today.getMonth() + 1) + '月' + today.getDate() + '日 随笔';
    const suibi = archive().find((item) => item.title === suibiTitle);
    out.suibi = [Boolean(suibi), suibi?.content, view().slice(0, 2), document.querySelector('.notes-chip')?.textContent];
    home.value = '今日重点：回复王总的报价邮件\\n整理发票';
    home.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(450);
    out.suibiUpdated = [archive().filter((item) => item.title === suibiTitle).length, note(suibi.id).content.endsWith('整理发票')];

    // Opening a note with content shows the preview; ticking a task box writes back to the Markdown.
    document.querySelector('[data-note-id="tools"]').click();
    await settle();
    out.preview = [window.NotchNotes.state().mode, $('notes-detail').querySelector('.nd-preview h2')?.textContent, $('notes-detail').querySelectorAll('.nd-preview .note-task-item').length, $('notes-detail').querySelector('.nd-preview blockquote')?.textContent];
    $('notes-detail').querySelector('.note-task-item[data-line="3"]').click();
    await settle();
    out.ticked = [note('tools').content.includes('- [x] 把密码迁到密钥'), $('notes-detail').querySelector('.note-task-item[data-line="3"]').classList.contains('done')];

    // ⌘E edits in the same font with Markdown marks dimmed; saving waits 800ms after typing stops.
    key('e');
    await settle();
    const input = $('notes-detail').querySelector('.nd-input');
    out.edit = [window.NotchNotes.state().mode, Boolean(input), $('notes-detail').querySelectorAll('.nd-mark').length > 0];
    input.value += '\\n新的一行';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(200);
    out.beforeSave = [note('tools').content.includes('新的一行'), $('notes-detail').querySelector('.nd-meta').textContent.startsWith('正在保存')];
    await settle(800);
    out.afterSave = [note('tools').content.includes('新的一行'), $('notes-detail').querySelector('.nd-meta').textContent.startsWith('自动保存于'), $('notes-detail').querySelector('.nd-status').textContent.startsWith('更新于')];

    // A failed save says so and retries by itself.
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === 'notch-note-archive-v1') throw new Error('QuotaExceededError');
      return realSet.call(this, name, value);
    };
    input.value += '\\n存不上';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(950);
    out.failed = [$('notes-detail').querySelector('.nd-meta').textContent, $('notes-detail').querySelector('.nd-status').dataset.state];
    Storage.prototype.setItem = realSet;
    await settle(3200);
    out.retried = [note('tools').content.includes('存不上'), $('notes-detail').querySelector('.nd-status').dataset.state];

    // Search highlights hits in titles and excerpts.
    $('notes-search').value = '交付';
    $('notes-search').dispatchEvent(new Event('input', { bubbles: true }));
    await settle(150);
    out.search = [[...$('notes-list').querySelectorAll('.notes-list-item')].map((row) => row.dataset.noteId), [...$('notes-list').querySelectorAll('mark')].map((mark) => mark.textContent)];
    $('notes-search').value = '';
    $('notes-search').dispatchEvent(new Event('input', { bubbles: true }));
    await settle(150);

    // ⌘N: a blank note, in edit mode, title focused.
    key('n');
    await settle();
    out.created = [archive()[0].content, window.NotchNotes.state().mode, document.activeElement?.classList.contains('nd-title'), $('notes-detail').querySelector('.nd-title').placeholder];

    // ⋯: copy Markdown, export .md, delete with undo.
    document.querySelector('[data-note-id="tools"]').click();
    await settle();
    $('notes-detail').querySelector('[data-action="more"]').click();
    out.menuOpen = !$('notes-detail').querySelector('.nd-menu').hidden;
    $('notes-detail').querySelector('[data-action="copy-md"]').click();
    await settle();
    out.copied = window.__calls.filter((call) => call[0] === 'write-clipboard').map((call) => call[1].text.split('\\n')[0]);
    $('notes-detail').querySelector('[data-action="more"]').click();
    $('notes-detail').querySelector('[data-action="export-md"]').click();
    await settle();
    out.exported = [window.__exported?.title, window.__exported?.content.startsWith('## 原则'), $('status-toast-message').textContent];
    $('notes-detail').querySelector('[data-action="more"]').click();
    $('notes-detail').querySelector('[data-action="delete-note"]').click();
    await settle();
    out.deleted = [Boolean(note('tools')), $('status-toast-message').textContent];
    $('status-toast-action').click();
    await settle();
    out.restored = Boolean(note('tools'));

    // Editing today's 随笔 in the library writes back to the home card.
    document.querySelector('[data-note-id="' + suibi.id + '"]').click();
    await settle();
    window.NotchNotes.setMode('edit');
    const suibiInput = $('notes-detail').querySelector('.nd-input');
    suibiInput.value = '改过的随笔';
    suibiInput.dispatchEvent(new Event('input', { bubbles: true }));
    window.NotchNotes.flush();
    out.backToHome = home.value;

    // Past midnight: yesterday's 随笔 stays in the library and the home card starts empty.
    const yesterday = new Date(Date.now() - 86400000);
    localStorage.setItem('notch-home-note-day-v1', yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0'));
    out.rolled = [window.NotchNotes.rollHomeNote(), home.value, localStorage.getItem('notch-home-note'), Boolean(note(suibi.id)), localStorage.getItem('notch-note-active-archive-v1')];
    // First run (no day recorded yet): only remember today, never clear.
    home.value = '已有的随笔';
    localStorage.removeItem('notch-home-note-day-v1');
    out.firstRun = [window.NotchNotes.rollHomeNote(), home.value];

    // Prompts: variables as chips; 编辑 opens the text, 完成 goes back.
    window.NotchPromptLibrary.setLibrary('prompts');
    await settle();
    const detail = $('prompts-detail');
    out.chips = [...detail.querySelectorAll('.prompt-chip')].map((chip) => [chip.textContent, chip.classList.contains('builtin')]);
    detail.querySelector('[data-action="edit-toggle"]').click();
    out.editing = Boolean(detail.querySelector('.prompt-editor'));
    detail.querySelector('[data-action="edit-toggle"]').click();
    out.back = [Boolean(detail.querySelector('.prompt-body')), !detail.querySelector('.prompt-editor')];
    return out;
  })()`);

  // Yesterday is in 本周 unless today is Monday.
  assert.deepEqual(result.groups, new Date().getDay() === 1
    ? ['#今天', '客户电话要点', '#更早', '一人公司工具栈', '会议纪要']
    : ['#今天', '客户电话要点', '#本周', '一人公司工具栈', '#更早', '会议纪要']);
  assert.equal(result.excerpt, '原则 · 工具要少而精。 · 把密码迁到密钥 · 清理剪贴板 · 扶手不是工作台');
  assert.equal(result.suibi[0], true);
  assert.equal(result.suibi[1], '今日重点：回复王总的报价邮件');
  assert.deepEqual(result.suibi[2], ['#今天', result.suibi[2][1]]);
  assert.match(result.suibi[2][1], /^\d+月\d+日 随笔$/);
  assert.equal(result.suibi[3], '今日随笔');
  assert.deepEqual(result.suibiUpdated, [1, true], 'one 随笔 a day, kept in sync');
  assert.deepEqual(result.preview, ['preview', '原则', 2, '扶手不是工作台']);
  assert.deepEqual(result.ticked, [true, true]);
  assert.deepEqual(result.edit, ['edit', true, true]);
  assert.deepEqual(result.beforeSave, [false, true]);
  assert.deepEqual(result.afterSave, [true, true, true]);
  assert.equal(result.failed[0].startsWith('未保存'), true);
  assert.equal(result.failed[1], 'failed');
  assert.deepEqual(result.retried, [true, 'saved']);
  assert.deepEqual(result.search, [['today'], ['交付']]);
  assert.deepEqual(result.created.slice(0, 3), ['', 'edit', true]);
  assert.equal(result.created[3], '未命名笔记');
  assert.equal(result.menuOpen, true);
  assert.deepEqual(result.copied, ['## 原则']);
  assert.deepEqual(result.exported, ['一人公司工具栈', true, '已导出 .md']);
  assert.equal(result.deleted[0], false);
  assert.match(result.deleted[1], /^已删除「一人公司工具栈」/);
  assert.equal(result.restored, true);
  assert.equal(result.backToHome, '改过的随笔');
  assert.deepEqual(result.rolled, [true, '', '', true, null]);
  assert.deepEqual(result.firstRun, [false, '已有的随笔']);
  assert.deepEqual(result.chips, [['{称呼}', false], ['{项目}', false], ['{日期}', true]]);
  assert.equal(result.editing, true);
  assert.deepEqual(result.back, [true, true]);

  if (process.env.SOLODOCK_NOTES_SCREENSHOT_DIR) {
    fs.writeFileSync(path.join(process.env.SOLODOCK_NOTES_SCREENSHOT_DIR, 'notes-page.png'), (await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Notes page checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
