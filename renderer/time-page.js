// 时间页：一张月历看清每天工作多久、专注占多少、有没有过度工作。只陈述事实，不打分。
// 数据来自主进程 worklog-store.js（在用电脑 / 专注的时间段）；日程来自今天时间线，专注次数来自番茄钟记录。
(function bootstrapTimePage() {
  'use strict';

  const W = window.NotchWorklog;
  const get = (id) => document.getElementById(id);
  const tab = get('tab-time');
  if (!W || !tab) return;

  const grid = get('time-grid');
  const summary = get('time-summary');
  const LONG_STREAK_MINUTES = 90;
  const pad = (value) => String(value).padStart(2, '0');
  const WEEKDAY = '日一二三四五六';

  let viewYear = 0;
  let viewMonth = 0;
  let selectedKey = '';
  let days = {};
  let recordedDays = 0;
  let enabled = true;
  let animatedOnce = false;
  let liveTimer = null;

  function todayKey() {
    return W.dayKey(Date.now());
  }

  function monthOf(key) {
    const [year, month] = key.split('-').map(Number);
    return { year, month };
  }

  function clock(time) {
    const date = new Date(time);
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function hours(minutes) {
    return minutes >= 60 ? `${Math.floor(minutes / 60)}.${Math.round((minutes % 60) / 6)}` : '0';
  }

  function readLocal(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  // 月历与右侧详情都从主进程取这个月和上个月（用来对比）。
  async function load() {
    const first = `${viewYear}-${pad(viewMonth)}-01`;
    const previous = new Date(viewYear, viewMonth - 2, 1);
    const from = `${previous.getFullYear()}-${pad(previous.getMonth() + 1)}-01`;
    const last = `${viewYear}-${pad(viewMonth)}-${pad(new Date(viewYear, viewMonth, 0).getDate())}`;
    const result = await window.notchAPI?.getWorklog?.(from, last > first ? last : first)?.catch?.(() => null);
    days = result?.days || {};
    recordedDays = Number(result?.recordedDays) || 0;
    enabled = result?.enabled !== false;
    render();
  }

  function renderSummary() {
    const current = W.summarizeMonth(days, viewYear, viewMonth);
    const previousDate = new Date(viewYear, viewMonth - 2, 1);
    const previous = W.summarizeMonth(days, previousDate.getFullYear(), previousDate.getMonth() + 1);
    const compare = (value, before) => {
      if (recordedDays < 7 || !before) return '';
      const change = Math.round(((value - before) / before) * 100);
      return change ? `<small class="${change > 0 ? 'up' : 'down'}">比上月 ${change > 0 ? '+' : ''}${change}%</small>` : '<small>与上月持平</small>';
    };
    const stats = [
      ['本月', `${hours(current.activeMinutes)}<em>小时</em>`, compare(current.activeMinutes, previous.activeMinutes)],
      ['日均', `${hours(current.averageMinutes)}<em>小时</em>`, compare(current.averageMinutes, previous.averageMinutes)],
      ['专注占比', `${Math.round(current.focusRatio * 100)}<em>%</em>`, ''],
      ['完成待办', `${current.todosDone}<em>项</em>`, ''],
      ['超过 10 小时', `${current.longDays}<em>天</em>`, ''],
    ];
    summary.innerHTML = stats.map(([label, value, note]) => `<div class="time-stat"><span>${label}</span><b>${value}</b>${note}</div>`).join('');
    if (!enabled) {
      summary.insertAdjacentHTML('beforeend', '<p class="time-summary-note">工作时间统计已关闭 · 可在「设置 → 身体与作息」打开</p>');
    } else if (recordedDays < 7) {
      summary.insertAdjacentHTML('beforeend', `<p class="time-summary-note">已记录 ${recordedDays} 天 · 满 7 天后显示与上月的对比</p>`);
    }
  }

  function renderGrid() {
    const today = todayKey();
    grid.replaceChildren();
    for (const key of W.monthGrid(viewYear, viewMonth)) {
      const cell = document.createElement(key ? 'button' : 'span');
      cell.className = 'time-cell';
      if (!key) {
        cell.classList.add('empty');
        grid.append(cell);
        continue;
      }
      const day = W.summarizeDay(days[key]);
      cell.type = 'button';
      cell.dataset.key = key;
      if (key === today) cell.classList.add('today');
      if (key === selectedKey) cell.classList.add('selected');
      if (key > today) cell.classList.add('future');
      if (day.activeMinutes > W.LONG_DAY_MINUTES) cell.classList.add('long');
      const level = W.cupLevel(day.activeMinutes);
      const focusShare = day.activeMinutes ? day.focusMinutes / day.activeMinutes : 0;
      cell.style.setProperty('--level', String(level));
      cell.style.setProperty('--focus', String(focusShare));
      const date = Number(key.slice(8));
      cell.innerHTML = `<span class="time-cell-date">${date}</span><span class="time-cup"><i class="time-water"><i class="time-water-focus"></i></i></span>${day.activeMinutes ? `<span class="time-cell-hours">${hours(day.activeMinutes)}h</span>` : ''}`;
      const label = day.activeMinutes
        ? `${viewMonth}月${date}日 · ${W.formatMinutes(day.activeMinutes)} · 专注 ${W.formatMinutes(day.focusMinutes)} · 收工 ${clock(day.lastActive)}`
        : `${viewMonth}月${date}日 · 没有记录`;
      cell.title = label;
      cell.setAttribute('aria-label', label);
      cell.setAttribute('aria-pressed', String(key === selectedKey));
      grid.append(cell);
    }
    // 水位只在第一次进入时从 0 升起一次。
    if (!animatedOnce) {
      animatedOnce = true;
      grid.classList.add('rising');
      requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.remove('rising')));
    }
  }

  function renderDay() {
    const key = selectedKey;
    const start = W.dayStart(key);
    const date = new Date(start);
    const day = W.summarizeDay(days[key]);
    get('time-day-label').textContent = key === todayKey() ? '今天' : '当天';
    get('time-day-title').textContent = `${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAY[date.getDay()]}`;

    // 08–24 时间条：浅色 = 在用电脑，深色 = 专注，白底描边 = 日程。
    const bar = get('time-bar');
    bar.replaceChildren();
    const from = start + 4 * 3600_000; // 08:00
    const to = start + 20 * 3600_000; // 24:00
    const percent = (time) => Math.max(0, Math.min(100, ((time - from) / (to - from)) * 100));
    for (const [s, e, kind] of days[key]?.runs || []) {
      if (e <= from || s >= to) continue;
      const segment = document.createElement('span');
      segment.className = `time-bar-segment ${kind}`;
      segment.style.left = `${percent(s)}%`;
      segment.style.width = `${Math.max(0.4, percent(e) - percent(s))}%`;
      segment.title = `${kind === 'focus' ? '专注' : '在用电脑'} ${clock(s)}–${clock(e)}`;
      bar.append(segment);
    }
    const events = window.NotchTimeline ? window.NotchTimeline.normalizeEvents(readLocal('notch-events-v1', [])) : [];
    for (const event of events) {
      if (event.start < from || event.start >= to) continue;
      const pill = document.createElement('span');
      pill.className = 'time-bar-event';
      pill.style.left = `${percent(event.start)}%`;
      pill.style.width = `${Math.max(1, percent(event.start + event.durationMin * 60000) - percent(event.start))}%`;
      pill.title = `${clock(event.start)} ${event.title}`;
      bar.append(pill);
    }

    const longStreak = day.longestMinutes > LONG_STREAK_MINUTES;
    get('time-metrics').innerHTML = [
      ['工作时长', day.activeMinutes ? W.formatMinutes(day.activeMinutes) : '—', ''],
      ['专注', day.focusMinutes ? W.formatMinutes(day.focusMinutes) : '—', day.activeMinutes ? `占 ${Math.round((day.focusMinutes / day.activeMinutes) * 100)}%` : ''],
      ['最长连续', day.longestMinutes ? W.formatMinutes(day.longestMinutes) : '—', longStreak ? '超过 90 分钟' : '', longStreak ? 'warn' : ''],
      ['收工时间', day.lastActive ? clock(day.lastActive) : '—', day.firstActive ? `${clock(day.firstActive)} 开始` : ''],
    ].map(([label, value, note, tone]) => `<div class="time-metric${tone ? ` ${tone}` : ''}"${tone === 'warn' ? ' role="button" tabindex="0" data-go="body"' : ''}><span>${label}</span><b>${value}</b>${note ? `<small>${note}</small>` : ''}</div>`).join('');

    const focusSessions = (readLocal('notch-focus-log-v1', []) || []).filter((item) => item && item.end >= start && item.end < start + 86400000).length;
    get('time-facts').textContent = `完成待办 ${day.todosDone} 项 · 专注 ${focusSessions} 次 · AI 任务 ${day.aiTasks} 个`;
    get('time-observation').textContent = observation(key);
    renderRhythm(key);
  }

  // 本周作息：一到日七条竖向时间轴（上 8 点、下 24 点），看得出几点开工、几点收工。
  function renderRhythm(key) {
    const rhythm = get('time-rhythm');
    const start = W.dayStart(key);
    const weekday = (new Date(start).getDay() + 6) % 7;
    rhythm.replaceChildren();
    for (let index = 0; index < 7; index += 1) {
      const dayKey = W.dayKey(start + (index - weekday) * 86400000 + 3600_000);
      const dayStartAt = W.dayStart(dayKey);
      const from = dayStartAt + 4 * 3600_000;
      const to = dayStartAt + 20 * 3600_000;
      const column = document.createElement('div');
      column.className = `time-rhythm-day${dayKey === key ? ' selected' : ''}${dayKey > todayKey() ? ' future' : ''}`;
      column.dataset.key = dayKey;
      const track = document.createElement('span');
      track.className = 'time-rhythm-track';
      for (const [s, e, kind] of days[dayKey]?.runs || []) {
        if (e <= from || s >= to) continue;
        const segment = document.createElement('i');
        segment.className = kind;
        segment.style.top = `${((Math.max(s, from) - from) / (to - from)) * 100}%`;
        segment.style.height = `${Math.max(1.5, ((Math.min(e, to) - Math.max(s, from)) / (to - from)) * 100)}%`;
        track.append(segment);
      }
      const label = document.createElement('b');
      label.textContent = '一二三四五六日'[index];
      column.append(track, label);
      column.title = `${dayKey.slice(5).replace('-', '月')}日 · ${W.formatMinutes(W.summarizeDay(days[dayKey]).activeMinutes)}`;
      rhythm.append(column);
    }
  }

  // 一句只陈述事实的本周观察。
  function observation(key) {
    const start = W.dayStart(key);
    const weekday = (new Date(start).getDay() + 6) % 7;
    const weekKeys = Array.from({ length: weekday + 1 }, (_, index) => W.dayKey(start - (weekday - index) * 86400000 + 3600_000));
    const worked = weekKeys.map((item) => W.summarizeDay(days[item])).filter((item) => item.activeMinutes > 0);
    if (!worked.length) return '这周还没有记录。';
    const average = Math.round(worked.reduce((sum, item) => sum + item.activeMinutes, 0) / worked.length);
    const late = worked.filter((item) => {
      const hour = item.lastActive ? new Date(item.lastActive).getHours() : 12;
      return hour >= 23 || hour < 4;
    }).length;
    return `这周工作了 ${worked.length} 天，平均每天 ${W.formatMinutes(average)}${late ? `，其中 ${late} 天过了 23 点才收工` : ''}。`;
  }

  function render() {
    get('time-month-title').textContent = `${viewYear} 年 ${viewMonth} 月`;
    const current = monthOf(todayKey());
    get('time-month-today').disabled = current.year === viewYear && current.month === viewMonth;
    get('time-month-next').disabled = viewYear > current.year || (viewYear === current.year && viewMonth >= current.month);
    renderSummary();
    renderGrid();
    renderDay();
  }

  function goMonth(delta) {
    const date = new Date(viewYear, viewMonth - 1 + delta, 1);
    viewYear = date.getFullYear();
    viewMonth = date.getMonth() + 1;
    const current = monthOf(todayKey());
    selectedKey = current.year === viewYear && current.month === viewMonth ? todayKey() : `${viewYear}-${pad(viewMonth)}-01`;
    load();
  }

  function goToday() {
    const current = monthOf(todayKey());
    viewYear = current.year;
    viewMonth = current.month;
    selectedKey = todayKey();
  }

  get('time-rhythm').addEventListener('click', (event) => {
    const column = event.target.closest('.time-rhythm-day[data-key]:not(.future)');
    if (!column) return;
    const { year, month } = monthOf(column.dataset.key);
    selectedKey = column.dataset.key;
    if (year !== viewYear || month !== viewMonth) {
      viewYear = year;
      viewMonth = month;
      load();
      return;
    }
    renderGrid();
    renderDay();
  });

  grid.addEventListener('click', (event) => {
    const cell = event.target.closest('.time-cell[data-key]');
    if (!cell) return;
    selectedKey = cell.dataset.key;
    renderGrid();
    renderDay();
  });
  get('time-month-prev').addEventListener('click', () => goMonth(-1));
  get('time-month-next').addEventListener('click', () => goMonth(1));
  get('time-month-today').addEventListener('click', () => { goToday(); load(); });

  const openBodySettings = () => {
    window.setActiveTab?.('settings');
    requestAnimationFrame(() => get('settings-body-card')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };
  get('time-privacy').addEventListener('click', openBodySettings);
  get('time-metrics').addEventListener('click', (event) => {
    if (event.target.closest('[data-go="body"]')) openBodySettings();
  });

  // 今天的数据实时累计：页面可见时每分钟刷新一次。
  document.addEventListener('notch:tabchange', (event) => {
    if (liveTimer) clearInterval(liveTimer);
    liveTimer = null;
    if (event.detail?.tab !== 'time') return;
    if (!viewYear) goToday();
    load();
    liveTimer = setInterval(load, 60_000);
  });

  goToday();
  window.NotchTimePage = { load, state: () => ({ viewYear, viewMonth, selectedKey, recordedDays, enabled }) };
})();
