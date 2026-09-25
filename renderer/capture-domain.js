// 随手记：在任何应用里按快捷键记一条，自动判断是随笔、待办、链接还是生活记录。纯函数，随手记窗口、面板与 Node 测试共用。
// 判断顺序：有网址 → 链接；以「记得 / 提醒我 / 待办」开头或带日期时间 → 待办；命中习惯且不是未来 → 生活；其余 → 随笔。
(function exposeCaptureDomain(root, factory) {
  const life = root && root.NotchLife ? root.NotchLife : (typeof require === 'function' ? require('./life-domain') : null);
  const api = factory(life);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchCapture = api;
})(typeof window !== 'undefined' ? window : globalThis, function createCaptureDomain(Life) {
  const TYPES = [
    { id: 'note', label: '随笔' },
    { id: 'todo', label: '待办' },
    { id: 'link', label: '链接' },
    { id: 'life', label: '生活' },
  ];
  // 待办分类可增减（最多 6 个）；没有给出分类列表时按原来的四类。
  const CATEGORIES = ['P0', 'P1', 'P2', 'P3'];
  const categoryIds = (options) => (Array.isArray(options.categories) && options.categories.length ? options.categories : CATEGORIES);
  const MAX_TEXT = 4000;
  const DETECT_LIMIT = 80;
  const DAY_BOUNDARY_HOUR = 4;
  const HOUR = 3600000;

  const pad = (value) => String(value).padStart(2, '0');
  const clean = (value, limit) => Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim()).slice(0, limit).join('');
  const clock = (time) => { const date = new Date(time); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };

  // 中文数字（到 99）：三 → 3，十二 → 12，二十五 → 25，两 → 2。
  const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  function toNumber(text) {
    const value = String(text || '');
    if (/^\d+$/.test(value)) return Number(value);
    if (!/^[零〇一二两三四五六七八九十]{1,3}$/.test(value)) return NaN;
    const ten = value.indexOf('十');
    if (ten < 0) return value.length === 1 ? CN[value] : NaN;
    const head = value.slice(0, ten);
    const tail = value.slice(ten + 1);
    if (head.length > 1 || tail.length > 1 || value.indexOf('十', ten + 1) >= 0) return NaN;
    const tens = head ? CN[head] : 1;
    const ones = tail ? CN[tail] : 0;
    return tens === undefined || ones === undefined ? NaN : tens * 10 + ones;
  }

  const NUM = '(\\d{1,2}|[零〇一二两三四五六七八九十]{1,3})';
  const PERIOD = '(上午|早上|早晨|清晨|中午|下午|傍晚|晚上|夜里|凌晨)';
  const WEEK = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
  // 被取走的日期、时间用 \u0000 占位，方便去掉紧跟着的「前 / 之前 / 的」，又不误伤「前端」这类词。
  const MARK = '\u0000';

  function dayOf(base, offset) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    return { y: date.getFullYear(), m: date.getMonth(), d: date.getDate(), offset };
  }

  function offsetOf(base, y, m, d) {
    const target = new Date(y, m, d).getTime();
    const today = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
    return Math.round((target - today) / 86400000);
  }

  function withPeriod(hour, period) {
    if (/下午|傍晚|晚上|夜里|evening/.test(period) && hour < 12) return hour + 12;
    if (period === '中午' && hour < 11) return hour + 12;
    if (period === '凌晨' && hour === 12) return 0;
    return hour;
  }

  // 从一句话里找日期与时间。返回 { at, hasTime, offset, rest }；没有就是 at: null。
  // 只有时间且已经过了 → 明天；只有日期 → 当天 23:30（与待办默认截止一致）；「3 点」这种不写上下午的 1–7 点按下午算。
  function parseWhen(text, now = Date.now()) {
    const base = new Date(Number(now));
    let rest = ` ${String(text || '')} `;
    let date = null;
    let time = null;
    let period = '';
    let relative = null;
    // 只有「今天 / 今晚」没有时间时算含糊：「今天好累」是随笔，不是待办。
    let vague = false;
    const take = (match) => { rest = rest.replace(match[0], ` ${MARK} `); };

    const after = rest.match(new RegExp(`(半|\\d{1,3}|[零〇一二两三四五六七八九十]{1,3})\\s*个?\\s*(分钟|小时|钟头|天)\\s*(?:以后|之后|后)`));
    if (after) {
      const amount = after[1] === '半' ? 0.5 : toNumber(after[1]);
      if (Number.isFinite(amount) && amount > 0) {
        if (after[2] === '天') date = dayOf(base, Math.round(amount));
        else relative = Number(now) + Math.round(amount * (after[2] === '分钟' ? 60000 : HOUR));
        take(after);
      }
    }

    if (!date && !relative) {
      const named = [
        [/大后天/, 3, ''], [/后天/, 2, ''], [/明早|明晨/, 1, 'morning'], [/明晚/, 1, 'evening'], [/明(?:天|日|儿)/, 1, ''],
        [/今早/, 0, 'morning'], [/今晚/, 0, 'evening'], [/今(?:天|日|儿)/, 0, ''], [/前天/, -2, ''], [/昨(?:天|日|晚)/, -1, ''],
      ];
      for (const [pattern, offset, hint] of named) {
        const hit = rest.match(pattern);
        if (!hit) continue;
        date = dayOf(base, offset);
        period = hint;
        vague = offset === 0;
        take(hit);
        break;
      }
    }

    if (!date && !relative) {
      const weekend = rest.match(/(下个?)?周末/);
      const week = rest.match(/(下下个?|下个?|这个?|本)?\s*(?:周|星期|礼拜)([一二三四五六日天])/);
      if (week || weekend) {
        const prefix = (week ? week[1] : weekend[1]) || '';
        const target = week ? WEEK[week[2]] : 6;
        let offset = ((target + 6) % 7) - ((base.getDay() + 6) % 7);
        if (prefix.startsWith('下下')) offset += 14;
        else if (prefix.startsWith('下')) offset += 7;
        else if (!prefix && offset < 0) offset += 7;
        date = dayOf(base, offset);
        take(week || weekend);
      }
    }

    if (!date && !relative) {
      const monthDay = rest.match(new RegExp(`${NUM}\\s*月\\s*${NUM}\\s*[日号]?`));
      const slash = rest.match(/(?<![\d/.])(\d{1,2})\/(\d{1,2})(?![\d/])/);
      const dayOnly = rest.match(new RegExp(`${NUM}\\s*[日号](?!\\d)`));
      const hit = monthDay || slash;
      if (hit) {
        const month = toNumber(hit[1]) - 1;
        const day = toNumber(hit[2]);
        if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
          let year = base.getFullYear();
          if (offsetOf(base, year, month, day) < 0) year += 1;
          const check = new Date(year, month, day);
          if (check.getMonth() === month) {
            date = { y: year, m: month, d: day, offset: offsetOf(base, year, month, day) };
            take(hit);
          }
        }
      } else if (dayOnly) {
        const day = toNumber(dayOnly[1]);
        if (day >= 1 && day <= 31) {
          let month = base.getMonth();
          let year = base.getFullYear();
          if (day < base.getDate()) { month += 1; if (month > 11) { month = 0; year += 1; } }
          const check = new Date(year, month, day);
          if (check.getDate() === day) {
            date = { y: year, m: month, d: day, offset: offsetOf(base, year, month, day) };
            take(dayOnly);
          }
        }
      }
    }

    if (!relative) {
      const colon = rest.match(new RegExp(`${PERIOD}?\\s*(\\d{1,2})[:：](\\d{2})(?!\\d)`));
      const dian = rest.match(new RegExp(`${PERIOD}?\\s*${NUM}\\s*点\\s*(半|一刻|三刻|钟|整|${NUM}\\s*分?)?`));
      const ampm = rest.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?![a-z])/i);
      if (colon) {
        time = { h: Number(colon[2]), mi: Number(colon[3]) };
        period = colon[1] || period;
        take(colon);
      } else if (dian) {
        const hour = toNumber(dian[2]);
        // 「快一点」「早一点」里的「一点」不是时间：没有上下午或日期时不认。
        const ambiguous = dian[2] === '一' && !dian[1] && !date && !period;
        const tail = dian[3] || '';
        const minute = tail === '半' ? 30 : tail === '一刻' ? 15 : tail === '三刻' ? 45 : dian[4] ? toNumber(dian[4]) : 0;
        if (!ambiguous && Number.isFinite(hour) && Number.isFinite(minute)) {
          time = { h: hour, mi: minute };
          period = dian[1] || period;
          take(dian);
        }
      } else if (ampm) {
        let hour = Number(ampm[1]);
        if (/pm/i.test(ampm[3]) && hour < 12) hour += 12;
        if (/am/i.test(ampm[3]) && hour === 12) hour = 0;
        time = { h: hour, mi: Number(ampm[2] || 0) };
        period = 'explicit';
        take(ampm);
      }
      if (time) {
        if (period && period !== 'explicit') time.h = withPeriod(time.h, period);
        else if (!period && time.h >= 1 && time.h <= 7) time.h += 12;
        if (time.h > 23 || time.mi > 59) time = null;
      }
    }

    rest = rest
      .replace(new RegExp(`${MARK}\\s*(?:之前|以前|前|的)`, 'g'), ' ')
      .replace(new RegExp(MARK, 'g'), ' ');
    const cleaned = clean(rest.replace(/^[\s,，、:：;；]+|[\s,，、;；]+$/g, ''), MAX_TEXT);

    if (relative) {
      const target = new Date(relative);
      return { at: relative, hasTime: true, vague: false, offset: offsetOf(base, target.getFullYear(), target.getMonth(), target.getDate()), rest: cleaned };
    }
    if (!date && !time) return { at: null, hasTime: false, vague: false, offset: null, rest: cleaned };
    const day = date || dayOf(base, 0);
    if (!time) return { at: new Date(day.y, day.m, day.d, 23, 30).getTime(), hasTime: false, vague, offset: day.offset, rest: cleaned };
    let at = new Date(day.y, day.m, day.d, time.h, time.mi).getTime();
    let offset = day.offset;
    if (!date && at <= Number(now)) { at = new Date(day.y, day.m, day.d + 1, time.h, time.mi).getTime(); offset = 1; }
    return { at, hasTime: true, vague: false, offset, rest: cleaned };
  }

  const URL_PATTERN = /https?:\/\/[^\s<>"'“”‘’，。；、）)】]+/i;
  const BARE_DOMAIN = /^(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|cn|net|org|io|ai|dev|app|co|me|so|xyz|cc|tv|info|top|site|tech|design|link|gg|fm|im|ly|to|sh)(?:[/?#]\S*)?$/i;

  function findUrl(text) {
    const raw = String(text || '').trim();
    const hit = raw.match(URL_PATTERN);
    if (hit) {
      const url = hit[0].replace(/[.,!?:;]+$/, '');
      return { url, title: clean(raw.replace(hit[0], ' '), 80) };
    }
    if (!/\s/.test(raw) && BARE_DOMAIN.test(raw)) return { url: `https://${raw}`, title: '' };
    return null;
  }

  const TODO_MARKER = /^\s*(?:待办|todo|任务|提醒我|记得|别忘了|别忘|-\s*\[\s?\])\s*[:：]?\s*/i;
  const DURATION = /(\d{1,3})\s*(分钟|min|m)(?![a-z])|(\d(?:\.\d)?)\s*(小时|h)(?![a-z])/i;

  function lifeHit(text, habits) {
    if (!Life || !habits.length) return null;
    try { return Life.parseLifeInput(text, { habits }); } catch (error) { return null; }
  }

  function availableTypes(link, habits) {
    return TYPES.map((type) => type.id).filter((id) => (id === 'link' ? Boolean(link) : id === 'life' ? habits.length > 0 : true));
  }

  // options: { now, type（Tab 选的类型，不可用时回到自动判断）, category, habits, habitId }
  function parseCapture(text, options = {}) {
    const now = Number(options.now) || Date.now();
    const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT);
    const habits = Array.isArray(options.habits) ? options.habits.filter((habit) => habit && habit.id) : [];
    const marker = raw.match(TODO_MARKER);
    const body = marker ? raw.slice(marker[0].length).trim() : raw;
    const link = findUrl(body);
    // 多行或很长的内容只当随笔判断，免得正文里的「3 点」把它变成待办。
    const short = !/\n/.test(body) && Array.from(body).length <= DETECT_LIMIT;
    const when = short || marker ? parseWhen(body, now) : { at: null, hasTime: false, vague: false, offset: null, rest: body };
    const hit = short ? lifeHit(body, habits) : null;

    let detected = 'note';
    if (link) detected = 'link';
    else if (marker) detected = 'todo';
    else if (hit && !when.hasTime && (when.offset === null || when.offset <= 0)) detected = 'life';
    else if (when.at && !when.vague && when.offset >= 0) detected = 'todo';

    const types = availableTypes(link, habits);
    const type = types.includes(options.type) ? options.type : detected;
    const result = { type, detected, types, raw, valid: Boolean(raw) };

    if (type === 'todo') {
      // 没写日期：今天 23:30；已经过了 23:30 就算明天的。
      let at = when.at;
      if (!at) {
        const today = new Date(now);
        at = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 30).getTime();
        if (at <= now) at = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 23, 30).getTime();
      }
      const todoText = clean((when.at ? when.rest : body).replace(TODO_MARKER, ''), 200);
      return {
        ...result,
        text: todoText,
        valid: Boolean(todoText),
        deadline: new Date(at).toISOString(),
        at,
        hasTime: Boolean(when.at && when.hasTime),
        category: categoryIds(options).includes(options.category) ? options.category : categoryIds(options).at(-1),
      };
    }
    if (type === 'link') {
      return { ...result, url: link.url, title: link.title, text: link.title };
    }
    if (type === 'life') {
      const chosen = habits.find((habit) => habit.id === options.habitId);
      const auto = hit && (!chosen || chosen.id === hit.habitId) ? hit : null;
      const habit = chosen || habits.find((item) => item.id === (hit && hit.habitId)) || habits[0];
      const source = when.offset !== null && when.offset < 0 ? when.rest : body;
      let minutes = auto ? auto.minutes : 0;
      let note = auto ? auto.note : '';
      if (!auto) {
        const duration = source.match(DURATION);
        minutes = duration ? (duration[1] ? Number(duration[1]) : Math.round(Number(duration[3]) * 60)) : 0;
        note = clean(source.replace(duration ? duration[0] : '', ' ').replace(habit.name, ' '), 60);
      } else if (when.offset !== null && when.offset < 0) {
        note = clean(note.replace(/昨(?:天|日|晚)|前天/g, ' '), 60);
      }
      const at = when.offset !== null && when.offset < 0
        ? new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() + when.offset, 20).getTime()
        : now;
      return { ...result, habitId: habit.id, item: auto ? auto.item : '', minutes, note, at, text: note };
    }
    return { ...result, type: 'note', text: raw };
  }

  function nextType(current, types, direction = 1) {
    const list = Array.isArray(types) && types.length ? types : ['note'];
    const index = Math.max(0, list.indexOf(current));
    return list[(index + direction + list.length) % list.length];
  }

  // 待办默认分到最近一次新建待办所在的分类；还没有待办时放最后一个分类（默认是「日常」）。
  function lastUsedCategory(data, ids) {
    const list = Array.isArray(ids) && ids.length ? ids : CATEGORIES;
    let best = null;
    for (const category of list) {
      for (const item of (data && Array.isArray(data[category]) ? data[category] : [])) {
        const created = Number(item && item.createdAt) || 0;
        if (!best || created > best.created) best = { category, created };
      }
    }
    return best ? best.category : list.at(-1);
  }

  function dayLabel(at, now = Date.now()) {
    const date = new Date(at);
    const offset = offsetOf(new Date(Number(now)), date.getFullYear(), date.getMonth(), date.getDate());
    const names = { '-2': '前天', '-1': '昨天', 0: '今天', 1: '明天', 2: '后天' };
    const weekNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return names[offset] || (offset > 2 && offset < 7 ? weekNames[date.getDay()] : `${date.getMonth() + 1}月${date.getDate()}日`);
  }

  function formatDue(at, now = Date.now()) {
    return `${Number(at) < Number(now) ? '已过 · ' : ''}${dayLabel(at, now)} ${clock(at)}`;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return ''; }
  }

  // 随手记窗口底部那一行：存到哪里、截止什么时候。
  function describe(result, context = {}) {
    if (!result || !result.valid) {
      if (result && result.type === 'todo' && result.raw) return '写上要做什么';
      return '';
    }
    const now = Number(context.now) || Date.now();
    if (result.type === 'todo') {
      const names = context.categoryNames || {};
      return `${names[result.category] || result.category} · ${formatDue(result.at, now)}`;
    }
    if (result.type === 'link') return [hostOf(result.url), result.title].filter(Boolean).join(' · ');
    if (result.type === 'life') {
      const habit = (context.habits || []).find((item) => item.id === result.habitId);
      const day = result.at < now - 12 * HOUR ? dayLabel(result.at, now) : '';
      return [habit ? habit.name : '', result.item, result.minutes ? `${result.minutes} 分钟` : '', result.note, day].filter(Boolean).join(' · ');
    }
    return `存进今天的随手记 · ${clock(now)}`;
  }

  // 存好后刘海下沿闪一下的那句话（要短，刘海只有 200 宽）。
  function confirmation(result, context = {}) {
    if (!result) return '';
    if (result.type === 'todo') return `已加待办 · ${formatDue(result.at, Number(context.now) || Date.now()).replace('已过 · ', '')}`;
    if (result.type === 'link') return '已收藏链接';
    if (result.type === 'life') {
      const habit = (context.habits || []).find((item) => item.id === result.habitId);
      return `已记一笔 · ${habit ? habit.name : '生活'}`;
    }
    return '已存入随手记';
  }

  // 随笔存进「今天的随手记」这条笔记，一天一条（凌晨 4 点前算前一天），每条前面带时间。
  function captureDayKey(at) {
    const date = new Date(Number(at) - DAY_BOUNDARY_HOUR * HOUR);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function captureNoteTitle(at) {
    const [, month, day] = captureDayKey(at).split('-').map(Number);
    return `随手记 · ${month}月${day}日`;
  }

  function appendCaptureLine(content, text, at) {
    const lines = String(text || '').trim().split('\n');
    const entry = [`- ${clock(at)} ${lines[0]}`, ...lines.slice(1).map((line) => `  ${line}`)].join('\n');
    const existing = String(content || '').replace(/\s+$/, '');
    return existing ? `${existing}\n${entry}` : entry;
  }

  // Alt+Shift+N → ⌥⇧N（按 macOS 习惯的 ⌃⌥⇧⌘ 顺序）。
  function shortcutLabel(accelerator) {
    const parts = String(accelerator || '').split('+').filter(Boolean);
    if (!parts.length) return '';
    const key = parts.pop();
    const order = [['Control', '⌃'], ['Alt', '⌥'], ['Option', '⌥'], ['Shift', '⇧'], ['Command', '⌘'], ['CommandOrControl', '⌘']];
    const mods = order.filter(([name]) => parts.includes(name)).map(([, glyph]) => glyph);
    const keys = { Space: '空格', Enter: '↩', Tab: '⇥', Escape: 'esc', Backspace: '⌫', Delete: '⌦', Left: '←', Right: '→', Up: '↑', Down: '↓' };
    return `${[...new Set(mods)].join('')}${keys[key] || key}`;
  }

  function typeLabel(type) {
    return (TYPES.find((item) => item.id === type) || TYPES[0]).label;
  }

  return {
    TYPES,
    CATEGORIES,
    MAX_TEXT,
    toNumber,
    parseWhen,
    findUrl,
    parseCapture,
    nextType,
    lastUsedCategory,
    dayLabel,
    formatDue,
    describe,
    confirmation,
    captureDayKey,
    captureNoteTitle,
    appendCaptureLine,
    shortcutLabel,
    typeLabel,
  };
});
