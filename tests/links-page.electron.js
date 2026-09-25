const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Links page renderer timed out'); app.exit(1); }, 40000);

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
    const link = (id, title, url) => ({ id, title, url, icon: '', createdAt: 1 });
    localStorage.setItem('notch-link-groups', JSON.stringify([
      { id: 'g-ai', name: 'AI 工具', links: [link('l1', 'Claude', 'https://claude.ai/'), link('l2', 'ChatGPT', 'https://chatgpt.com/')] },
      { id: 'g-dev', name: '开发', links: [link('l3', 'GitHub', 'https://github.com/')] },
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
    const stored = () => JSON.parse(localStorage.getItem('notch-link-groups'));
    const groupOf = (url) => stored().find((group) => group.links.some((link) => link.url === url))?.name;
    const nav = () => [...$('links-nav').querySelectorAll('.links-nav-item')].map((item) => [item.querySelector('span').textContent, item.querySelector('b').textContent]);
    const sections = () => [...$('links-body').querySelectorAll('.links-group')].map((section) => [section.querySelector('h3')?.textContent, section.querySelectorAll('.links-row').length]);
    const add = async (value) => { $('link-add').value = value; $('link-add').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await settle(); };
    window.notchAPI.inspectLink = async (url) => ({ ok: true, url, title: url.includes('sspai') ? '少数派 · 高效工作' : '未命名', icon: 'data:image/png;base64,iVBORw0KGgo=' });
    await setMode(true);
    await setActiveTab('links');
    await settle(150);
    const out = {};

    out.nav = nav();
    out.sections = sections();
    out.placeholder = $('link-add').placeholder;

    // From 全部: a new site goes to 未分组, a known site joins its group.
    await add('sspai.com/post/1');
    await settle();
    out.unsorted = [groupOf('https://sspai.com/post/1'), stored().flatMap((group) => group.links).find((link) => link.url === 'https://sspai.com/post/1')?.title, nav()[1]];
    await add('https://github.com/mrwuhoo/SoloDock');
    out.sameSite = groupOf('https://github.com/mrwuhoo/SoloDock');
    // A duplicate says where it is.
    await add('https://claude.ai/');
    out.duplicate = $('status-toast-message').textContent;
    await add('ftp://nope');
    out.invalid = $('status-toast-message').textContent;

    // Choosing a group saves into it.
    $('links-nav').querySelector('[data-group="g-ai"]').click();
    await settle();
    out.selected = [$('link-add').placeholder, sections()];
    await add('https://kimi.com');
    out.intoGroup = groupOf('https://kimi.com/');
    $('links-nav').querySelector('[data-group="all"]').click();
    await settle();

    // Clipboard suggestion: shown once, saved or ignored; only a hash is kept.
    let clip = 'https://www.figma.com/files';
    window.notchAPI.readClipboardText = async () => clip;
    await window.NotchLinks.checkClipboard();
    out.suggest = [!$('links-suggest').hidden, $('links-suggest-url').textContent, $('links-suggest-save').textContent];
    $('links-suggest-save').click();
    await settle();
    out.suggestSaved = [groupOf('https://www.figma.com/files'), $('links-suggest').hidden];
    await window.NotchLinks.checkClipboard();
    out.notAgain = $('links-suggest').hidden;
    clip = '看这个 https://example.com/cover.png';
    await window.NotchLinks.checkClipboard();
    const shownOther = !$('links-suggest').hidden;
    $('links-suggest-dismiss').click();
    await window.NotchLinks.checkClipboard();
    out.dismissed = [shownOther, $('links-suggest').hidden, JSON.stringify(localStorage).includes('example.com/cover')];

    // Search titles and addresses.
    $('links-search').value = 'git';
    $('links-search').dispatchEvent(new Event('input', { bubbles: true }));
    out.search = sections();
    $('links-search').value = '';
    $('links-search').dispatchEvent(new Event('input', { bubbles: true }));

    // Row actions: open, copy, and the ⋯ menu (rename, move, delete with undo).
    const row = (id) => $('links-body').querySelector('.links-row[data-link-id="' + id + '"]');
    row('l1').click();
    row('l1').querySelector('[data-action="copy"]').click();
    await settle();
    out.calls = window.__calls.filter((call) => ['open-external', 'write-clipboard'].includes(call[0])).map((call) => [call[0], call[1].text || call[1]]);
    row('l1').querySelector('[data-action="link-menu"]').click();
    out.linkMenu = [...$('links-menu').querySelectorAll('button')].map((button) => button.textContent);
    $('links-menu').querySelector('[data-menu="link-rename"]').click();
    const edit = row('l1').querySelector('.links-edit');
    edit.value = 'Claude（工作）';
    edit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    out.renamed = row('l1').querySelector('b').textContent;
    row('l1').querySelector('[data-action="link-menu"]').click();
    $('links-menu').querySelector('[data-menu="link-move"]').click();
    out.moveTargets = [...$('links-menu').querySelectorAll('[data-menu="link-move-to"]')].map((button) => button.textContent);
    $('links-menu').querySelector('[data-menu="link-move-to"][data-target="g-dev"]').click();
    await settle();
    out.moved = [groupOf('https://claude.ai/'), $('status-toast-message').textContent];
    row('l1').querySelector('[data-action="link-menu"]').click();
    $('links-menu').querySelector('[data-menu="link-delete"]').click();
    await settle();
    out.deleted = [groupOf('https://claude.ai/'), $('status-toast-message').textContent];
    $('status-toast-action').click();
    await settle();
    out.undone = groupOf('https://claude.ai/');

    // Drag a row onto a group in the sidebar.
    const dt = new DataTransfer();
    row('l2').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    const target = $('links-nav').querySelector('[data-group="g-dev"]');
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await settle();
    out.dragged = [groupOf('https://chatgpt.com/'), $('status-toast-message').textContent];

    // Group ⋯: rename; delete keeping links (undo), then delete with links.
    const section = (name) => [...$('links-body').querySelectorAll('.links-group')].find((node) => node.querySelector('h3')?.textContent === name);
    section('开发').querySelector('[data-action="group-menu"]').click();
    $('links-menu').querySelector('[data-menu="group-rename"]').click();
    const groupEdit = $('links-body').querySelector('.links-group-edit');
    groupEdit.value = '开发工具';
    groupEdit.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    out.groupRenamed = nav().map((item) => item[0]);
    section('开发工具').querySelector('[data-action="group-menu"]').click();
    $('links-menu').querySelector('[data-menu="group-delete"]').click();
    out.deleteChoices = [...$('links-menu').querySelectorAll('button')].map((button) => button.textContent);
    $('links-menu').querySelector('[data-menu="group-delete-keep"]').click();
    await settle();
    out.keptLinks = [groupOf('https://github.com/'), nav().map((item) => item[0]).includes('开发工具')];
    $('status-toast-action').click();
    await settle();
    out.groupBack = [groupOf('https://github.com/'), nav().map((item) => item[0]).includes('开发工具')];
    section('AI 工具').querySelector('[data-action="group-menu"]').click();
    $('links-menu').querySelector('[data-menu="group-delete"]').click();
    $('links-menu').querySelector('[data-menu="group-delete-all"]').click();
    await settle();
    out.deletedAll = [nav().map((item) => item[0]).includes('AI 工具'), groupOf('https://kimi.com/')];

    // + 新分组.
    $('links-add-group').click();
    $('links-new-group-name').value = '阅读';
    $('links-new-group').requestSubmit();
    await settle();
    out.newGroup = [nav().map((item) => item[0]).includes('阅读'), $('link-add').placeholder];

    // Esc closes a menu first.
    $('links-nav').querySelector('[data-group="all"]').click();
    await settle();
    $('links-body').querySelector('.links-row [data-action="link-menu"]').click();
    window.__handlers.onEscape.forEach((callback) => callback());
    out.escape = [$('links-menu').hidden, document.getElementById('app').classList.contains('expanded')];
    return out;
  })()`);

  assert.deepEqual(result.nav, [['全部', '3'], ['未分组', '0'], ['AI 工具', '2'], ['开发', '1']]);
  assert.deepEqual(result.sections, [['AI 工具', 2], ['开发', 1]]);
  assert.equal(result.placeholder, '粘贴网址，回车保存到「未分组」');
  assert.deepEqual(result.unsorted, ['未分组', '少数派 · 高效工作', ['未分组', '1']]);
  assert.equal(result.sameSite, '开发');
  assert.equal(result.duplicate, '已在「AI 工具」中');
  assert.equal(result.invalid, '请输入有效的公开网址');
  assert.deepEqual(result.selected, ['粘贴网址，回车保存到「AI 工具」', [['AI 工具', 2]]]);
  assert.equal(result.intoGroup, 'AI 工具');
  assert.deepEqual(result.suggest, [true, 'figma.com/files', '保存到 未分组']);
  assert.deepEqual(result.suggestSaved, ['未分组', true]);
  assert.equal(result.notAgain, true, 'a saved address is not suggested again');
  assert.deepEqual(result.dismissed, [true, true, false], 'ignored for good, and only a hash is stored');
  assert.deepEqual(result.search, [['开发', 2]]);
  assert.deepEqual(result.calls, [['open-external', 'https://claude.ai/'], ['write-clipboard', 'https://claude.ai/']]);
  assert.deepEqual(result.linkMenu, ['编辑标题', '移动到…', '删除']);
  assert.equal(result.renamed, 'Claude（工作）');
  assert.deepEqual(result.moveTargets, ['未分组', '开发']);
  assert.deepEqual(result.moved, ['开发', '已移到「开发」']);
  assert.equal(result.deleted[0], undefined);
  assert.match(result.deleted[1], /^已删除「Claude（工作）」/);
  assert.equal(result.undone, '开发');
  assert.deepEqual(result.dragged, ['开发', '已移到「开发」']);
  assert.deepEqual(result.groupRenamed, ['全部', '未分组', 'AI 工具', '开发工具']);
  assert.deepEqual(result.deleteChoices, ['删除「开发工具」，里面的 5 条链接：', '移到「未分组」', '一并删除'].slice(1));
  assert.deepEqual(result.keptLinks, ['未分组', false]);
  assert.deepEqual(result.groupBack, ['开发工具', true]);
  assert.deepEqual(result.deletedAll, [false, undefined]);
  assert.deepEqual(result.newGroup, [true, '粘贴网址，回车保存到「阅读」']);
  assert.deepEqual(result.escape, [true, true]);

  if (process.env.SOLODOCK_LINKS_SCREENSHOT_DIR) {
    fs.writeFileSync(path.join(process.env.SOLODOCK_LINKS_SCREENSHOT_DIR, 'links-page.png'), (await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Links page checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
