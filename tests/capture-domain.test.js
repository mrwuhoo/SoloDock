const test = require('node:test');
const assert = require('node:assert/strict');
const capture = require('../renderer/capture-domain');
const life = require('../renderer/life-domain');

// 2026-09-25 is a Friday.
const now = new Date(2026, 8, 25, 10, 0).getTime();
const habits = life.normalizeLife({}).habits;
const names = { P0: '课程', P1: '自媒体&写作', P2: 'Vibe coding', P3: '日常' };
const parse = (text, options = {}) => capture.parseCapture(text, { now, habits, category: 'P1', ...options });
const at = (month, day, hour, minute = 0) => new Date(2026, month - 1, day, hour, minute).getTime();

test('a date, a time or "记得" makes a todo; the date words leave the text', () => {
  const call = parse('明天下午3点 给王总回电话');
  assert.deepEqual([call.type, call.text, call.at, call.hasTime, call.category], ['todo', '给王总回电话', at(9, 26, 15), true, 'P1']);
  assert.equal(capture.describe(call, { now, categoryNames: names }), '自媒体&写作 · 明天 15:00');
  assert.equal(capture.confirmation(call, { now }), '已加待办 · 明天 15:00');

  const friday = parse('周五前交稿');
  assert.deepEqual([friday.type, friday.text, friday.at, friday.hasTime], ['todo', '交稿', at(9, 25, 23, 30), false], 'a date alone is due at 23:30');
  assert.deepEqual([parse('记得买猫粮').type, parse('记得买猫粮').text, parse('记得买猫粮').at], ['todo', '买猫粮', at(9, 25, 23, 30)]);
  assert.equal(parse('下周一 10:30 复盘会').at, at(9, 28, 10, 30));
  assert.equal(parse('下下周二 体检').at, at(10, 6, 23, 30));
  assert.equal(parse('周末 大扫除').at, at(9, 26, 23, 30));
  assert.equal(parse('9月30日 提交报销').at, at(9, 30, 23, 30));
  assert.equal(parse('30号 交房租').at, at(9, 30, 23, 30));
  assert.equal(parse('3号 交房租').at, at(10, 3, 23, 30), 'a day already past this month means next month');
  assert.equal(parse('十二月三号 年会').at, at(12, 3, 23, 30));
  assert.equal(parse('半小时后 打电话给妈妈').at, now + 30 * 60000);
  assert.equal(parse('提醒我 8pm 倒垃圾').at, at(9, 25, 20));
});

test('times: Chinese numerals, periods, afternoon by default, tomorrow once passed', () => {
  assert.equal(parse('下午三点半 客户电话').at, at(9, 25, 15, 30));
  assert.equal(parse('3点 开会').at, at(9, 25, 15), 'a bare 1–7 o\'clock is the afternoon, like the timeline');
  assert.equal(parse('早上9点 晨会').at, at(9, 26, 9), '09:00 has passed, so tomorrow');
  assert.equal(parse('晚上8点跑步').type, 'todo', 'a future time makes a plan, not a record');
  assert.equal(parse('今晚9点 直播').at, at(9, 25, 21));
  assert.equal(parse('明天 十点一刻 面试').at, at(9, 26, 10, 15));
  assert.equal(parse('写快一点就好').type, 'note', '"一点" without context is "a bit", not 1 o\'clock');
  assert.equal(parse('下午一点 午会').at, at(9, 25, 13));
  const empty = parse('明天3点');
  assert.deepEqual([empty.type, empty.valid], ['todo', false]);
  assert.equal(capture.describe(empty, { now, categoryNames: names }), '写上要做什么');
});

test('"今天" alone, long or multi-line text stays a note', () => {
  assert.equal(parse('今天好累，想早点睡').type, 'note');
  assert.equal(parse('今晚交稿').type, 'note');
  assert.equal(parse('这周一 复盘').type, 'note', 'a day already past is not a new todo');
  const long = `读到一句话：${'很长的摘录'.repeat(20)}，下午3点再想想`;
  assert.equal(parse(long).type, 'note');
  assert.equal(parse('会议纪要\n1. 3点前发初稿\n2. 周五复盘').type, 'note');
  const note = parse('一人公司最重要的是节奏');
  assert.equal(note.text, '一人公司最重要的是节奏');
  assert.equal(capture.describe(note, { now }), '存进今天的随手记 · 10:00');
  assert.equal(capture.confirmation(note), '已存入随手记');
});

test('links: a URL anywhere, or a bare domain with a path', () => {
  const figma = parse('https://www.figma.com/files 封面稿');
  assert.deepEqual([figma.type, figma.url, figma.title], ['link', 'https://www.figma.com/files', '封面稿']);
  assert.equal(capture.describe(figma, { now }), 'figma.com · 封面稿');
  assert.equal(parse('github.com/mrwuhoo/SoloDock').url, 'https://github.com/mrwuhoo/SoloDock');
  assert.equal(parse('看看这个，https://example.com/a。').url, 'https://example.com/a');
  assert.equal(parse('readme.md').type, 'note');
  assert.deepEqual(parse('明天 3 点开会').types, ['note', 'todo', 'life'], 'link is only offered when there is a URL');
});

test('life: a habit record now or yesterday, never a future plan', () => {
  const run = parse('跑步 5km 32分钟');
  assert.deepEqual([run.type, run.habitId, run.item, run.minutes, run.note, run.at], ['life', 'exercise', '跑步', 32, '5km', now]);
  assert.equal(capture.describe(run, { now, habits }), '运动 · 跑步 · 32 分钟 · 5km');
  assert.equal(capture.confirmation(run, { habits }), '已记一笔 · 运动');
  const yesterday = parse('昨天冥想 20分钟');
  assert.deepEqual([yesterday.type, yesterday.habitId, yesterday.minutes, yesterday.at], ['life', 'meditate', 20, at(9, 24, 20)]);
  assert.equal(capture.describe(yesterday, { now, habits }), '冥想 · 20 分钟 · 昨天');
  assert.equal(parse('明天跑步').type, 'todo');
  assert.equal(parse('跑步 5km', { habits: [] }).type, 'note', 'no habits, no life');
});

test('Tab picks another type; a picked habit or category wins', () => {
  assert.equal(parse('跑步 5km 32分钟', { type: 'note' }).type, 'note');
  assert.equal(parse('一人公司', { type: 'link' }).type, 'note', 'link cannot be forced without a URL');
  const forced = parse('读三体 30分钟', { type: 'life', habitId: 'read' });
  assert.deepEqual([forced.habitId, forced.minutes, forced.note], ['read', 30, '读三体']);
  const todo = parse('买猫粮', { type: 'todo', category: 'P3' });
  assert.deepEqual([todo.type, todo.text, todo.category], ['todo', '买猫粮', 'P3']);
  const late = capture.parseCapture('买猫粮', { now: at(9, 25, 23, 45), type: 'todo' });
  assert.equal(late.at, at(9, 26, 23, 30), 'after 23:30 the default is tomorrow');
  assert.equal(capture.nextType('note', ['note', 'todo', 'life']), 'todo');
  assert.equal(capture.nextType('life', ['note', 'todo', 'life']), 'note');
  assert.equal(capture.nextType('note', ['note', 'todo', 'life'], -1), 'life');
});

test('the default category is where the latest todo went; notes append one line per capture', () => {
  assert.equal(capture.lastUsedCategory({ P0: [{ createdAt: 5 }], P2: [{ createdAt: 9 }], P3: [] }), 'P2');
  assert.equal(capture.lastUsedCategory(null), 'P3');
  assert.equal(capture.captureDayKey(at(9, 26, 2)), '2026-09-25', 'before 04:00 still counts as the day before');
  assert.equal(capture.captureNoteTitle(at(9, 25, 14)), '随手记 · 9月25日');
  const first = capture.appendCaptureLine('', '封面换暖色', at(9, 25, 14, 32));
  assert.equal(first, '- 14:32 封面换暖色');
  assert.equal(capture.appendCaptureLine(first, '第二条\n还有一行', at(9, 25, 15, 5)), '- 14:32 封面换暖色\n- 15:05 第二条\n  还有一行');
});
