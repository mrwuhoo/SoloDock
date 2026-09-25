const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('../renderer/worklog-domain');

const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).getTime();

test('a work day runs from 04:00 to 04:00, so late nights count for the day before', () => {
  assert.equal(w.dayKey(at(25, 10)), '2026-09-25');
  assert.equal(w.dayKey(at(26, 1, 30)), '2026-09-25', '01:30 is still yesterday');
  assert.equal(w.dayKey(at(26, 4)), '2026-09-26');
  assert.equal(w.dayStart('2026-09-25'), at(25, 4));
});

test('intervals merge, and focus wins over plain activity', () => {
  let runs = w.addInterval([], at(25, 9), at(25, 9, 30));
  runs = w.addInterval(runs, at(25, 9, 30), at(25, 10));
  assert.deepEqual(runs, [[at(25, 9), at(25, 10), 'active']]);
  runs = w.addInterval(runs, at(25, 9, 15), at(25, 9, 40), 'focus');
  assert.deepEqual(runs, [[at(25, 9), at(25, 9, 15), 'active'], [at(25, 9, 15), at(25, 9, 40), 'focus'], [at(25, 9, 40), at(25, 10), 'active']]);
  // Activity reported over a focus stretch keeps it focus.
  runs = w.addInterval(runs, at(25, 9, 20), at(25, 10, 10));
  assert.deepEqual(runs, [[at(25, 9), at(25, 9, 15), 'active'], [at(25, 9, 15), at(25, 9, 40), 'focus'], [at(25, 9, 40), at(25, 10, 10), 'active']]);
  assert.deepEqual(w.addInterval(runs, at(25, 11), at(25, 11)), runs, 'empty intervals change nothing');
});

test('day summary: hours, focus, the longest stretch and when you stopped', () => {
  let runs = w.addInterval([], at(25, 9), at(25, 10, 30));
  runs = w.addInterval(runs, at(25, 10, 33), at(25, 11), 'focus'); // a 3-minute gap still counts as one stretch
  runs = w.addInterval(runs, at(25, 14), at(25, 15));
  runs = w.addInterval(runs, at(25, 23), at(26, 0, 45));
  const summary = w.summarizeDay({ runs, ai: 3, todos: 2 });
  assert.deepEqual(summary, {
    activeMinutes: 90 + 27 + 60 + 105,
    focusMinutes: 27,
    longestMinutes: 120,
    firstActive: at(25, 9),
    lastActive: at(26, 0, 45),
    aiTasks: 3,
    todosDone: 2,
  });
});

test('month summary and grid', () => {
  const days = {
    '2026-09-01': { runs: [[at(1, 9), at(1, 20), 'active']] },
    '2026-09-02': { runs: [[at(2, 9), at(2, 12), 'focus'], [at(2, 13), at(2, 16), 'active']], todos: 4 },
    '2026-09-03': { runs: [] },
    '2026-08-31': { runs: [[at(0, 9), at(0, 10), 'active']] },
  };
  const month = w.summarizeMonth(days, 2026, 9);
  assert.deepEqual(month, { activeMinutes: 660 + 360, averageMinutes: 510, focusRatio: 180 / 1020, todosDone: 4, longDays: 1, workedDays: 2 });
  const grid = w.monthGrid(2026, 9);
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0], null, 'September 2026 starts on a Tuesday; the week starts on Monday');
  assert.equal(grid[1], '2026-09-01');
  assert.equal(grid.filter(Boolean).length, 30);
  assert.equal(w.formatMinutes(125), '2 小时 5 分');
  assert.equal(w.formatMinutes(45), '45 分钟');
  assert.equal(w.cupLevel(18 * 60), 1);
});
