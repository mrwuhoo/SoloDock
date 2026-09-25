const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Notice center renderer timed out'); app.exit(1); }, 40000);

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
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    const now = Date.now();
    const yesterday = now - 26 * 3600000;
    window.__notices = [
      { id: 'n1', source: 'needs-you', agent: 'claude', title: 'Claude 需要你确认', detail: '想使用 Bash，等你批准 · solodock', project: 'solodock', at: now - 60000, read: false, handled: false },
      { id: 'c1', source: 'codex', title: '重构用量卡片', detail: 'SoloDock', project: 'SoloDock', at: now - 3600000, read: false, handled: false },
      { id: 't1', source: 'todo', title: '交付封面终稿', detail: '将在 1 小时内截止', taskId: 'todo-1', at: now - 7200000, read: true, handled: false },
      { id: 's1', source: 'sit', title: '起来活动一下', detail: '已经连续用电脑 50 分钟', at: yesterday, read: true, handled: true },
    ];
    await setMode(true);
    await setActiveTab('home');
    await window.NotchNoticeCenter.load();
    const out = {
      badge: [$('notice-badge').hidden, $('notice-badge').textContent, $('notice-badge').dataset.tone, $('notice-bell').getAttribute('aria-label')],
    };
    $('notice-bell').click();
    await settle();
    const center = $('notice-center');
    out.open = !center.hidden;
    out.groups = [...center.querySelectorAll('.notice-group')].map((group) => [group.querySelector('h3').textContent, [...group.querySelectorAll('.notice-item')].map((item) => item.dataset.id)]);
    out.actions = Object.fromEntries([...center.querySelectorAll('.notice-item')].map((item) => [item.dataset.id, [...item.querySelectorAll('.notice-action, .notice-done')].map((node) => node.textContent)]));
    out.readAll = window.__calls.filter((call) => call[0] === 'read-all').length;
    const bell = $('notice-bell').getBoundingClientRect();
    const box = center.getBoundingClientRect();
    out.aligned = Math.abs(box.right - bell.right - 10) <= 1 && box.top > bell.bottom && box.right <= window.innerWidth - 11;
    out.meta = $('notice-center-meta').textContent;

    // Jumping back when the window is gone keeps the item and says so.
    center.querySelector('[data-id="n1"] [data-action="open"]').click();
    await settle();
    out.openMissing = [window.__calls.at(-1), $('status-toast-message').textContent];
    // Completing a todo from the center.
    center.querySelector('[data-id="t1"] [data-action="todo-done"]').click();
    await settle();
    out.todoDone = [window.__calls.filter((call) => call[0] === 'act').map((call) => call.slice(1)), $('notice-center').querySelector('[data-id="t1"] .notice-done')?.textContent];
    // Ignoring the permission request moves it out of "需要你处理".
    center.querySelector('[data-id="n1"] [data-action="dismiss"]').click();
    await settle();
    out.afterDismiss = [...center.querySelectorAll('.notice-group h3')].map((heading) => heading.textContent);

    // Clicks inside the popover never collapse the panel; clicking outside closes it.
    center.querySelector('.notice-center-head').click();
    out.stillExpanded = document.getElementById('app').classList.contains('expanded');
    document.querySelector('#tab-home').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    out.closedOutside = center.hidden;

    // From the notch: "Claude 需要你确认" opens the center with that item highlighted.
    window.__notices.push({ id: 'n2', source: 'needs-you', agent: 'claude', title: 'Claude 需要你确认', detail: '想使用 Edit，等你批准', project: 'solodock', at: Date.now(), read: false, handled: false });
    await window.NotchNoticeCenter.open({ highlight: 'needs-you' });
    await settle();
    out.highlight = [...center.querySelectorAll('[data-highlight="true"]')].map((item) => item.dataset.id);

    $('notice-clear').click();
    await settle();
    out.cleared = [center.querySelector('.notice-empty b')?.textContent, $('notice-badge').hidden];
    return out;
  })()`);

  assert.deepEqual(result.badge, [false, '1', 'needs', '通知中心：1 件需要你处理'], 'amber badge counts what needs you');
  assert.equal(result.open, true);
  assert.deepEqual(result.groups, [['需要你处理', ['n1']], ['今天', ['c1', 't1']], ['更早', ['s1']]]);
  assert.deepEqual(result.actions, { n1: ['跳回窗口', '忽略'], c1: ['跳回窗口'], t1: ['完成', '打开'], s1: ['已处理'] });
  assert.equal(result.readAll, 1, 'opening marks everything as read');
  assert.equal(result.aligned, true, 'the popover hangs under the bell');
  assert.equal(result.meta, '1 件需要你处理');
  assert.deepEqual(result.openMissing, [['act', 'n1', 'open'], '没找到对应的窗口，可能已经关掉了']);
  assert.deepEqual(result.todoDone, [[['n1', 'open'], ['t1', 'todo-done']], '已处理']);
  assert.deepEqual(result.afterDismiss, ['今天', '更早']);
  assert.equal(result.stillExpanded, true);
  assert.equal(result.closedOutside, true);
  assert.deepEqual(result.highlight, ['n2']);
  assert.deepEqual(result.cleared, ['没有错过的提醒', true]);

  if (process.env.SOLODOCK_NOTICE_SCREENSHOT_DIR) {
    await win.webContents.executeJavaScript(`(async () => {
      const now = Date.now();
      window.__notices = [
        { id: 'n1', source: 'needs-you', agent: 'claude', title: 'Claude 需要你确认', detail: '想使用 Bash，等你批准 · solodock', project: 'solodock', at: now - 60000, read: false, handled: false },
        { id: 'c1', source: 'claude', title: '补完通知中心的测试', detail: 'SoloDock', project: 'SoloDock', at: now - 1800000, read: false, handled: false },
        { id: 'c2', source: 'codex', title: '重构用量卡片', detail: 'SoloDock', project: 'SoloDock', at: now - 3600000, read: true, handled: true },
        { id: 't1', source: 'todo', title: '交付封面终稿', detail: '将在 1 小时内截止', taskId: 'todo-1', at: now - 7200000, read: true, handled: false },
        { id: 's1', source: 'sit', title: '起来活动一下', detail: '已经连续用电脑 50 分钟', at: now - 26 * 3600000, read: true, handled: true },
      ];
      await window.NotchNoticeCenter.load();
      await window.NotchNoticeCenter.open();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const rect = await win.webContents.executeJavaScript(`(() => { const center = document.getElementById('notice-center').getBoundingClientRect(); const bell = document.getElementById('notice-bell').getBoundingClientRect(); const left = Math.floor(center.left) - 20; return { x: left, y: 0, width: Math.ceil(Math.max(center.right, bell.right)) - left + 20, height: Math.ceil(center.bottom) + 24 }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_NOTICE_SCREENSHOT_DIR, 'notice-center.png'), (await win.webContents.capturePage(rect)).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Notice center checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
