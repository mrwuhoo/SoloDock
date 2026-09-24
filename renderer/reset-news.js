(() => {
  const get = (id) => document.getElementById(id);
  const panel = get('tab-resets');
  if (!panel) return;

  let events = [];
  let today = '';
  let selectedDay = '';
  let month = '';
  let loaded = false;
  let pending = false;
  const sourceUrl = 'https://aihot.news/codex-reset';
  const node = (tag, content, className) => {
    const element = document.createElement(tag);
    if (content !== undefined) element.textContent = content;
    if (className) element.className = className;
    return element;
  };
  const safeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : '';
  const dayTitle = (day) => day ? `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日` : '选择日期';
  const monthTitle = (value) => value ? `${value.slice(0, 4)} 年 ${Number(value.slice(5, 7))} 月` : '重置日历';
  const countLabel = (items) => {
    const confirmed = items.filter((item) => item.status === 'confirmed').length;
    const planned = items.length - confirmed;
    return `${confirmed} 条已确认 · ${planned} 条预告`;
  };

  function renderDetails() {
    get('reset-news-selected-date').textContent = dayTitle(selectedDay);
    const holder = get('reset-news-events');
    holder.replaceChildren();
    const items = events.filter((item) => item.day === selectedDay);
    if (!items.length) {
      holder.append(node('p', '这一天还没有重置记录或公开预告。', 'reset-news-empty'));
      return;
    }
    for (const item of items) {
      const card = node('article', undefined, 'reset-news-event');
      const state = node('span', item.status === 'confirmed' ? '✓ 已确认' : '◌ 预告 · 待核实', `reset-news-badge ${item.status}`);
      card.append(state, node('h3', item.title || item.label || '重置动态'));
      if (item.scope) card.append(node('p', `适用范围：${item.scope}`, 'reset-news-event-meta'));
      if (item.schedule) card.append(node('p', item.schedule, 'reset-news-event-meta'));
      for (const post of item.posts || []) {
        if (post.text) card.append(node('p', post.text, 'reset-news-quote'));
        if (post.url) {
          const link = node('button', '在 X 查看原帖 ↗', 'usage-text-button reset-news-link');
          link.type = 'button';
          link.addEventListener('click', () => window.notchAPI?.openExternal?.(post.url).catch(() => {}));
          card.append(link);
        }
      }
      holder.append(card);
    }
  }

  function select(day) {
    selectedDay = safeDate(day);
    month = selectedDay.slice(0, 7) || month;
    renderCalendar();
    renderDetails();
  }

  function renderCalendar() {
    if (!month) return;
    get('reset-news-month').textContent = monthTitle(month);
    const holder = get('reset-news-calendar');
    holder.replaceChildren();
    const [year, index] = month.split('-').map(Number);
    const first = new Date(Date.UTC(year, index - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, index, 0)).getUTCDate();
    const rows = Math.ceil((offset + daysInMonth) / 7);
    holder.style.setProperty('--reset-calendar-rows', String(rows));
    const byDay = new Map();
    for (const item of events) {
      const list = byDay.get(item.day) || [];
      list.push(item);
      byDay.set(item.day, list);
    }
    for (let cell = 0; cell < rows * 7; cell += 1) {
      const date = new Date(Date.UTC(year, index - 1, cell - offset + 1));
      const day = date.toISOString().slice(0, 10);
      const inMonth = date.getUTCMonth() === index - 1;
      const items = byDay.get(day) || [];
      const button = node('button', undefined, 'reset-news-day');
      button.type = 'button';
      button.setAttribute('role', 'gridcell');
      button.dataset.day = day;
      button.setAttribute('aria-label', `${dayTitle(day)}，${countLabel(items)}`);
      button.setAttribute('aria-selected', String(day === selectedDay));
      if (!inMonth) button.classList.add('outside');
      if (day === today) button.classList.add('today');
      button.append(node('strong', String(date.getUTCDate())));
      if (items.length) {
        const confirmed = items.some((item) => item.status === 'confirmed');
        button.append(node('span', confirmed ? '已确认' : '预告', `reset-news-day-label ${confirmed ? 'confirmed' : 'announced'}`));
      }
      button.addEventListener('click', () => select(day));
      holder.append(button);
    }
    const thisMonth = events.filter((item) => item.day.startsWith(month));
    get('reset-news-summary').textContent = `本月：${countLabel(thisMonth)} · 点击日期查看详情`;
  }

  function shiftMonth(delta) {
    const [year, index] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, index - 1 + delta, 1));
    month = date.toISOString().slice(0, 7);
    renderCalendar();
  }

  async function load(force = false) {
    if (pending || !window.notchAPI?.getResetNews) return;
    pending = true;
    get('reset-news-status').textContent = '正在读取公开动态…';
    get('reset-news-refresh').disabled = true;
    try {
      const result = await window.notchAPI.getResetNews(force);
      if (!result?.ok) throw new Error(result?.error || 'read_failed');
      events = Array.isArray(result.events) ? result.events : [];
      today = safeDate(result.today);
      const latest = [...events].sort((a, b) => b.day.localeCompare(a.day))[0]?.day;
      if (!selectedDay) selectedDay = latest || today || new Date().toISOString().slice(0, 10);
      month = selectedDay.slice(0, 7);
      loaded = true;
      get('reset-news-status').textContent = result.stale ? '当前展示上次读取的记录；网络暂不可用。' : '公开资讯，仅供参考；预告不等于实际发放。';
      get('reset-news-updated').textContent = result.checkedAt ? `AIHOT 最近采集：${result.checkedAt.replace('T', ' ').slice(0, 16)}（北京时间）` : '数据来源：AIHOT';
      renderCalendar();
      renderDetails();
    } catch {
      get('reset-news-status').textContent = '读取失败。请检查网络，稍后点击刷新。';
      if (!loaded) {
        selectedDay = today || new Date().toISOString().slice(0, 10);
        month = selectedDay.slice(0, 7);
        renderCalendar();
        renderDetails();
      }
    } finally {
      pending = false;
      get('reset-news-refresh').disabled = false;
    }
  }

  get('reset-news-prev').addEventListener('click', () => shiftMonth(-1));
  get('reset-news-next').addEventListener('click', () => shiftMonth(1));
  get('reset-news-today').addEventListener('click', () => select([...events].sort((a, b) => b.day.localeCompare(a.day))[0]?.day || today || selectedDay));
  get('reset-news-refresh').addEventListener('click', () => load(true));
  get('reset-news-open-source').addEventListener('click', () => window.notchAPI?.openExternal?.(sourceUrl).catch(() => {}));
  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'resets' && !loaded) load();
  });
})();
