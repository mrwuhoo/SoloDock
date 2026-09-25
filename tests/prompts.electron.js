const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Prompt library renderer timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1240, height: 616, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  const indexFile = path.join(__dirname, '..', 'renderer', 'index.html');
  await win.loadFile(indexFile);
  // A profile from before v0.2 with home commands and no prompt library yet.
  await win.webContents.executeJavaScript(`
    localStorage.clear();
    localStorage.setItem('notch-home-commands', JSON.stringify([
      // Stored newest first, as the old home card did (new commands were unshifted).
      { id: 'c1', text: '帮我把这段话改写得更口语化', createdAt: 2 },
      { id: 'c2', text: 'Review 这段代码', createdAt: 1 },
    ]));
  `);
  await win.loadFile(indexFile);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
    const get = (id) => document.getElementById(id);
    let written = [];
    window.notchAPI = {
      writeClipboard: async (entry) => { written.push(entry.text); return true; },
      readClipboardText: async () => '合同第 4 条',
    };
    await setMode(true);
    await setActiveTab('notes');
    await settle();
    const page = get('notes-page');
    const firstPage = page.dataset.library;
    const migrated = [...document.querySelectorAll('#prompts-list .prompt-item strong')].map((node) => node.firstChild.textContent);
    const legacyKept = JSON.parse(localStorage.getItem('notch-home-commands')).length;
    const homeCommandsGone = !document.querySelector('[data-home-module="commands"]');

    get('notes-new').click();
    await settle();
    const title = document.querySelector('.prompt-title');
    const createdFocused = document.activeElement === title;
    title.value = '客户报价回复';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    const titleStillFocused = document.activeElement === document.querySelector('.prompt-title');
    const editor = document.querySelector('.prompt-editor');
    editor.value = '{称呼}好，{项目}报价如下，参考 {剪贴板}，日期 {日期}';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(450);
    const variables = [...document.querySelectorAll('.prompt-var-input')].map((input) => input.dataset.variable);
    const hint = document.querySelector('.prompt-hint').textContent;
    const nameInput = document.querySelector('.prompt-var-input[data-variable="称呼"]');
    nameInput.value = '王总';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-action="copy-filled"]').click();
    await settle(60);
    const filled = written.at(-1);
    const uses = JSON.parse(localStorage.getItem('notch-prompts-v1')).find((item) => item.title === '客户报价回复').uses;
    const toastAfterCopy = get('status-toast-message').textContent;

    document.querySelector('[data-action="star"]').click();
    await settle();
    document.querySelector('.prompt-group[data-group="★"]').click();
    await settle();
    const starredOnly = [...document.querySelectorAll('#prompts-list .prompt-item')].length;
    document.querySelector('.prompt-group[data-group=""]').click();
    await settle();

    document.querySelector('[data-action="delete"]').click();
    await settle();
    const afterDelete = JSON.parse(localStorage.getItem('notch-prompts-v1')).length;
    get('status-toast-action').click();
    await settle();
    const afterUndo = JSON.parse(localStorage.getItem('notch-prompts-v1')).length;

    get('notes-mode-notes').click();
    await settle();
    const notesVisible = getComputedStyle(get('notes-list')).display !== 'none'
      && getComputedStyle(get('prompts-list')).display === 'none';
    return {
      firstPage, migrated, legacyKept, homeCommandsGone,
      createdFocused, titleStillFocused, variables, hint, filled, uses, toastAfterCopy,
      starredOnly, afterDelete, afterUndo, notesVisible,
    };
  })()`);

  const today = new Date();
  assert.equal(result.firstPage, 'prompts', 'the prompt library is the first page of Notes');
  assert.deepEqual(result.migrated, ['帮我把这段话改写得更口语化', 'Review 这段代码']);
  assert.equal(result.legacyKept, 2, 'the legacy commands key stays for rollback');
  assert.equal(result.homeCommandsGone, true);
  assert.equal(result.createdFocused, true);
  assert.equal(result.titleStillFocused, true, 'typing a title must not rebuild the focused input');
  assert.deepEqual(result.variables, ['称呼', '项目']);
  assert.match(result.hint, /\{剪贴板\}/);
  assert.equal(result.filled, `王总好，{项目}报价如下，参考 合同第 4 条，日期 ${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`);
  assert.equal(result.uses, 1);
  assert.match(result.toastAfterCopy, /还有变量没有填写/);
  assert.equal(result.starredOnly, 1);
  assert.equal(result.afterDelete, 2);
  assert.equal(result.afterUndo, 3);
  assert.equal(result.notesVisible, true);

  await win.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const remembered = await win.webContents.executeJavaScript(`document.getElementById('notes-page').dataset.library`);
  assert.equal(remembered, 'notes', 'the last opened library is remembered');
  assert.deepEqual(errors, []);
  console.log('Prompt library checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
