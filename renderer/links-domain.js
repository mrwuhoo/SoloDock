// 链接页：剪贴板建议、搜索、图标首字母色块。纯函数，页面与 Node 测试共用。
(function exposeLinksDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchLinksDomain = api;
})(typeof window !== 'undefined' ? window : globalThis, function createLinksDomain() {
  const UNSORTED = '未分组';
  const SUGGEST_WINDOW_MS = 10 * 60 * 1000;
  const TONES = ['cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'ink'];

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (error) { return String(url || ''); }
  }

  // 列表里显示的网址：域名 + 路径，去掉协议和末尾斜杠。
  function displayUrl(url) {
    try {
      const parsed = new URL(url);
      const rest = `${parsed.pathname}${parsed.search}`.replace(/\/$/, '');
      return `${parsed.hostname.replace(/^www\./, '')}${rest}`;
    } catch (error) {
      return String(url || '');
    }
  }

  // 剪贴板文字里的第一个公开网址（只看开头那一段，不把整篇文章当成网址）。
  function pickClipboardUrl(text) {
    const raw = String(text || '').trim().slice(0, 2000);
    const match = raw.match(/https?:\/\/[^\s<>"'“”‘’，。；、）)】]+/i);
    if (!match) return '';
    return match[0].replace(/[.,!?:;]+$/, '');
  }

  // 只存哈希：剪贴板里看到过、忽略过的网址不以明文留在本机。
  function hashUrl(url) {
    let hash = 0x811c9dc5;
    for (const char of String(url || '')) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }

  // 面板打开时剪贴板里有网址：第一次看到后的 10 分钟内提示；已收藏、已忽略的不提示。
  function shouldSuggest(url, { saved = [], dismissed = [], seen = {}, now = Date.now() } = {}) {
    if (!url) return false;
    if (saved.includes(url)) return false;
    const key = hashUrl(url);
    if (dismissed.includes(key)) return false;
    const first = Object.prototype.hasOwnProperty.call(seen, key) ? Number(seen[key]) : now;
    return now - first <= SUGGEST_WINDOW_MS;
  }

  function linkMatches(link, query) {
    const tokens = String(query || '').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const haystack = `${link.title || ''}\n${link.url || ''}`.toLocaleLowerCase();
    return tokens.every((token) => haystack.includes(token));
  }

  // 没有图标时的首字母色块：中文取第一个字，英文取首字母大写；颜色按域名固定。
  function initialOf(link) {
    const title = String(link.title || '').trim();
    const source = title && title !== '未命名' ? title : hostOf(link.url);
    const first = Array.from(source)[0] || '?';
    return /[a-z]/i.test(first) ? first.toUpperCase() : first;
  }

  function toneOf(link) {
    const host = hostOf(link.url);
    let sum = 0;
    for (const char of host) sum = (sum * 31 + char.codePointAt(0)) >>> 0;
    return TONES[sum % TONES.length];
  }

  return { UNSORTED, SUGGEST_WINDOW_MS, hostOf, displayUrl, pickClipboardUrl, hashUrl, shouldSuggest, linkMatches, initialOf, toneOf };
});
