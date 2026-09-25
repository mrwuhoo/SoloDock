// ⌘K 搜索：在记下的东西里一处搜索。纯函数，页面与 Node 测试共用。
// 条目：{ type, id, title, subtitle, keywords, at }。密钥只带名称、账号与网址，从不带密码。
(function exposeSearchDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchSearch = api;
})(typeof window !== 'undefined' ? window : globalThis, function createSearchDomain() {
  const TYPES = [
    { id: 'todo', label: '待办' },
    { id: 'note', label: '笔记' },
    { id: 'prompt', label: '提示词' },
    { id: 'link', label: '链接' },
    { id: 'clip', label: '剪贴板' },
    { id: 'credential', label: '密钥' },
  ];
  const GROUP_LIMIT = 5;
  const FILTERED_LIMIT = 40;

  const lower = (value) => String(value == null ? '' : value).toLocaleLowerCase();

  // 每个关键词都要命中；标题开头命中最靠前，其次标题包含，再次说明或关键词包含。
  function scoreItem(item, tokens) {
    const title = lower(item.title);
    const rest = `${lower(item.subtitle)}\n${lower(item.keywords)}`;
    let score = 0;
    for (const token of tokens) {
      if (title.startsWith(token)) score += 30;
      else if (title.includes(token)) score += 20;
      else if (rest.includes(token)) score += 8;
      else return 0;
    }
    return score;
  }

  function searchItems(items, query, options = {}) {
    const tokens = lower(query).trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const filter = options.filter && options.filter !== 'all' ? options.filter : '';
    const limit = filter ? FILTERED_LIMIT : GROUP_LIMIT;
    const scored = (Array.isArray(items) ? items : [])
      .filter((item) => item && (!filter || item.type === filter))
      .map((item) => ({ item, score: scoreItem(item, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || (Number(right.item.at) || 0) - (Number(left.item.at) || 0));
    return TYPES
      .map((type) => {
        const matches = scored.filter((entry) => entry.item.type === type.id).map((entry) => entry.item);
        return { type: type.id, label: type.label, total: matches.length, items: matches.slice(0, limit) };
      })
      .filter((group) => group.total > 0);
  }

  // Tab 在「全部 → 待办 → 笔记 → … → 密钥」之间循环。
  function nextFilter(current, direction = 1) {
    const order = ['all', ...TYPES.map((type) => type.id)];
    const index = Math.max(0, order.indexOf(current));
    return order[(index + direction + order.length) % order.length];
  }

  // 最近使用：同一条只留最新一次，最多 8 条。
  function rememberRecent(recent, item) {
    const key = `${item.type}:${item.id}`;
    const entry = { type: item.type, id: item.id, title: String(item.title || '').slice(0, 80), subtitle: String(item.subtitle || '').slice(0, 80), at: Date.now() };
    return [entry, ...(Array.isArray(recent) ? recent : []).filter((existing) => `${existing.type}:${existing.id}` !== key)].slice(0, 8);
  }

  function typeLabel(type) {
    return (TYPES.find((item) => item.id === type) || { label: '' }).label;
  }

  return { TYPES, GROUP_LIMIT, searchItems, nextFilter, rememberRecent, typeLabel };
});
