const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorklogStore } = require('../worklog-store');

const at = (day, hour, minute = 0, second = 0) => new Date(2026, 8, day, hour, minute, second).getTime();
const MIN = 60_000;

function setup(start) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solodock-worklog-'));
  const file = path.join(dir, 'worklog.json');
  const env = { clock: start };
  const make = () => createWorklogStore({ file, now: () => env.clock });
  return { env, file, make, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('30-second samples build the day; being away 5 minutes or more is not work', () => {
  const { env, file, make, cleanup } = setup(at(25, 9));
  const store = make();
  for (let i = 0; i < 60; i += 1) { env.clock += 30_000; store.record(10_000, false); } // 09:00–09:30 active
  for (let i = 0; i < 20; i += 1) { env.clock += 30_000; store.record(6 * MIN, false); } // away for 10 minutes
  for (let i = 0; i < 40; i += 1) { env.clock += 30_000; store.record(1_000, true); } // 20 minutes of focus
  const day = store.range('2026-09-25', '2026-09-25')['2026-09-25'];
  assert.deepEqual(day.runs, [
    [at(25, 9), at(25, 9, 30), 'active'],
    [at(25, 9, 40), at(25, 10), 'focus'],
  ]);
  store.flush();
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /[A-Za-z]{3,}\.app|http/, 'nothing but times is stored');
  cleanup();
});

test('late nights split at 04:00; sleep breaks the chain; counters; 13 months retention; clear', () => {
  const { env, make, cleanup } = setup(at(26, 3, 59));
  const store = make();
  store.record(0, false);
  env.clock = at(26, 4, 0, 30);
  store.record(0, false);
  const split = store.range('2026-09-25', '2026-09-26');
  assert.deepEqual(split['2026-09-25'].runs, [[at(26, 3, 58, 30), at(26, 4), 'active']]);
  assert.deepEqual(split['2026-09-26'].runs, [[at(26, 4), at(26, 4, 0, 30), 'active']]);

  store.pause(); // screen locked
  env.clock = at(26, 9);
  store.record(0, false);
  assert.deepEqual(store.range('2026-09-26', '2026-09-26')['2026-09-26'].runs.at(-1), [at(26, 8, 59, 30), at(26, 9), 'active'], 'only the last 30 seconds after a pause');

  store.bump('todos');
  store.bump('todos');
  store.bump('todos', -1);
  store.bump('ai');
  const today = store.range('2026-09-26', '2026-09-26')['2026-09-26'];
  assert.deepEqual([today.todos, today.ai], [1, 1]);

  env.clock = at(26, 9) + 400 * 24 * 3600_000;
  assert.deepEqual(store.range('2026-01-01', '2028-12-31'), {}, 'older than 13 months is dropped');
  store.record(0, false);
  assert.equal(store.recordedDays(), 1);
  store.clear();
  assert.equal(store.recordedDays(), 0);
  cleanup();
});
