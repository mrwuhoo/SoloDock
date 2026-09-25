// 笔记库：分组（今天 / 本周 / 更早）、列表时间、摘要、搜索高亮、勾选任务框、编辑区 Markdown 标记弱化。
// 纯函数，页面与 Node 测试共用。
(function exposeNotesDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchNotesDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createNotesDomain() {
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const pad = (value) => String(value).padStart(2, '0');
  const clock = (time) => { const date = new Date(time); return `${pad(date.getHours())}:${pad(date.getMinutes())}`; };
  const startOfDay = (time) => { const date = new Date(Number(time)); return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(); };
  // 本周从周一算起。
  const startOfWeek = (time) => { const day = new Date(startOfDay(time)); return day.getTime() - ((day.getDay() + 6) % 7) * 86400000; };

  // 按更新时间分成「今天 / 本周 / 更早」；pinnedId（今日随笔）固定在「今天」第一条。
  function groupNotes(notes, now = Date.now(), pinnedId = '') {
    const today = startOfDay(now);
    const week = startOfWeek(now);
    const groups = [
      { id: 'today', label: '今天', items: [] },
      { id: 'week', label: '本周', items: [] },
      { id: 'earlier', label: '更早', items: [] },
    ];
    const sorted = [...(Array.isArray(notes) ? notes : [])].sort((left, right) => right.updatedAt - left.updatedAt);
    sorted.forEach((note) => {
      const at = Number(note.updatedAt) || 0;
      if (note.id === pinnedId || at >= today) groups[0].items.push(note);
      else if (at >= week) groups[1].items.push(note);
      else groups[2].items.push(note);
    });
    const pinned = groups[0].items.findIndex((note) => note.id === pinnedId);
    if (pinned > 0) groups[0].items.unshift(...groups[0].items.splice(pinned, 1));
    return groups.filter((group) => group.items.length);
  }

  // 列表右侧的时间：今天 14:32；本周 周二；今年 9/20；更早 2025/9/20。
  function listTime(time, now = Date.now()) {
    const at = Number(time);
    if (at >= startOfDay(now)) return clock(at);
    const date = new Date(at);
    if (at >= startOfWeek(now)) return WEEK[date.getDay()];
    return date.getFullYear() === new Date(Number(now)).getFullYear()
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }

  // 「今天 14:32」「昨天 09:10」「9月20日 18:00」。
  function updatedLabel(time, now = Date.now()) {
    const at = Number(time);
    const days = Math.round((startOfDay(now) - startOfDay(at)) / 86400000);
    const date = new Date(at);
    const day = days === 0 ? '今天' : days === 1 ? '昨天' : `${date.getMonth() + 1}月${date.getDate()}日`;
    return `${day} ${clock(at)}`;
  }

  function plainLine(line) {
    return String(line || '')
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_~`]/g, '')
      .trim();
  }

  function excerpt(content, limit = 90) {
    const lines = String(content || '').split(/\r?\n/).map(plainLine).filter(Boolean);
    return Array.from(lines.join(' · ')).slice(0, limit).join('');
  }

  // 标题为空时用首行（去掉 Markdown 标记）。
  function firstLineTitle(content) {
    const line = String(content || '').split(/\r?\n/).map(plainLine).find(Boolean) || '';
    return Array.from(line).slice(0, 40).join('');
  }

  function wordCount(content) {
    return Array.from(String(content || '').replace(/\s+/g, '')).length;
  }

  // 搜索命中高亮：把文字切成 { text, hit } 片段，每个关键词都标出来（不区分大小写）。
  function highlight(text, query) {
    const source = String(text || '');
    const tokens = String(query || '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!tokens.length || !source) return [{ text: source, hit: false }];
    const lower = source.toLocaleLowerCase();
    const marks = new Array(source.length).fill(false);
    tokens.forEach((token) => {
      let from = 0;
      while (from <= lower.length) {
        const index = lower.indexOf(token, from);
        if (index < 0) break;
        for (let offset = 0; offset < token.length; offset += 1) marks[index + offset] = true;
        from = index + token.length;
      }
    });
    const parts = [];
    for (let index = 0; index < source.length; index += 1) {
      const last = parts[parts.length - 1];
      if (last && last.hit === marks[index]) last.text += source[index];
      else parts.push({ text: source[index], hit: marks[index] });
    }
    return parts;
  }

  // 预览里勾选任务框：把第 line 行的 [ ] / [x] 翻过来，其余原样。
  function toggleTask(content, line) {
    const lines = String(content || '').split('\n');
    const index = Number(line);
    const match = Number.isInteger(index) ? /^(\s*[-*+]\s+\[)([ xX])(\]\s+.*)$/.exec(lines[index] || '') : null;
    if (!match) return String(content || '');
    lines[index] = `${match[1]}${match[2] === ' ' ? 'x' : ' '}${match[3]}`;
    return lines.join('\n');
  }

  // 编辑区里弱化的 Markdown 标记：返回 { text, mark } 片段（逐行处理，保留换行）。
  function markdownMarks(content) {
    const parts = [];
    const push = (text, mark) => {
      if (!text) return;
      const last = parts[parts.length - 1];
      if (last && last.mark === mark) last.text += text;
      else parts.push({ text, mark });
    };
    const inline = (text) => {
      const pattern = /(\*\*|__|~~|`)|(\[)([^\]\n]*)(\]\([^)\n]*\))|(^|[^*])(\*)(?=[^*\s])/g;
      let cursor = 0;
      let match;
      while ((match = pattern.exec(text))) {
        if (match[1]) {
          push(text.slice(cursor, match.index), false);
          push(match[1], true);
          cursor = match.index + match[1].length;
        } else if (match[2]) {
          push(text.slice(cursor, match.index), false);
          push('[', true);
          push(match[3], false);
          push(match[4], true);
          cursor = match.index + match[0].length;
        } else if (match[6]) {
          const at = match.index + match[5].length;
          push(text.slice(cursor, at), false);
          push('*', true);
          cursor = at + 1;
        }
      }
      push(text.slice(cursor), false);
    };
    String(content || '').split('\n').forEach((line, index, lines) => {
      const prefix = /^(\s{0,3}#{1,6}\s+|\s*[-*+]\s+\[[ xX]\]\s+|\s*(?:[-*+]|\d+[.)])\s+|\s*>\s?)/.exec(line);
      if (prefix) {
        push(prefix[0], true);
        inline(line.slice(prefix[0].length));
      } else if (/^\s*(`{3,}|~{3,})/.test(line)) {
        push(line, true);
      } else {
        inline(line);
      }
      if (index < lines.length - 1) push('\n', false);
    });
    return parts;
  }

  function dailyTitle(time) {
    const date = new Date(Number(time));
    return `${date.getMonth() + 1}月${date.getDate()}日 随笔`;
  }

  function dayKey(time) {
    const date = new Date(Number(time));
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  // 导出文件名：去掉系统不允许的字符。
  function exportName(title) {
    const clean = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
    return Array.from(clean).slice(0, 60).join('') || '笔记';
  }

  return { groupNotes, listTime, updatedLabel, excerpt, firstLineTitle, wordCount, highlight, toggleTask, markdownMarks, dailyTitle, dayKey, exportName };
});
