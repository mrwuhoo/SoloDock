const test = require('node:test');
const assert = require('node:assert/strict');
const prompts = require('../renderer/prompts-domain');

test('home commands migrate into ungrouped prompts without losing order or text', () => {
  const migrated = prompts.migrateCommands([
    { id: 'c1', text: '帮我把这段话改写得更口语化\n保留关键数据', createdAt: 10 },
    { id: 'c2', text: '   ', createdAt: 11 },
    { id: 'c3', text: 'Review 这段代码', createdAt: 12 },
  ]);
  assert.deepEqual(migrated.map((item) => item.id), ['c1', 'c3']);
  assert.equal(migrated[0].title, '帮我把这段话改写得更口语化');
  assert.equal(migrated[0].text, '帮我把这段话改写得更口语化\n保留关键数据');
  assert.equal(migrated[0].group, '');
  assert.equal(migrated[0].uses, 0);
  assert.deepEqual(prompts.migrateCommands(null), []);
});

test('variables are extracted once, in order, and built-ins are filled automatically', () => {
  const text = '{称呼}好，关于{项目}的报价是{报价}。{称呼}，今天是{日期}，参考：{剪贴板}';
  assert.deepEqual(prompts.extractVariables(text), ['称呼', '项目', '报价', '日期', '剪贴板']);
  assert.deepEqual(prompts.editableVariables(text), ['称呼', '项目', '报价']);
  const now = new Date(2026, 8, 24, 10, 0).getTime();
  const filled = prompts.fillTemplate(text, { 称呼: '王总', 项目: 'Q4 课程' }, { clipboard: '合同第 4 条', now });
  assert.equal(filled, '王总好，关于Q4 课程的报价是{报价}。王总，今天是2026年9月24日，参考：合同第 4 条');
});

test('filtering supports search, groups and the starred view, most recently used first', () => {
  const list = prompts.normalizePrompts([
    { id: 'a', title: '改写', text: '口语化', group: '写作', starred: true, createdAt: 1, lastUsedAt: 5 },
    { id: 'b', title: '代码审查', text: '找 bug', group: '编程', createdAt: 2, lastUsedAt: 9 },
    { id: 'c', title: '报价回复', text: '{称呼}好', group: '客户', starred: true, createdAt: 3 },
  ]);
  assert.deepEqual(prompts.filterPrompts(list).map((item) => item.id), ['b', 'a', 'c']);
  assert.deepEqual(prompts.filterPrompts(list, '', '★').map((item) => item.id), ['a', 'c']);
  assert.deepEqual(prompts.filterPrompts(list, 'BUG').map((item) => item.id), ['b']);
  assert.deepEqual(prompts.filterPrompts(list, '', '客户').map((item) => item.id), ['c']);
  assert.deepEqual(prompts.promptGroups(list), ['写作', '编程', '客户']);
});

test('recording a use increments the counter and moves the prompt to the top', () => {
  const list = [{ id: 'a', text: 'x', createdAt: 1 }, { id: 'b', text: 'y', createdAt: 2 }];
  const used = prompts.recordUse(list, 'a', 100);
  assert.equal(used.find((item) => item.id === 'a').uses, 1);
  assert.equal(prompts.filterPrompts(used)[0].id, 'a');
});

test('malformed storage is repaired instead of breaking the page', () => {
  assert.deepEqual(prompts.normalizePrompts('nope'), []);
  const repaired = prompts.normalizePrompts([null, { id: 'x' }, { id: 'x', text: 'dup' }, { text: 'no id' }]);
  assert.equal(repaired.length, 1);
  assert.equal(repaired[0].title, '未命名提示词');
});
