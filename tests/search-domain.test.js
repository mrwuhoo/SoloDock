const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../renderer/search-domain');

const items = [
  { type: 'todo', id: 't1', title: '交付封面终稿', subtitle: '自媒体&写作 · 今天 18:00', at: 5 },
  { type: 'note', id: 'n1', title: '第 12 期脚本', subtitle: '一人公司怎么排一周，封面用暖色', at: 9 },
  { type: 'prompt', id: 'p1', title: '封面文案', subtitle: '给 {主题} 写三个封面标题', at: 3 },
  { type: 'link', id: 'l1', title: 'Figma', subtitle: 'figma.com', keywords: '设计 封面', at: 1 },
  { type: 'clip', id: 'c1', title: 'https://example.com/cover.png', subtitle: '剪贴板 · 链接', at: 7 },
  { type: 'credential', id: 'k1', title: 'OpenAI', subtitle: 'OPENAI_API_KEY', keywords: 'platform.openai.com', at: 2 },
];

test('results are grouped by type in a fixed order; title matches rank first', () => {
  const groups = search.searchItems(items, '封面');
  assert.deepEqual(groups.map((group) => group.type), ['todo', 'note', 'prompt', 'link']);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [['t1'], ['n1'], ['p1'], ['l1']]);
  assert.deepEqual(search.searchItems(items, ''), [], 'empty input shows quick actions instead');
  assert.deepEqual(search.searchItems(items, 'cover').map((group) => group.type), ['clip']);
});

test('every word must match, case does not matter, and passwords are never searchable', () => {
  assert.deepEqual(search.searchItems(items, '封面 暖色').map((group) => group.items[0].id), ['n1']);
  assert.deepEqual(search.searchItems(items, 'openai').map((group) => group.items[0].id), ['k1']);
  assert.deepEqual(search.searchItems([{ ...items[5], password: 'sk-secret' }], 'sk-secret'), [], 'there is no password field to match');
});

test('five per group, forty when filtered to one type; Tab cycles the filters', () => {
  const many = Array.from({ length: 12 }, (_, index) => ({ type: 'note', id: `n${index}`, title: `周报 ${index}`, at: index }));
  const all = search.searchItems(many, '周报');
  assert.deepEqual([all[0].items.length, all[0].total], [5, 12]);
  assert.equal(all[0].items[0].id, 'n11', 'newer first when scores tie');
  assert.equal(search.searchItems(many, '周报', { filter: 'note' })[0].items.length, 12);
  assert.deepEqual(search.searchItems(items, '封面', { filter: 'link' }).map((group) => group.type), ['link']);
  assert.equal(search.nextFilter('all'), 'todo');
  assert.equal(search.nextFilter('credential'), 'all');
  assert.equal(search.nextFilter('all', -1), 'credential');
});

test('recent items keep the newest use and at most eight', () => {
  let recent = [];
  for (let index = 0; index < 10; index += 1) recent = search.rememberRecent(recent, { type: 'note', id: `n${index}`, title: `笔记 ${index}` });
  recent = search.rememberRecent(recent, { type: 'note', id: 'n5', title: '笔记 5' });
  assert.equal(recent.length, 8);
  assert.equal(recent[0].id, 'n5');
  assert.equal(recent.filter((item) => item.id === 'n5').length, 1);
  assert.equal(search.typeLabel('credential'), '密钥');
});
