const test = require('node:test');
const assert = require('node:assert/strict');
const notes = require('../renderer/notes-domain');

// 2026-09-25 is a Friday; this week started on Monday 9/21.
const at = (m, d, h = 12, min = 0, y = 2026) => new Date(y, m - 1, d, h, min).getTime();
const now = at(9, 25, 15);

test('notes group into today, this week and earlier; today\'s 随笔 stays first', () => {
  const list = [
    { id: 'a', updatedAt: at(9, 25, 11) },
    { id: 'suibi', updatedAt: at(9, 25, 9) },
    { id: 'b', updatedAt: at(9, 22) },
    { id: 'c', updatedAt: at(9, 20) },
    { id: 'd', updatedAt: at(9, 25, 14) },
  ];
  const groups = notes.groupNotes(list, now, 'suibi');
  assert.deepEqual(groups.map((group) => [group.label, group.items.map((note) => note.id)]), [['今天', ['suibi', 'd', 'a']], ['本周', ['b']], ['更早', ['c']]]);
  assert.deepEqual(notes.groupNotes([{ id: 'x', updatedAt: at(9, 1) }], now).map((group) => group.label), ['更早']);
});

test('list and detail times read naturally', () => {
  assert.equal(notes.listTime(at(9, 25, 14, 32), now), '14:32');
  assert.equal(notes.listTime(at(9, 22), now), '周二');
  assert.equal(notes.listTime(at(9, 20), now), '9/20');
  assert.equal(notes.listTime(at(12, 30, 12, 0, 2025), now), '2025/12/30');
  assert.equal(notes.updatedLabel(at(9, 25, 14, 32), now), '今天 14:32');
  assert.equal(notes.updatedLabel(at(9, 24, 9, 5), now), '昨天 09:05');
  assert.equal(notes.updatedLabel(at(9, 20, 18), now), '9月20日 18:00');
});

test('excerpts and first-line titles drop Markdown marks; words count without spaces', () => {
  const content = '## 原则\n工具要少而精，**每个**工具只负责一件事。\n- [x] 把密码迁到密钥\n> 扶手不是工作台';
  assert.equal(notes.excerpt(content), '原则 · 工具要少而精，每个工具只负责一件事。 · 把密码迁到密钥 · 扶手不是工作台');
  assert.equal(notes.firstLineTitle('\n\n# 一人公司工具栈\n正文'), '一人公司工具栈');
  assert.equal(notes.firstLineTitle('[链接](https://a.com) 标题'), '链接 标题');
  assert.equal(notes.wordCount('一人 公司\nab'), 6);
});

test('search hits are highlighted for every word, case-insensitive', () => {
  assert.deepEqual(notes.highlight('SoloDock 原型评审', 'solo 评审'), [{ text: 'Solo', hit: true }, { text: 'Dock 原型', hit: false }, { text: '评审', hit: true }]);
  assert.deepEqual(notes.highlight('没有命中', 'xyz'), [{ text: '没有命中', hit: false }]);
  assert.deepEqual(notes.highlight('abc', ''), [{ text: 'abc', hit: false }]);
});

test('ticking a task box in the preview writes back to that line only', () => {
  const content = '清单\n- [ ] 一\n  - [x] 二\n- 普通';
  assert.equal(notes.toggleTask(content, 1), '清单\n- [x] 一\n  - [x] 二\n- 普通');
  assert.equal(notes.toggleTask(content, 2), '清单\n- [ ] 一\n  - [ ] 二\n- 普通');
  assert.equal(notes.toggleTask(content, 3), content, 'not a task line');
  assert.equal(notes.toggleTask(content, 9), content);
});

test('the editor weakens Markdown marks but keeps every character in place', () => {
  const content = '## 标题\n- [ ] 任务 **加粗** `代码`\n[链接](https://a.com) 和 *斜体*\n普通 2*3';
  const parts = notes.markdownMarks(content);
  assert.equal(parts.map((part) => part.text).join(''), content, 'nothing added or lost');
  assert.deepEqual(parts.filter((part) => part.mark).map((part) => part.text), ['## ', '- [ ] ', '**', '**', '`', '`', '[', '](https://a.com)', '*', '*']);
  assert.equal(notes.dailyTitle(at(9, 25)), '9月25日 随笔');
  assert.equal(notes.dayKey(at(9, 5)), '2026-09-05');
  assert.equal(notes.exportName('会议: 纪要/9?'), '会议 纪要 9');
  assert.equal(notes.exportName(''), '笔记');
});
