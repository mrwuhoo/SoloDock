// Home "今天" strip: a 08:00–24:00 timeline of schedule events, todo deadlines, focus sessions,
// AI completions and "remind me later" entries, with quick forms to add events and reminders.
(function bootstrapTodayStrip() {
  'use strict';

  const Timeline = window.NotchTimeline;
  const strip = document.getElementById('today-strip');
  const line = document.getElementById('today-line');
  if (!Timeline || !strip || !line) return;

  const EVENTS_KEY = 'notch-events-v1';
  const LATER_KEY = 'notch-later-v1';
  const FOCUS_LOG_KEY = 'notch-focus-log-v1';
  const STRIP_KEY = 'notch-home-strip-v1';
  const CATEGORY_COLORS = { P0: 'var(--sd-cat-1)', P1: 'var(--sd-cat-2)', P2: 'var(--sd-cat-3)', P3: 'var(--sd-cat-4)' };
  // The completion history already leaves out todos and reminders; pomodoro is shown as focus instead.
  const NOT_AI_SOURCES = new Set(['todo', 'event', 'reminder', 'pomodoro']);
  const get = (id) => document.getElementById(id);

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { /* keep session state */ }
  };
  const toast = (message, options) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message, options);
  };
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  let events = Timeline.normalizeEvents(readJson(EVENTS_KEY, []));
  let later = Timeline.normalizeLater(readJson(LATER_KEY, []));
  let completions = [];
  let editingEventId = '';

  function saveEvents() {
    writeJson(EVENTS_KEY, events);
    scheduleReminders();
    render();
  }

  function saveLater() {
    writeJson(LATER_KEY, later);
    scheduleReminders();
    render();
  }

  function scheduleReminders() {
    window.notchAPI?.scheduleReminders?.(Timeline.reminderQueue(events, later)).catch(() => {});
  }

  function focusToday(now) {
    const { start, end } = Timeline.dayBounds(now);
    const log = readJson(FOCUS_LOG_KEY, []);
    return (Array.isArray(log) ? log : [])
      .map((item) => ({ start: Number(item.start), end: Number(item.end), minutes: Number(item.minutes) || 0 }))
      .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > start && item.start < end);
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function positioned(node, percent) {
    node.style.left = `${percent}%`;
    return node;
  }

  // Event pills and deadline labels share the row above the track. Near the right edge a label
  // hangs to the left of its time; an event that collides is shortened to its time, a deadline
  // label that still collides is dropped (the diamond on the track stays).
  function resolveRow(items) {
    const box = line.getBoundingClientRect();
    if (!box.width) return;
    let lastRight = -Infinity;
    items.sort((left, right) => left.percent - right.percent).forEach(({ node, isEvent, time }) => {
      let rect = node.getBoundingClientRect();
      if (rect.right > box.right) {
        node.classList.add('end');
        rect = node.getBoundingClientRect();
      }
      if (rect.left >= lastRight + 6) {
        lastRight = rect.right;
        return;
      }
      if (isEvent) {
        node.textContent = time;
        rect = node.getBoundingClientRect();
        lastRight = Math.max(lastRight, rect.right);
        return;
      }
      node.remove();
    });
  }

  function render() {
    const now = Date.now();
    const date = new Date(now);
    get('today-date-title').textContent = `${date.getMonth() + 1}月${date.getDate()}日 周${'日一二三四五六'[date.getDay()]}`;
    const todos = window.NotchTodos ? window.NotchDomain.todayTodoItems(window.NotchTodos.items(), now) : [];
    const todayEvents = Timeline.eventsForDay(events, now);
    const focus = focusToday(now);
    const focusMinutes = Math.round(focus.reduce((sum, item) => sum + item.minutes, 0));
    get('today-date-summary').textContent = Timeline.summary({ dueCount: todos.length, eventCount: todayEvents.length, focusMinutes });

    const nowPercent = Timeline.axisPercent(now, now);
    line.replaceChildren();
    line.append(element('span', 'tl-track'));
    for (let hour = 9; hour <= 21; hour += 3) {
      const percent = Timeline.axisPercent(Timeline.dayBounds(now).start + hour * 3600000, now);
      if (nowPercent !== null && Math.abs(percent - nowPercent) < 4.5) continue;
      line.append(positioned(element('span', 'tl-hour', String(hour)), percent));
    }
    focus.forEach((item) => {
      const from = Timeline.axisPercent(Math.max(item.start, Timeline.dayBounds(now).start + Timeline.DAY_START_HOUR * 3600000), now);
      const to = Timeline.axisPercent(Math.min(item.end, now), now);
      if (from === null || to === null || to <= from) return;
      const segment = element('span', 'tl-focus');
      segment.style.left = `${from}%`;
      segment.style.width = `${Math.max(0.6, to - from)}%`;
      segment.title = `专注 ${item.minutes} 分钟 · ${Timeline.clock(item.start)}–${Timeline.clock(item.end)}`;
      line.append(segment);
    });

    const row = [];
    todayEvents.forEach((event) => {
      const percent = Timeline.axisPercent(event.start, now);
      if (percent === null) return;
      const time = Timeline.clock(event.start);
      const pill = element('button', `tl-event${event.start + event.durationMin * 60000 < now ? ' past' : ''}`, `${time} ${event.title}`);
      pill.type = 'button';
      pill.dataset.eventId = event.id;
      pill.title = `${time} ${event.title} · ${event.durationMin} 分钟 · 点击修改`;
      pill.setAttribute('aria-label', `${time} ${event.title}，${event.durationMin} 分钟，点击修改`);
      line.append(positioned(pill, percent));
      row.push({ node: pill, percent, isEvent: true, time });
    });
    todos.forEach((todo) => {
      const percent = Timeline.axisPercent(todo.due, now);
      if (percent === null) return;
      const mark = element('button', 'tl-deadline');
      mark.type = 'button';
      mark.dataset.todo = `${todo.priority}:${todo.id}`;
      mark.style.setProperty('--c', todo.overdue ? 'var(--sd-danger)' : CATEGORY_COLORS[todo.priority]);
      mark.setAttribute('aria-label', `${Timeline.clock(todo.due)} 截止：${todo.text}`);
      mark.title = `${Timeline.clock(todo.due)} ${todo.text}${todo.overdue ? ' · 已逾期' : ''}`;
      line.append(positioned(mark, percent));
      const label = element('span', `tl-label${todo.overdue ? ' overdue' : ''}`, `${Timeline.clock(todo.due)} ${todo.text}`);
      line.append(positioned(label, percent));
      row.push({ node: label, percent, isEvent: false });
    });
    completions.forEach((item) => {
      const percent = Timeline.axisPercent(item.completedAt, now);
      if (percent === null) return;
      const dot = element('span', 'tl-ai');
      dot.title = `${Timeline.clock(item.completedAt)} ${item.title || 'AI 任务完成'}`;
      positioned(dot, percent);
      line.append(dot);
    });
    later.forEach((item) => {
      const percent = Timeline.axisPercent(item.at, now);
      if (percent === null) return;
      const mark = element('button', 'tl-later', '⏰');
      mark.type = 'button';
      mark.dataset.laterId = item.id;
      mark.title = `${Timeline.clock(item.at)} ${item.note || '稍后提醒'} · 点击取消`;
      mark.setAttribute('aria-label', `${Timeline.clock(item.at)} 稍后提醒${item.note ? `：${item.note}` : ''}，点击取消`);
      positioned(mark, percent);
      line.append(mark);
    });
    resolveRow(row);
    if (nowPercent !== null) {
      const marker = positioned(element('span', 'tl-now'), nowPercent);
      marker.append(element('span', '', Timeline.clock(now)));
      line.append(marker);
    }
  }

  // ---------------- Event form ----------------
  const eventPop = get('event-pop');
  const laterPop = get('later-pop');
  const fields = {
    quick: get('event-quick'), title: get('event-title'), day: get('event-day'), time: get('event-time'),
    duration: get('event-duration'), remind: get('event-remind'), error: get('event-error'), remove: get('event-delete'),
  };

  const addEventButton = get('today-add-event');
  const addLaterButton = get('today-add-later');

  function syncExpanded() {
    addEventButton.setAttribute('aria-expanded', String(!eventPop.hidden));
    addLaterButton.setAttribute('aria-expanded', String(!laterPop.hidden));
  }

  function closePops() {
    eventPop.hidden = true;
    laterPop.hidden = true;
    syncExpanded();
  }

  function dayOffset(start) {
    const today = Timeline.dayBounds(Date.now()).start;
    return Math.max(0, Math.min(2, Math.floor((start - today) / 86400000)));
  }

  function selectValue(select, value) {
    const option = [...select.options].find((item) => Number(item.value) >= value) || select.options[select.options.length - 1];
    select.value = option.value;
  }

  function openEventForm(event = null) {
    closePops();
    editingEventId = event ? event.id : '';
    get('event-pop-title').textContent = event ? '修改日程' : '新建日程';
    fields.quick.value = '';
    fields.title.value = event ? event.title : '';
    const start = event ? event.start : Math.ceil((Date.now() + 15 * 60000) / (30 * 60000)) * 30 * 60000;
    fields.day.value = String(dayOffset(start));
    fields.time.value = Timeline.clock(start);
    selectValue(fields.duration, event ? event.durationMin : 30);
    selectValue(fields.remind, event ? event.remindMin : 10);
    fields.error.textContent = '';
    fields.remove.hidden = !event;
    eventPop.hidden = false;
    syncExpanded();
    (event ? fields.title : fields.quick).focus();
  }

  fields.quick.addEventListener('input', () => {
    const parsed = Timeline.parseEventInput(fields.quick.value);
    if (!parsed) return;
    fields.title.value = parsed.title;
    fields.day.value = String(dayOffset(parsed.start));
    fields.time.value = Timeline.clock(parsed.start);
    selectValue(fields.duration, parsed.durationMin);
    fields.error.textContent = '';
  });

  function saveEventForm() {
    const title = fields.title.value.trim();
    const [hour, minute] = String(fields.time.value || '').split(':').map(Number);
    if (!title) {
      fields.error.textContent = '写一下日程标题';
      fields.title.focus();
      return;
    }
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      fields.error.textContent = '选一个开始时间';
      fields.time.focus();
      return;
    }
    const today = new Date(Timeline.dayBounds(Date.now()).start);
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + Number(fields.day.value), hour, minute).getTime();
    const next = {
      id: editingEventId || uid('event'),
      title,
      start,
      durationMin: Number(fields.duration.value),
      remindMin: Number(fields.remind.value),
      remindedAt: 0,
    };
    events = Timeline.normalizeEvents([...events.filter((item) => item.id !== next.id), next]);
    closePops();
    saveEvents();
    toast(`${editingEventId ? '已更新' : '已添加'}「${title}」· ${Timeline.clock(start)}`);
  }

  get('event-save').addEventListener('click', saveEventForm);
  get('event-cancel').addEventListener('click', closePops);
  fields.remove.addEventListener('click', () => {
    const removed = events.find((item) => item.id === editingEventId);
    if (!removed) return;
    const before = events;
    events = events.filter((item) => item.id !== editingEventId);
    closePops();
    saveEvents();
    toast(`已删除「${removed.title}」`, {
      actionLabel: '撤销',
      duration: 5000,
      onAction: () => { events = before; saveEvents(); },
    });
  });
  eventPop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && event.target.tagName === 'INPUT') {
      event.preventDefault();
      saveEventForm();
    }
    if (event.key === 'Escape') {
      closePops();
      addEventButton.focus();
    }
  });

  // ---------------- Later form ----------------
  function openLaterForm() {
    closePops();
    get('later-note').value = '';
    laterPop.hidden = false;
    syncExpanded();
    get('later-note').focus();
  }

  laterPop.addEventListener('click', (event) => {
    const preset = event.target.closest('[data-later]')?.dataset.later;
    if (!preset) return;
    const at = Timeline.laterAt(preset);
    if (!at) return;
    const note = get('later-note').value.trim();
    later = Timeline.normalizeLater([...later, { id: uid('later'), note, at, createdAt: Date.now() }]);
    closePops();
    saveLater();
    toast(`将在 ${Timeline.clock(at)} 提醒${note ? `：${note}` : ''}`);
  });
  laterPop.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closePops();
      addLaterButton.focus();
    }
  });

  addEventButton.addEventListener('click', () => (eventPop.hidden ? openEventForm() : closePops()));
  addLaterButton.addEventListener('click', () => (laterPop.hidden ? openLaterForm() : closePops()));
  document.addEventListener('pointerdown', (event) => {
    if (!strip.contains(event.target)) closePops();
  });

  line.addEventListener('click', (event) => {
    const pill = event.target.closest('[data-event-id]');
    if (pill) {
      openEventForm(events.find((item) => item.id === pill.dataset.eventId) || null);
      return;
    }
    const deadline = event.target.closest('[data-todo]');
    if (deadline) {
      window.NotchTodos?.open();
      return;
    }
    const reminder = event.target.closest('[data-later-id]');
    if (reminder) {
      const removed = later.find((item) => item.id === reminder.dataset.laterId);
      const before = later;
      later = later.filter((item) => item.id !== reminder.dataset.laterId);
      saveLater();
      toast(`已取消 ${removed ? Timeline.clock(removed.at) : ''} 的提醒`, {
        actionLabel: '撤销',
        duration: 5000,
        onAction: () => { later = before; saveLater(); },
      });
    }
  });

  // A fired reminder: later entries are done, events are marked so they are not notified twice.
  function handleFired(payload) {
    const id = String(payload?.id || '');
    if (id.startsWith('later-')) {
      later = later.filter((item) => `later-${item.id}` !== id);
      writeJson(LATER_KEY, later);
    } else if (id.startsWith('event-')) {
      events = events.map((item) => (`event-${item.id}` === id ? { ...item, remindedAt: Number(payload.firedAt) || Date.now() } : item));
      writeJson(EVENTS_KEY, events);
    }
    render();
  }
  window.notchAPI?.onReminderFired?.(handleFired);

  async function loadCompletions() {
    const list = await window.notchAPI?.listTaskCompletions?.().catch(() => []);
    completions = (Array.isArray(list) ? list : [])
      .filter((item) => item && !NOT_AI_SOURCES.has(String(item.source || '').toLowerCase()) && Number.isFinite(Number(item.completedAt)))
      .map((item) => ({ title: String(item.title || ''), completedAt: Number(item.completedAt) }));
    render();
  }
  window.notchAPI?.onTaskCompletion?.(() => loadCompletions());

  // ---------------- Visibility setting ----------------
  const stripToggle = get('settings-today-strip');
  function applyStripVisibility() {
    const visible = readJson(STRIP_KEY, true) !== false;
    strip.hidden = !visible;
    document.getElementById('tab-home')?.classList.toggle('has-today-strip', visible);
    if (stripToggle) stripToggle.checked = visible;
  }
  stripToggle?.addEventListener('change', () => {
    writeJson(STRIP_KEY, stripToggle.checked);
    applyStripVisibility();
  });

  for (const eventName of ['notch:todos-changed', 'notch:focus-logged']) document.addEventListener(eventName, render);
  document.addEventListener('notch:modechange', (event) => {
    if (event.detail?.expanded) render();
    else closePops();
  });
  const timer = setInterval(render, 60000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });

  // Drop later reminders that are long gone (the app may have been closed at the time).
  later = later.filter((item) => item.at > Date.now() - 5 * 60000);
  writeJson(LATER_KEY, later);
  applyStripVisibility();
  render();
  scheduleReminders();
  loadCompletions();

  window.NotchTodayStrip = {
    render,
    handleFired,
    refreshCompletions: loadCompletions,
    events: () => events.map((item) => ({ ...item })),
    later: () => later.map((item) => ({ ...item })),
  };
})();
