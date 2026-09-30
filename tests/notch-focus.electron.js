const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const isolatedUserData = process.env.TODO_TEST_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'to-do-panel-electron-test-'));
app.setPath('userData', isolatedUserData);
function diagnostic(message) {
  console.log(message);
  if (process.env.TODO_TEST_LOG) fs.appendFileSync(process.env.TODO_TEST_LOG, `${message}\n`);
}
process.on('uncaughtException', (error) => { diagnostic(error.stack); app.exit(1); });
// Windows keeps Chromium's files locked until process exit. The parent test runner
// cleans up the isolated profile after the child has exited, never in will-quit.

async function main() {
  diagnostic('Renderer test: waiting for Electron');
  await app.whenReady();
  diagnostic('Renderer test: Electron ready');
  const window = new BrowserWindow({
    width: 200,
    height: 38,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      // 与生产主窗口一致，避免 macOS 将重复运行的测试窗口判为遮挡后暂停 rAF。
      backgroundThrottling: false,
    },
  });

  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    diagnostic('Renderer test: page loaded');
    const freshProfileClipboardState = await window.webContents.executeJavaScript(`
      (() => ({
        history: localStorage.getItem('notch-clip-history'),
        favorites: localStorage.getItem('notch-clip-favorites'),
        imageRows: document.querySelectorAll('#clip-list [data-type="image"]').length,
      }))()
    `);
    assert.deepEqual(freshProfileClipboardState, {
      history: null,
      favorites: null,
      imageRows: 0,
    }, '全新用户目录不得预置任何剪贴板文本、收藏或图片记录');

    await window.webContents.debugger.attach('1.3');
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'reduce' },
        // CI hosts may reduce transparency by default; set the glass test baseline explicitly.
        { name: 'prefers-reduced-transparency', value: 'no-preference' },
      ],
    });
    window.show();
    window.focus();
    window.webContents.focus();
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
    const focusStyle = await window.webContents.executeJavaScript(`
      (async () => {
        const notch = document.getElementById('notch');
        const deadline = performance.now() + 5000;
        let result;
        do {
          const notchStyle = getComputedStyle(notch);
          const dotStyle = getComputedStyle(notch.querySelector('.notch-dot'));
          result = {
            active: document.activeElement === notch,
            focusVisible: notch.matches(':focus-visible'),
            outlineStyle: notchStyle.outlineStyle,
            outlineWidth: notchStyle.outlineWidth,
            dotBoxShadow: dotStyle.boxShadow,
          };
          if (result.active && result.focusVisible) return result;
          await new Promise((resolve) => setTimeout(resolve, 20));
        } while (performance.now() < deadline);
        return result;
      })()
    `);

    assert.equal(focusStyle.active, true, '折叠条应能通过键盘获得焦点');
    assert.equal(focusStyle.focusVisible, true, '键盘焦点应保持可见提示');
    assert.equal(
      focusStyle.outlineStyle,
      'none',
      `折叠外壳不能画焦点描边，当前为 ${focusStyle.outlineWidth} ${focusStyle.outlineStyle}`
    );
    assert.notEqual(focusStyle.dotBoxShadow, 'none', '焦点提示应转移到中间抓握条');

    const collapsedPanelLayers = await window.webContents.executeJavaScript(`
      (() => {
        const panel = document.querySelector('.panel');
        return {
          contentClipPath: getComputedStyle(panel).clipPath,
          shellClipPath: getComputedStyle(panel, '::before').clipPath,
        };
      })()
    `);
    assert.equal(
      collapsedPanelLayers.contentClipPath,
      'none',
      '折叠动效不得裁剪承载全部组件的内容层'
    );
    assert.notEqual(
      collapsedPanelLayers.shellClipPath,
      'none',
      '折叠轮廓应由独立背景外壳承担'
    );

    window.setSize(1240, 616);
    const topbarBlankToggle = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        // 页签容器横跨整条顶栏（两组贴着刘海左右排开），中央空白必须把点击交给顶栏。
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        const topbar = document.querySelector('.topbar').getBoundingClientRect();
        const x = topbar.left + topbar.width / 2;
        const y = topbar.top + topbar.height / 2;
        const hitTarget = document.elementFromPoint(x, y);
        const interceptedByTabs = Boolean(hitTarget?.closest('.tabs'));
        hitTarget?.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
        }));
        const collapsed = await waitForClass('collapsed');
        return {
          opened,
          collapsed,
          interceptedByTabs,
          hitTarget: hitTarget?.id || hitTarget?.className || hitTarget?.tagName || '',
          appClass: document.getElementById('app').className,
          panelAriaHidden: document.querySelector('.panel').getAttribute('aria-hidden'),
        };
      })()
    `);
    assert.equal(topbarBlankToggle.opened, true, '折叠岛点击后必须展开');
    assert.equal(
      topbarBlankToggle.interceptedByTabs,
      false,
      `顶部中央空白不得被 Tab 容器截获，当前命中 ${topbarBlankToggle.hitTarget}`
    );
    assert.equal(
      topbarBlankToggle.collapsed,
      true,
      `展开后点击顶部中央空白必须收起；最终状态 ${topbarBlankToggle.appClass} / aria-hidden=${topbarBlankToggle.panelAriaHidden}`
    );

    const topbarTabAndSpaceToggle = await window.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (document.getElementById('app').classList.contains(name)) return true;
            await sleep(10);
          }
          return false;
        };
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        const todoButton = document.getElementById('tab-button-todo');
        const rect = todoButton.getBoundingClientRect();
        const hitTarget = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        hitTarget?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(30);
        const todoActivated = document.getElementById('tab-todo').classList.contains('active');
        document.dispatchEvent(new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        }));
        const collapsedBySpace = await waitForClass('collapsed');
        return {
          opened,
          todoActivated,
          tabHit: Boolean(hitTarget?.closest('#tab-button-todo')),
          collapsedBySpace,
        };
      })()
    `);
    assert.equal(topbarTabAndSpaceToggle.opened, true);
    assert.equal(topbarTabAndSpaceToggle.tabHit, true, '空白穿透不得破坏真实 Tab 的点击命中');
    assert.equal(topbarTabAndSpaceToggle.todoActivated, true, '真实 Tab 点击必须继续切换页面');
    assert.equal(topbarTabAndSpaceToggle.collapsedBySpace, true, '展开后 Space 必须继续收起');

    window.setSize(1240, 616);
    const settingsSurface = await window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.getElementById('tab-button-settings').click();
        setTimeout(() => {
          const page = document.getElementById('settings-page');
          const panel = document.querySelector('.panel');
          const shellClipPath = getComputedStyle(panel, '::before').clipPath;
          resolve({
            contentClipPath: getComputedStyle(panel).clipPath,
            shellOwnsExpandedOutline: shellClipPath !== 'none' && !shellClipPath.includes('calc'),
            rightmostTab: [...document.querySelectorAll('.tab[data-tab]:not([hidden])')].at(-1)?.dataset.tab,
            activePanel: document.getElementById('tab-settings')?.classList.contains('active'),
            display: getComputedStyle(page).display,
            columns: getComputedStyle(page).gridTemplateColumns.split(' ').filter(Boolean).length,
            api: Boolean(document.getElementById('settings-api-configure')),
            mirror: Boolean(document.getElementById('settings-frame-add')),
            features: document.querySelectorAll('[data-settings-feature]').length,
            homeModules: document.querySelectorAll('[data-settings-home-module]').length,
            shortcut: Boolean(document.getElementById('settings-shortcut-change')),
            defaultTab: {
              exists: Boolean(document.getElementById('settings-default-tab')),
              value: document.getElementById('settings-default-tab')?.value,
              options: document.getElementById('settings-default-tab')?.options.length,
            },
            workspace: Boolean(document.getElementById('settings-workspace-choose')),
            autoLaunch: Boolean(document.getElementById('settings-auto-launch')),
          });
        }, 80);
      })
    `);

    assert.deepEqual(settingsSurface, {
      contentClipPath: 'none',
      shellOwnsExpandedOutline: true,
      rightmostTab: 'settings',
      activePanel: true,
      display: 'grid',
      columns: 2,
      api: true,
      mirror: true,
      features: 9,
      homeModules: 4,
      shortcut: true,
      defaultTab: { exists: true, value: 'home', options: 11 },
      workspace: true,
      autoLaunch: true,
    });

    const defaultTabOpening = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        const features = {
          home: true,
          todo: true,
          notes: true,
          links: true,
          recordings: true,
          credentials: true,
          clip: false,
        };
        appSurface.classList.remove('expanded', 'opening', 'closing');
        appSurface.classList.add('collapsed');
        applyFeatureSettings({ features, defaultTab: 'todo' });
        await setMode(true);
        const preferredOpened = document.getElementById('tab-todo').classList.contains('active');
        await setMode(false);

        applyFeatureSettings({ features: { ...features, todo: false }, defaultTab: 'todo' });
        await setMode(true);
        const result = {
          preferredOpened,
          hiddenPreferenceFallsBackHome: document.getElementById('tab-home').classList.contains('active'),
        };
        await setMode(false);
        applyFeatureSettings({ features, defaultTab: 'home' });
        return result;
      })()
    `);
    assert.deepEqual(defaultTabOpening, {
      preferredOpened: true,
      hiddenPreferenceFallsBackHome: true,
    }, '每次展开应进入设置的默认页，不可见的默认页应回退到首页');

    const recordingPermissionConcurrency = await window.webContents.executeJavaScript(`
      (async () => {
        const originalApi = window.notchAPI;
        const originalMediaRecorder = window.MediaRecorder;
        const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
        const waitFor = async (predicate, label, timeout = 2000) => {
          const startedAt = Date.now();
          while (!predicate()) {
            if (Date.now() - startedAt > timeout) throw new Error('timeout: ' + label);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        let releasePermission;
        let permissionRequests = 0;
        let streamRequests = 0;
        let recorderStarts = 0;
        const track = {
          readyState: 'live',
          addEventListener() {},
          stop() {},
        };
        const stream = {
          getAudioTracks: () => [track],
          getTracks: () => [track],
        };
        class FakeMediaRecorder {
          static isTypeSupported() { return true; }
          constructor() { this.mimeType = 'audio/webm'; }
          start() { recorderStarts += 1; }
          pause() {}
          resume() {}
          stop() { queueMicrotask(() => this.onstop?.()); }
        }
        try {
          window.MediaRecorder = FakeMediaRecorder;
          navigator.mediaDevices.getUserMedia = async () => {
            streamRequests += 1;
            return stream;
          };
          window.notchAPI = {
            ...originalApi,
            ensureMicrophone: () => {
              permissionRequests += 1;
              return new Promise((resolve) => { releasePermission = resolve; });
            },
          };
          document.getElementById('tab-button-recordings').click();
          document.getElementById('recording-new').dispatchEvent(new MouseEvent('click', { bubbles: true }));
          window.NotchWorkspace.startRecording();
          await waitFor(() => (
            permissionRequests === 1
            && document.getElementById('recording-new').disabled
            && document.getElementById('recording-new').getAttribute('aria-label') === '正在请求麦克风权限'
          ), 'permission pending UI');
          const pending = {
            permissionRequests,
            streamRequests,
            recorderStarts,
            newDisabled: document.getElementById('recording-new').disabled,
            feedback: document.getElementById('recording-new').getAttribute('aria-label'),
            drafts: document.querySelectorAll('.recording-item.is-live').length,
          };
          releasePermission(true);
          await waitFor(() => (
            recorderStarts === 1
            && window.NotchWorkspace.isRecordingActive()
            && document.querySelectorAll('.recording-item.is-live').length === 1
          ), 'recording start');
          const started = {
            permissionRequests,
            streamRequests,
            recorderStarts,
            drafts: document.querySelectorAll('.recording-item.is-live').length,
            active: window.NotchWorkspace.isRecordingActive(),
          };
          window.NotchWorkspace.stopRecording();
          await waitFor(() => (
            !window.NotchWorkspace.isRecordingActive()
            && document.querySelectorAll('.recording-item.is-live').length === 0
          ), 'recording cleanup');
          const cleaned = {
            drafts: document.querySelectorAll('.recording-item.is-live').length,
            active: window.NotchWorkspace.isRecordingActive(),
          };
          return { pending, started, cleaned };
        } finally {
          if (window.NotchWorkspace.isRecordingActive()) {
            window.NotchWorkspace.stopRecording();
            await waitFor(() => !window.NotchWorkspace.isRecordingActive(), 'emergency recording cleanup')
              .catch(() => {});
          }
          window.MediaRecorder = originalMediaRecorder;
          navigator.mediaDevices.getUserMedia = originalGetUserMedia;
          window.notchAPI = originalApi;
        }
      })()
    `);
    assert.deepEqual(recordingPermissionConcurrency, {
      pending: {
        permissionRequests: 1,
        streamRequests: 0,
        recorderStarts: 0,
        newDisabled: true,
        feedback: '正在请求麦克风权限',
        drafts: 0,
      },
      started: {
        permissionRequests: 1,
        streamRequests: 1,
        recorderStarts: 1,
        drafts: 1,
        active: true,
      },
      cleaned: {
        drafts: 0,
        active: false,
      },
    }, '权限等待期间的多入口连点只能启动一次录音');

    // 待办截止时间选择器：翻到明年一月选 2 号，这一条用手选的日期；下一条回到默认（今天 23:30）。
    const todoCalendarNavigation = await window.webContents.executeJavaScript(`
      (async () => {
        document.getElementById('tab-button-todo').click();
        await new Promise((resolve) => setTimeout(resolve, 200));
        const card = document.querySelector('.task-card[data-category="P0"]');
        const trigger = card.querySelector('.task-date');
        trigger.click();
        const picker = document.getElementById('task-picker');
        const previous = picker.querySelector('[data-pick="prev"]');
        const next = picker.querySelector('[data-pick="next"]');
        const base = new Date();
        const previousRect = previous.getBoundingClientRect();
        const nextRect = next.getBoundingClientRect();
        for (let index = 0; index < 12 - base.getMonth(); index += 1) next.click();
        const januaryLabel = document.getElementById('task-picker-month').textContent.trim();
        const day = [...picker.querySelectorAll('#task-picker-grid [data-day]')].find((button) => !button.classList.contains('outside') && button.textContent === '2');
        day.click();
        const buttonLabel = trigger.textContent.trim();
        previous.click();
        return {
          popoverVisible: !picker.hidden && getComputedStyle(picker).display !== 'none',
          controlsUsable: [previousRect.width, previousRect.height, nextRect.width, nextRect.height].every((size) => size >= 18),
          januaryLabel,
          decemberLabel: document.getElementById('task-picker-month').textContent.trim(),
          buttonLabel,
          manual: trigger.dataset.manual,
        };
      })()
    `);
    const nextYear = new Date().getFullYear() + 1;
    assert.deepEqual(todoCalendarNavigation, {
      popoverVisible: true,
      controlsUsable: true,
      januaryLabel: `${nextYear} 年 1 月`,
      decemberLabel: `${nextYear - 1} 年 12 月`,
      buttonLabel: `1/2 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(nextYear, 0, 2).getDay()]} 23:30`,
      manual: 'true',
    });

    const todoDeadlineReset = await window.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector('.task-card[data-category="P0"]');
        const input = card.querySelector('.task-add-input');
        const submit = (text) => {
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          return JSON.parse(localStorage.getItem('notch-todo-data')).P0.find((item) => item.text === text)?.deadline;
        };
        const first = new Date(submit('deadline-reset-first'));
        const defaultLabel = card.querySelector('.task-date').textContent.trim();
        const second = submit('deadline-reset-second');
        return {
          first: [first.getFullYear(), first.getMonth(), first.getDate(), first.getHours(), first.getMinutes()],
          secondIsDefault: second === new Date(window.NotchTodo.defaultDeadline()).toISOString(),
          defaultLabel,
          manual: card.querySelector('.task-date').dataset.manual,
          popoverHidden: document.getElementById('task-picker').hidden,
        };
      })()
    `);
    assert.deepEqual(todoDeadlineReset.first, [nextYear, 0, 2, 23, 30], '当前待办应使用本次手动选择的截止时间');
    assert.equal(todoDeadlineReset.secondIsDefault, true, '下一条待办不得沿用上一条的截止时间');
    assert.match(todoDeadlineReset.defaultLabel, /^(今天|明天) 23:30$/, '新建表单应重置为默认 23:30');
    assert.equal(todoDeadlineReset.manual, 'false');
    assert.equal(todoDeadlineReset.popoverHidden, true, '提交后应关闭日期选择器');

    // 跨天、跨年、闰年：默认截止随「现在」计算，不会用到打开面板那天的旧日期；23:30 之后算明天。
    const todoRollover = await window.webContents.executeJavaScript(`
      (async () => {
        const RealDate = window.Date;
        let now = new RealDate(2026, 8, 11, 22).getTime();
        window.Date = class extends RealDate {
          constructor(...args) { super(...(args.length ? args : [now])); }
          static now() { return now; }
        };
        const card = document.querySelector('.task-card[data-category="P0"]');
        const input = card.querySelector('.task-add-input');
        const iso = (...parts) => new RealDate(...parts).toISOString();
        const submit = (text) => {
          input.value = text;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
          return JSON.parse(localStorage.getItem('notch-todo-data')).P0.find((item) => item.text === text)?.deadline;
        };
        try {
          const results = [];
          for (const [label, parts, expected] of [
            ['a', [2026, 8, 11, 22], [2026, 8, 11, 23, 30]],
            ['b', [2026, 8, 12, 9], [2026, 8, 12, 23, 30]],
            ['c', [2027, 0, 1, 0], [2027, 0, 1, 23, 30]],
            ['d', [2028, 1, 29, 9], [2028, 1, 29, 23, 30]],
            ['e', [2028, 2, 1, 23, 50], [2028, 2, 2, 23, 30]],
          ]) {
            now = new RealDate(...parts).getTime();
            results.push(submit('rollover-' + label) === iso(...expected));
          }
          now = new RealDate(2028, 2, 3, 10).getTime();
          document.dispatchEvent(new CustomEvent('notch:tabchange', { detail: { tab: 'todo' } }));
          const label = card.querySelector('.task-date').textContent.trim();
          return { results, label };
        } finally {
          window.Date = RealDate;
        }
      })()
    `);
    assert.deepEqual(todoRollover, { results: [true, true, true, true, true], label: '今天 23:30' }, '常驻跨天、跨年和闰年都应使用当天 23:30；23:30 之后是明天');

    await window.webContents.executeJavaScript(`
      window.__measureHomepage = function measureHomepage() {
        const surface = document.getElementById('home-bento').getBoundingClientRect();
        const box = (rect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
        const tiles = [...document.querySelectorAll('#home-bento [data-home-module]')]
          .filter((tile) => !tile.hidden)
          .map((tile) => {
            const rect = tile.getBoundingClientRect();
            const outsideControls = [...tile.querySelectorAll('button, input')]
              .filter((control) => control.getClientRects().length && !control.closest('[hidden]'))
              .filter((control) => {
                const child = control.getBoundingClientRect();
                return child.width > 0 && child.height > 0 && !(
                  child.left >= rect.left - 1 && child.right <= rect.right + 1
                  && child.top >= rect.top - 1 && child.bottom <= rect.bottom + 1
                );
              })
              .map((control) => control.id || control.className || control.tagName);
            // Content that outgrows its own block would slide under the next one (e.g. 接下来 under 记一笔).
            const inner = [...tile.querySelectorAll('.now-idle, .now-running, .energy-body')]
              .filter((block) => !block.hidden)
              .map((block) => block.scrollHeight - block.clientHeight);
            return { id: tile.dataset.homeModule, rect: box(rect), outsideControls, overflow: Math.max(tile.scrollHeight - tile.clientHeight, ...inner) };
          });
        return {
          surface: box(surface),
          tiles,
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
          animations: document.getElementById('home-bento').getAnimations().length,
        };
      };
      void 0;
    `);

    function assertHomepageMeasurement(measurement, visibleIds, label) {
      assert.deepEqual(measurement.tiles.map((tile) => tile.id), visibleIds, label);
      assert.equal(measurement.reducedMotion, true);
      assert.equal(measurement.animations, 0, `${label}: 显隐不做布局动画`);
      measurement.tiles.forEach((tile) => {
        assert.deepEqual(tile.outsideControls, [], `${label}: ${tile.id} 的控件必须留在卡片里`);
        assert.ok(tile.overflow <= 1, `${label}: ${tile.id} 内容溢出 ${tile.overflow}px`);
        assert.ok(tile.rect.left >= measurement.surface.left - 1, `${label}: ${tile.id} 越过首页左边界`);
        assert.ok(tile.rect.right <= measurement.surface.right + 1, `${label}: ${tile.id} 越过首页右边界`);
        assert.ok(tile.rect.top >= measurement.surface.top - 1, `${label}: ${tile.id} 越过首页上边界`);
        assert.ok(tile.rect.bottom <= measurement.surface.bottom + 1, `${label}: ${tile.id} 越过首页下边界`);
      });
      for (let left = 0; left < measurement.tiles.length; left += 1) {
        for (let right = left + 1; right < measurement.tiles.length; right += 1) {
          const a = measurement.tiles[left].rect;
          const b = measurement.tiles[right].rect;
          const overlaps = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          assert.equal(overlaps, false, `${label}: 首页卡片不得重叠`);
        }
      }
      // Hidden cards leave no gap: the visible cards span the full width of the home page.
      const left = Math.min(...measurement.tiles.map((tile) => tile.rect.left));
      const right = Math.max(...measurement.tiles.map((tile) => tile.rect.right));
      assert.ok(left <= measurement.surface.left + 1 && right >= measurement.surface.right - 1, `${label}: 卡片应铺满首页`);
    }

    for (const [width, height] of [[1240, 616], [1000, 576]]) {
      window.setSize(width, height);
      const matrix = await window.webContents.executeJavaScript(`
        (async () => {
          const ids = ['now', 'energy', 'usage', 'mirror'];
          ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
          const results = [];
          for (let count = 4; count >= 1; count -= 1) {
            document.getElementById('tab-button-home').click();
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            results.push({ visible: window.NotchHome.getVisibility().visibleIds, measurement: window.__measureHomepage() });
            if (count > 1) {
              document.getElementById('tab-button-settings').click();
              const input = document.querySelector('[data-settings-home-module="' + ids[4 - count] + '"]');
              input.checked = false;
              input.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise((resolve) => setTimeout(resolve, 20));
            }
          }
          return results;
        })()
      `);
      matrix.forEach(({ visible, measurement }) => assertHomepageMeasurement(measurement, visible, `${width}×${height} ${visible.join('+')}`));

      const finalWidgetGuard = await window.webContents.executeJavaScript(`
        (async () => {
          document.getElementById('tab-button-settings').click();
          const enabled = [...document.querySelectorAll('[data-settings-home-module]')].find((input) => input.checked);
          enabled.checked = false;
          enabled.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          return {
            checked: enabled.checked,
            visibleCount: window.NotchHome.getVisibility().visibleIds.length,
            storedCount: JSON.parse(localStorage.getItem('notch-home-hidden-modules-v2')).length,
            message: document.getElementById('status-toast-message').textContent,
          };
        })()
      `);
      assert.equal(finalWidgetGuard.checked, true);
      assert.equal(finalWidgetGuard.visibleCount, 1);
      assert.equal(finalWidgetGuard.storedCount, 3);
      assert.match(finalWidgetGuard.message, /至少保留一个/);
    }
    window.setSize(1240, 616);

    const transactionAudit = await window.webContents.executeJavaScript(`
      (() => {
        const ids = ['now', 'energy', 'usage', 'mirror'];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const first = window.NotchHome.setModuleVisible('mirror', false);
        const second = window.NotchHome.setModuleVisible('now', false);
        const rapidHidden = [...window.NotchHome.getVisibility().hiddenIds];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        window.NotchHome.setModuleVisible('energy', false);
        let eventCount = 0;
        const onChange = () => { eventCount += 1; };
        document.addEventListener('notch:home-modules-changed', onChange);
        const storageBeforeNoop = localStorage.getItem('notch-home-hidden-modules-v2');
        const noop = window.NotchHome.setModuleVisible('energy', false);
        const noOpStorageStable = storageBeforeNoop === localStorage.getItem('notch-home-hidden-modules-v2');
        document.removeEventListener('notch:home-modules-changed', onChange);
        const invalid = window.NotchHome.setModuleVisible('windows', false);
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const durations = [];
        for (let index = 0; index < 100; index += 1) {
          const start = performance.now();
          window.NotchHome.setModuleVisible('energy', index % 2 === 0 ? false : true);
          durations.push(performance.now() - start);
        }
        durations.sort((a, b) => a - b);
        return {
          first, second, rapidHidden, noop, eventCount, noOpStorageStable, invalid,
          p95: durations[Math.floor(durations.length * .95)],
          maximum: durations[durations.length - 1],
          animationCount: document.getElementById('home-bento').getAnimations().length,
        };
      })()
    `);
    assert.equal(transactionAudit.first.ok, true);
    assert.equal(transactionAudit.second.ok, true);
    // Hidden ids follow the registry order (now comes before mirror).
    assert.deepEqual(transactionAudit.rapidHidden, ['now', 'mirror']);
    assert.equal(transactionAudit.noop.changed, false);
    assert.equal(transactionAudit.eventCount, 0);
    assert.equal(transactionAudit.noOpStorageStable, true);
    assert.equal(transactionAudit.invalid.error, 'invalid_module', 'the removed windows card cannot come back');
    assert.ok(transactionAudit.p95 < 16, `显隐事务 p95 ${transactionAudit.p95.toFixed(2)}ms 超过 16ms`);
    assert.ok(transactionAudit.maximum < 50, `显隐事务最长 ${transactionAudit.maximum.toFixed(2)}ms 超过 50ms`);
    assert.equal(transactionAudit.animationCount, 0);

    const persistenceAudit = await window.webContents.executeJavaScript(`
      (() => {
        const ids = ['now', 'energy', 'usage', 'mirror'];
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));
        const originalSetItem = Storage.prototype.setItem;
        const storedBefore = localStorage.getItem('notch-home-hidden-modules-v2');
        Storage.prototype.setItem = function setItem(key, value) {
          if (key === 'notch-home-hidden-modules-v2') throw new Error('simulated quota failure');
          return originalSetItem.call(this, key, value);
        };
        const degraded = window.NotchHome.setModuleVisible('mirror', false);
        const degradedState = window.NotchHome.getVisibility();
        const degradedStatus = document.getElementById('settings-home-module-status').textContent;
        const degradedStorageStable = storedBefore === localStorage.getItem('notch-home-hidden-modules-v2');
        ['usage', 'energy'].forEach((id) => window.NotchHome.setModuleVisible(id, false));
        const rejectedWhileDirty = window.NotchHome.setModuleVisible('now', false);
        Storage.prototype.setItem = originalSetItem;
        const recovered = window.NotchHome.setModuleVisible('usage', true);
        const recoveredState = window.NotchHome.getVisibility();
        const recoveredStored = JSON.parse(localStorage.getItem('notch-home-hidden-modules-v2'));
        ids.forEach((id) => window.NotchHome.setModuleVisible(id, true));

        const captureInput = document.getElementById('now-capture-input');
        captureInput.focus();
        const nowTile = captureInput.closest('[data-home-module]');
        window.NotchHome.setModuleVisible('now', false);
        const focusReleased = !nowTile.contains(document.activeElement) && nowTile.hidden;
        window.NotchHome.setModuleVisible('now', true);
        return {
          degraded,
          degradedPersisted: degradedState.persisted,
          degradedStorageStable,
          degradedStatus,
          rejectedWhileDirty,
          recovered,
          recoveredPersisted: recoveredState.persisted,
          recoveredStored,
          focusReleased,
        };
      })()
    `);
    assert.equal(persistenceAudit.degraded.ok, true);
    assert.equal(persistenceAudit.degraded.persisted, false);
    assert.equal(persistenceAudit.degradedPersisted, false);
    assert.equal(persistenceAudit.degradedStorageStable, true);
    assert.match(persistenceAudit.degradedStatus, /仅当前会话/);
    assert.equal(persistenceAudit.rejectedWhileDirty.ok, false);
    assert.equal(persistenceAudit.rejectedWhileDirty.persisted, false);
    assert.equal(persistenceAudit.recovered.ok, true);
    assert.equal(persistenceAudit.recovered.persisted, true);
    assert.equal(persistenceAudit.recoveredPersisted, true);
    assert.deepEqual(persistenceAudit.recoveredStored, ['energy', 'mirror']);
    assert.equal(persistenceAudit.focusReleased, true);

    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'no-preference' },
        // CI hosts may reduce transparency by default; set the glass test baseline explicitly.
        { name: 'prefers-reduced-transparency', value: 'no-preference' },
      ],
    });
    const panelMotionAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        appSurface.classList.remove('expanded', 'opening', 'closing');
        appSurface.classList.add('collapsed');
        const waitForClass = async (name) => {
          const deadline = performance.now() + 5000;
          while (performance.now() < deadline) {
            if (appSurface.classList.contains(name)) return true;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          return false;
        };
        document.getElementById('notch').click();
        const opened = await waitForClass('expanded');
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const tileEntranceAnimations = [...document.querySelectorAll('#home-bento [data-home-module]')]
          .flatMap((tile) => tile.getAnimations())
          .filter((animation) => animation.animationName === 'bento-masonry-in').length;
        const contentLayerHasScale = [
          document.querySelector('.panel > .topbar'),
          document.querySelector('.panel > .panels'),
        ].filter(Boolean).some((layer) => layer.getAnimations().some((animation) => (
          animation.effect?.getKeyframes?.().some((frame) => {
            if (!frame.transform || frame.transform === 'none') return false;
            const matrix = new DOMMatrixReadOnly(frame.transform);
            const scaleX = Math.hypot(matrix.a, matrix.b);
            const scaleY = Math.hypot(matrix.c, matrix.d);
            return Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;
          })
        )));
        const masonryReveal = document.getElementById('home-bento').classList.contains('masonry-reveal');
        document.getElementById('notch').click();
        const collapsed = await waitForClass('collapsed');
        return { opened, collapsed, tileEntranceAnimations, contentLayerHasScale, masonryReveal };
      })()
    `);
    assert.equal(panelMotionAudit.opened, true);
    assert.equal(panelMotionAudit.collapsed, true);
    assert.equal(panelMotionAudit.tileEntranceAnimations, 0, '展开时不得再同时启动七张卡片的错峰缩放入场');
    assert.equal(panelMotionAudit.masonryReveal, false, '首页卡片不应在每次展开时重播入场');
    assert.equal(panelMotionAudit.contentLayerHasScale, false, '展开/收起不应缩放整个大面积内容层');

    const lifecycleAudit = await window.webContents.executeJavaScript(`
      (async () => {
        ['now', 'energy', 'usage', 'mirror'].forEach((id) => window.NotchHome.setModuleVisible(id, true));
        document.getElementById('tab-button-home').click();
        document.getElementById('app').classList.remove('collapsed', 'closing', 'opening');
        document.getElementById('app').classList.add('expanded');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        window.NotchPomodoro.start(10, 'focus');
        const before = window.NotchPomodoro.state().remaining;
        window.NotchHome.setModuleVisible('now', false);
        await new Promise((resolve) => setTimeout(resolve, 1150));
        const whileHidden = window.NotchPomodoro.state().remaining;
        window.NotchHome.setModuleVisible('now', true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const shown = document.getElementById('now-remaining').textContent;
        const expected = '00:' + String(window.NotchPomodoro.state().remaining).padStart(2, '0');
        window.NotchPomodoro.finish();
        return { before, whileHidden, shown, expected, running: document.getElementById('home-now').dataset.state };
      })()
    `);
    assert.ok(lifecycleAudit.whileHidden < lifecycleAudit.before, '「现在」隐藏后番茄钟应继续计时');
    assert.equal(lifecycleAudit.shown, lifecycleAudit.expected, '重新显示时读数与计时一致');
    assert.equal(lifecycleAudit.running, 'idle');

    const idlePerformanceAudit = await window.webContents.executeJavaScript(`
      (async () => {
        const appSurface = document.getElementById('app');
        document.getElementById('tab-button-home').click();
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const webglCanvases = [...document.querySelectorAll('#panel canvas')]
          .filter((node) => node.getContext && node.dataset.effectRunning !== undefined).length;
        const hasInfinitePanelEffect = document.getElementById('panel').getAnimations({ subtree: true })
          .some((animation) => animation.animationName === 'bento-border-breathe'
            && animation.effect?.getTiming?.().iterations === Infinity);
        const panelBackdropFilter = getComputedStyle(document.getElementById('panel'), '::before').backdropFilter;
        appSurface.classList.remove('expanded');
        appSurface.classList.add('collapsed');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: false } }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        appSurface.classList.remove('collapsed');
        appSurface.classList.add('expanded');
        document.dispatchEvent(new CustomEvent('notch:modechange', { detail: { expanded: true } }));
        return {
          webglCanvases,
          hasInfinitePanelEffect,
          panelBackdropFilter,
        };
      })()
    `);
    assert.equal(idlePerformanceAudit.webglCanvases, 0, '汽水音乐的 WebGL 背景已移除，面板内不应再有常驻渲染画布');
    assert.equal(idlePerformanceAudit.hasInfinitePanelEffect, false, '展开后不得运行大面积无限边框滤镜动画');
    assert.match(
      idlePerformanceAudit.panelBackdropFilter,
      /blur\((?:[3-9]\d|\d{3,})px\)/,
      '玻璃版面板必须使用足够强的实时背景模糊来压住复杂桌面壁纸'
    );

    // Separately verify the accessibility fallback instead of inheriting the host's preference.
    await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'prefers-reduced-transparency', value: 'reduce' },
      ],
    });
    const reducedTransparency = await window.webContents.executeJavaScript(`
      (() => {
        const style = getComputedStyle(document.getElementById('panel'), '::before');
        return { backdrop: style.backdropFilter, background: style.backgroundColor };
      })()
    `);
    assert.equal(reducedTransparency.backdrop, 'none', '减少透明度偏好应关闭背景模糊');
    assert.match(reducedTransparency.background, /0\.96\)/, '减少透明度偏好应使用更不透明的背景');
  } finally {
    if (window.webContents.debugger.isAttached()) window.webContents.debugger.detach();
    window.destroy();
  }
}

main().then(
  () => { diagnostic('Renderer interaction checks passed'); app.quit(); },
  (error) => {
    diagnostic(error.stack);
    app.exit(1);
  }
);
