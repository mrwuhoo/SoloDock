const test = require('node:test');
const assert = require('node:assert/strict');
const links = require('../renderer/links-domain');

test('the clipboard suggestion picks the first web address and only for ten minutes', () => {
  assert.equal(links.pickClipboardUrl('看看 https://github.com/hovancik/stretchly。'), 'https://github.com/hovancik/stretchly');
  assert.equal(links.pickClipboardUrl('没有网址'), '');
  assert.equal(links.pickClipboardUrl('ftp://a.com'), '');
  const url = 'https://github.com/hovancik/stretchly';
  const key = links.hashUrl(url);
  assert.equal(links.shouldSuggest(url, { now: 1000 }), true, 'first time seen');
  assert.equal(links.shouldSuggest(url, { seen: { [key]: 0 }, now: 9 * 60 * 1000 }), true);
  assert.equal(links.shouldSuggest(url, { seen: { [key]: 0 }, now: 11 * 60 * 1000 }), false, 'older than ten minutes');
  assert.equal(links.shouldSuggest(url, { dismissed: [key], now: 1000 }), false, 'ignored once, never again');
  assert.equal(links.shouldSuggest(url, { saved: [url], now: 1000 }), false, 'already saved');
  assert.notEqual(links.hashUrl(url), links.hashUrl(url + '/'));
  assert.doesNotMatch(key, /github/, 'only a hash is kept');
});

test('search needs every word in the title or address; rows show a tidy address', () => {
  const link = { title: 'Stretchly 休息提醒', url: 'https://github.com/hovancik/stretchly' };
  assert.equal(links.linkMatches(link, 'github 休息'), true);
  assert.equal(links.linkMatches(link, 'github 番茄'), false);
  assert.equal(links.displayUrl('https://www.figma.com/files/'), 'figma.com/files');
  assert.equal(links.displayUrl('https://claude.ai'), 'claude.ai');
  assert.equal(links.hostOf('https://www.sspai.com/post/1'), 'sspai.com');
});

test('without an icon a link gets a stable initial and colour', () => {
  assert.equal(links.initialOf({ title: 'claude', url: 'https://claude.ai' }), 'C');
  assert.equal(links.initialOf({ title: '通义千问', url: 'https://tongyi.aliyun.com' }), '通');
  assert.equal(links.initialOf({ title: '未命名', url: 'https://kimi.com' }), 'K');
  assert.equal(links.toneOf({ url: 'https://claude.ai/new' }), links.toneOf({ url: 'https://claude.ai' }));
  assert.equal(links.UNSORTED, '未分组');
});
