const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVaultLock, PASSWORD_COOLDOWN_MS } = require('../vault-lock');

function setup({ system = 'touchid', approve = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solodock-vault-lock-'));
  const file = path.join(dir, 'vault-lock.json');
  const env = { clock: 1_000_000, system, approve, prompts: 0, changes: [] };
  const make = () => createVaultLock({
    file,
    now: () => env.clock,
    systemAuth: {
      available: async () => env.system,
      prompt: async () => { env.prompts += 1; return env.approve; },
    },
    onChange: (state) => env.changes.push(state),
  });
  return { env, file, make, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('a new install is unlocked until the lock is turned on; then it locks after idle time and on restart', async () => {
  const { env, file, make, cleanup } = setup();
  const lock = make();
  assert.equal(lock.isLocked(), false);
  const fresh = await lock.status();
  assert.equal(fresh.enabled, false);
  assert.equal(fresh.setupSeen, false);
  assert.equal(fresh.system, 'touchid');

  assert.deepEqual(await lock.configure({ enabled: true }), { ok: true }, 'Touch ID alone is enough');
  assert.equal(lock.isLocked(), false, 'stays unlocked right after setup');
  assert.equal((await lock.status()).lockAt, env.clock + 10 * 60_000);

  env.clock += 9 * 60_000;
  lock.touch();
  env.clock += 9 * 60_000;
  assert.equal(lock.isLocked(), false, 'using the vault postpones the auto-lock');
  env.clock += 60_000;
  assert.equal(lock.isLocked(), true);
  assert.deepEqual(env.changes.at(-1), { locked: true, reason: 'idle' });
  assert.equal((await lock.status()).lockAt, null);

  env.approve = false;
  assert.deepEqual(await lock.unlockWithSystem(), { ok: false, error: 'canceled' });
  assert.equal(lock.isLocked(), true);
  env.approve = true;
  assert.deepEqual(await lock.unlockWithSystem(), { ok: true });
  assert.equal(lock.isLocked(), false);
  lock.lock('manual');
  assert.equal(lock.isLocked(), true);
  lock.dispose();

  const restarted = make();
  assert.equal(restarted.isLocked(), true, 'every launch starts locked');
  assert.deepEqual(await restarted.configure({ autoLockMinutes: 30 }), { ok: false, error: 'locked' });
  restarted.dispose();
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  cleanup();
});

test('without Touch ID or Windows Hello the lock needs a master password, stored only as a hash', async () => {
  const { env, file, make, cleanup } = setup({ system: null });
  const lock = make();
  assert.deepEqual(await lock.configure({ enabled: true }), { ok: false, error: 'password_required' });
  assert.deepEqual(await lock.configure({ enabled: true, password: '12345' }), { ok: false, error: 'password_too_short' });
  assert.deepEqual(await lock.configure({ enabled: true, password: '正确的马电池' }), { ok: true });
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /正确的马电池/);
  assert.deepEqual(await lock.configure({ removePassword: true }), { ok: false, error: 'password_required' });
  lock.lock();

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    assert.deepEqual(await lock.unlockWithPassword('wrong'), { ok: false, error: 'wrong', attemptsLeft: 5 - attempt });
  }
  const cooldown = await lock.unlockWithPassword('wrong');
  assert.equal(cooldown.error, 'cooldown');
  assert.equal(cooldown.cooldownUntil, env.clock + PASSWORD_COOLDOWN_MS);
  assert.equal((await lock.unlockWithPassword('正确的马电池')).error, 'cooldown', 'even the right password waits out the cooldown');
  env.clock += PASSWORD_COOLDOWN_MS;
  assert.deepEqual(await lock.unlockWithPassword('正确的马电池'), { ok: true });
  assert.equal((await lock.status()).attemptsLeft, 5);
  assert.deepEqual(await lock.resetPasswordWithSystem(), { ok: false, error: 'unavailable' });
  lock.dispose();
  cleanup();
});

test('a forgotten master password is reset with Touch ID; no stored keys are involved', async () => {
  const { env, make, cleanup } = setup();
  const lock = make();
  await lock.configure({ enabled: true, password: 'long enough' });
  lock.lock();
  assert.equal((await lock.status()).hasPassword, true);
  env.approve = false;
  assert.deepEqual(await lock.resetPasswordWithSystem(), { ok: false, error: 'canceled' });
  env.approve = true;
  assert.deepEqual(await lock.resetPasswordWithSystem(), { ok: true });
  const status = await lock.status();
  assert.equal(status.hasPassword, false);
  assert.equal(status.locked, false);
  assert.equal(status.enabled, true, 'the lock stays on, still unlockable with Touch ID');

  // Turning the lock off and dismissing the setup hint are remembered.
  assert.deepEqual(await lock.configure({ enabled: false }), { ok: true });
  assert.equal(lock.isLocked(), false);
  lock.lock();
  assert.equal(lock.isLocked(), false, 'nothing to lock when the lock is off');
  lock.dispose();
  const again = make();
  assert.equal((await again.status()).setupSeen, true);
  again.dispose();
  cleanup();
});
