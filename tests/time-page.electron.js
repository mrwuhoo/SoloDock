const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Time page renderer timed out'); app.exit(1); }, 40000);

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

  // A month of work built with the same rules the main process uses; day 3 is a 10.5-hour day.
  const setup = `(() => {
    const W = window.NotchWorklog;
    const today = W.dayKey(Date.now());
    const [year, month, todayDate] = today.split('-').map(Number);
    const pad = (value) => String(value).padStart(2, '0');
    const hourly = [6.5, 8, 10.5, 4, 7, 0, 5.5, 9, 7.5, 6, 8.5, 3, 7, 6.5];
    const worklog = {};
    for (let date = 1; date <= Math.min(todayDate, 14); date += 1) {
      const key = year + '-' + pad(month) + '-' + pad(date);
      const hours = hourly[date - 1];
      if (!hours) continue;
      const start = W.dayStart(key) + 5 * 3600000; // 09:00
      let runs = W.addInterval([], start, start + hours * 3600000);
      runs = W.addInterval(runs, start + 3600000, start + 3600000 + hours * 0.3 * 3600000, 'focus');
      worklog[key] = { runs, todos: date % 3, ai: date % 4 };
    }
    window.__worklog = worklog;
    return { today, year, month, todayDate };
  })()`;
  const info = await win.webContents.executeJavaScript(setup);

  const result = await win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
    const $ = (id) => document.getElementById(id);
    await setMode(true);
    await setActiveTab('time');
    await settle(250);
    const cells = [...document.querySelectorAll('#time-grid .time-cell[data-key]')];
    const out = {
      title: $('time-month-title').textContent,
      stats: [...document.querySelectorAll('.time-stat')].map((stat) => [stat.querySelector('span').textContent, stat.querySelector('b').textContent]),
      note: document.querySelector('.time-summary-note')?.textContent || '',
      cells: cells.length,
      todayCell: document.querySelector('.time-cell.today')?.dataset.key,
      selected: document.querySelector('.time-cell.selected')?.dataset.key,
      longDays: [...document.querySelectorAll('.time-cell.long')].map((cell) => Number(cell.dataset.key.slice(8))),
      nextDisabled: $('time-month-next').disabled,
      todayDisabled: $('time-month-today').disabled,
      tabVisible: !$('tab-button-time').hidden,
    };
    // Pick day 3 for the detail view.
    const day3 = cells.find((cell) => Number(cell.dataset.key.slice(8)) === 3);
    if (day3) {
      day3.click();
      await settle();
      out.day3 = {
        title: $('time-day-title').textContent,
        metrics: [...document.querySelectorAll('.time-metric')].map((metric) => [metric.querySelector('span').textContent, metric.querySelector('b').textContent, metric.classList.contains('warn')]),
        facts: $('time-facts').textContent,
        segments: [...document.querySelectorAll('#time-bar .time-bar-segment')].map((segment) => segment.className.replace('time-bar-segment ', '')),
        // The grid re-renders on selection, so look the cell up again.
        level: getComputedStyle(document.querySelector('.time-cell[data-key="' + day3.dataset.key + '"]')).getPropertyValue('--level').trim(),
        label: document.querySelector('.time-cell[data-key="' + day3.dataset.key + '"]').getAttribute('aria-label'),
      };
    }
    out.observation = $('time-observation').textContent;
    // Previous month: navigation re-requests data; next becomes available.
    $('time-month-prev').click();
    await settle();
    out.prev = { title: $('time-month-title').textContent, nextDisabled: $('time-month-next').disabled, calls: window.__calls.filter((call) => call[0] === 'worklog').length };
    $('time-month-today').click();
    await settle();
    out.back = $('time-month-title').textContent;
    const box = document.querySelector('.time-page').getBoundingClientRect();
    out.overflow = [...document.querySelectorAll('.time-month, .time-day, .time-cell, .time-stat, .time-metric, .time-rhythm-day b, .time-privacy')].filter((node) => {
      const r = node.getBoundingClientRect();
      return r.right > box.right + 1 || r.bottom > box.bottom + 1;
    }).map((node) => node.className);
    return out;
  })()`);

  assert.equal(result.title, `${info.year} 年 ${info.month} 月`);
  assert.deepEqual(result.stats.map((stat) => stat[0]), ['本月', '日均', '专注占比', '完成待办', '超过 10 小时']);
  assert.equal(result.stats[2][1], '30%', 'focus share across the month');
  assert.match(result.note, /^已记录 \d+ 天 · 满 7 天后显示与上月的对比$|^$/);
  assert.ok(result.cells >= 28 && result.cells <= 31);
  assert.equal(result.todayCell, info.today);
  assert.equal(result.selected, info.today, 'today is selected on arrival');
  if (info.todayDate >= 3) assert.deepEqual(result.longDays, [3], 'only the 10.5-hour day gets the amber dot');
  assert.equal(result.nextDisabled, true, 'no future months');
  assert.equal(result.todayDisabled, true);
  assert.equal(result.tabVisible, true);
  // Day 3 only has data once it has happened (on the 1st and 2nd of a month it is still ahead).
  if (result.day3 && info.todayDate >= 3) {
    assert.match(result.day3.title, /月3日 周[日一二三四五六]$/);
    assert.deepEqual(result.day3.metrics.map((metric) => metric[0]), ['工作时长', '专注', '最长连续', '收工时间']);
    assert.equal(result.day3.metrics[0][1], '10 小时 30 分');
    assert.deepEqual(result.day3.metrics[2], ['最长连续', '10 小时 30 分', true], 'a stretch over 90 minutes is flagged');
    assert.equal(result.day3.metrics[3][1], '19:30');
    assert.equal(result.day3.facts, '完成待办 0 项 · 专注 0 次 · AI 任务 3 个');
    assert.deepEqual(result.day3.segments, ['active', 'focus', 'active']);
    assert.equal(result.day3.level, String(10.5 / 12));
    assert.match(result.day3.label, /10 小时 30 分 · 专注 3 小时 9 分 · 收工 19:30/);
  }
  assert.match(result.observation, /^这周|^这周还没有记录/);
  assert.equal(result.prev.nextDisabled, false);
  assert.ok(result.prev.calls >= 2);
  assert.equal(result.back, result.title);
  assert.deepEqual(result.overflow, []);

  if (process.env.SOLODOCK_TIME_SCREENSHOT_DIR) {
    await win.webContents.executeJavaScript(`(async () => {
      const cells = [...document.querySelectorAll('#time-grid .time-cell[data-key]')];
      const pick = cells.find((cell) => Number(cell.dataset.key.slice(8)) === Math.min(8, cells.length));
      pick?.click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const rect = await win.webContents.executeJavaScript(`(() => { const r = document.getElementById('tab-time').getBoundingClientRect(); return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) }; })()`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_TIME_SCREENSHOT_DIR, 'time-page.png'), (await win.webContents.capturePage(rect)).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Time page checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
