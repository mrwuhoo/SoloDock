const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNoticeStore, baseNoticeId, RETENTION_MS } = require('../notice-store');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solodock-notices-'));
  const file = path.join(dir, 'notices.json');
  const env = { clock: 1_000_000_000_000, changes: [] };
  const make = () => createNoticeStore({ file, now: () => env.clock, onChange: (summary) => env.changes.push(summary) });
  return { env, file, make, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const notice = (eventId, source, extra = {}) => ({ eventId, source, title: `${source} 提醒`, completedAt: 1_000_000_000_000, ...extra });

test('every reminder is kept except receipts, the quiet eye reminder and focus summaries', () => {
  const { env, make, cleanup } = setup();
  const store = make();
  for (const [id, source] of [['a', 'codex'], ['b', 'needs-you'], ['c', 'todo'], ['d', 'info'], ['e', 'eye'], ['f', 'focus-summary'], ['g', 'sit']]) {
    store.add(notice(id, source, { completedAt: env.clock + id.charCodeAt(0) }));
  }
  assert.deepEqual(store.list().map((item) => item.source), ['sit', 'todo', 'needs-you', 'codex'], 'newest first');
  assert.deepEqual(store.summary(), { unread: 4, needsYou: 1 });
  // Snoozed and after-focus deliveries are the same notice, not new ones.
  assert.equal(store.add(notice('a-snoozed-123', 'codex')), null);
  assert.equal(store.add(notice('a-after-focus', 'codex')), null);
  assert.equal(store.list().length, 4);
  assert.equal(baseNoticeId('x-snoozed-1-snoozed-2'), 'x');
  cleanup();
});

test('handling, resolving and reading; the file survives a restart and old notices expire', () => {
  const { env, file, make, cleanup } = setup();
  const store = make();
  store.add(notice('n1', 'needs-you', { agent: 'claude', project: 'solodock' }));
  store.add(notice('n2', 'needs-you', { agent: 'codex' }));
  store.add(notice('t1', 'todo'));
  assert.equal(store.markHandled('t1-snoozed-99'), true, 'acting on a snoozed copy handles the original');
  assert.equal(store.get('t1').handled, true);
  assert.equal(store.resolveNeedsYou('claude'), true);
  assert.deepEqual(store.summary(), { unread: 2, needsYou: 1 });
  assert.equal(store.markAllRead(), true);
  assert.equal(store.markAllRead(), false, 'nothing left to read');
  assert.deepEqual(store.summary(), { unread: 0, needsYou: 1 });
  assert.deepEqual(env.changes.at(-1), { unread: 0, needsYou: 1 });
  store.flush();
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  const reopened = make();
  assert.deepEqual(reopened.list().map((item) => [item.id, item.handled]), [['t1', true], ['n2', false], ['n1', true]]);
  env.clock += RETENTION_MS + 1000;
  assert.deepEqual(reopened.list(), [], 'kept for 7 days');
  reopened.add(notice('x', 'codex', { completedAt: env.clock }));
  reopened.clear();
  assert.deepEqual(reopened.list(), []);
  cleanup();
});
