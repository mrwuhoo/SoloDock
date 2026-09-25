// 密钥锁（方案 A）：Touch ID / Windows Hello 解锁，主密码只是备用的「门锁」。
// 数据始终由系统 safeStorage 加密；这里只保存主密码的 scrypt 哈希，忘记主密码可用系统身份验证重置，
// 不会因此丢失任何密钥。锁状态只存在内存里：每次启动 SoloDock 都从锁定开始。
const fs = require('fs');
const crypto = require('crypto');

const AUTO_LOCK_CHOICES = [1, 5, 10, 30, 60];
const DEFAULT_AUTO_LOCK_MINUTES = 10;
const MAX_PASSWORD_FAILURES = 5;
const PASSWORD_COOLDOWN_MS = 30_000;
const MIN_PASSWORD_LENGTH = 6;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 };
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

function scryptHash(password, salt, params = SCRYPT) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, params.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT_MAXMEM }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

function normalizeConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const password = source.password && typeof source.password === 'object'
    && typeof source.password.salt === 'string' && typeof source.password.hash === 'string'
    ? {
      salt: source.password.salt,
      hash: source.password.hash,
      N: Number(source.password.N) || SCRYPT.N,
      r: Number(source.password.r) || SCRYPT.r,
      p: Number(source.password.p) || SCRYPT.p,
      keylen: Number(source.password.keylen) || SCRYPT.keylen,
    }
    : null;
  return {
    version: 1,
    enabled: source.enabled === true,
    autoLockMinutes: AUTO_LOCK_CHOICES.includes(Number(source.autoLockMinutes)) ? Number(source.autoLockMinutes) : DEFAULT_AUTO_LOCK_MINUTES,
    password,
    // 用户在密钥页点过「以后再说」或已经设置过，就不再引导。
    setupSeen: source.setupSeen === true || source.enabled === true,
  };
}

/**
 * @param {object} options
 * @param {string} options.file  JSON config path (userData/vault-lock.json)
 * @param {() => number} [options.now]
 * @param {{ available: () => Promise<string|null>, prompt: (reason: string) => Promise<boolean> }} options.systemAuth
 * @param {(state: { locked: boolean, reason: string }) => void} [options.onChange]
 */
function createVaultLock({ file, now = Date.now, systemAuth, onChange = () => {} }) {
  let config = read();
  let unlocked = !config.enabled;
  let lastActivity = now();
  let failures = 0;
  let cooldownUntil = 0;
  let timer = null;

  function read() {
    try {
      return normalizeConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (error) {
      return normalizeConfig({});
    }
  }

  function write(next) {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(temporary, file);
      config = next;
      return true;
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch (unlinkError) {}
      return false;
    }
  }

  const autoLockMs = () => config.autoLockMinutes * 60_000;

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!config.enabled || !unlocked) return;
    const remaining = Math.max(0, lastActivity + autoLockMs() - now());
    timer = setTimeout(() => { isLocked(); }, remaining + 50);
    timer.unref?.();
  }

  function setUnlocked(value, reason) {
    const changed = unlocked !== value;
    unlocked = value;
    if (value) lastActivity = now();
    schedule();
    if (changed) onChange({ locked: !value, reason });
  }

  function isLocked() {
    if (!config.enabled) return false;
    if (unlocked && now() - lastActivity >= autoLockMs()) setUnlocked(false, 'idle');
    return !unlocked;
  }

  function touch() {
    if (!isLocked()) {
      lastActivity = now();
      schedule();
    }
  }

  function lock(reason = 'manual') {
    if (config.enabled && unlocked) setUnlocked(false, reason);
  }

  function cooldownRemaining() {
    return Math.max(0, cooldownUntil - now());
  }

  async function status() {
    const locked = isLocked();
    return {
      enabled: config.enabled,
      setupSeen: config.setupSeen,
      locked,
      system: await systemAuth.available().catch(() => null),
      hasPassword: Boolean(config.password),
      autoLockMinutes: config.autoLockMinutes,
      lockAt: config.enabled && !locked ? lastActivity + autoLockMs() : null,
      cooldownUntil: cooldownRemaining() ? cooldownUntil : 0,
      attemptsLeft: MAX_PASSWORD_FAILURES - failures,
      // 没有系统验证时，忘记主密码的办法是删除这个文件（密钥本身不受影响）。
      configFile: file,
    };
  }

  async function verifySystem(reason) {
    const method = await systemAuth.available().catch(() => null);
    if (!method) return { ok: false, error: 'unavailable' };
    const ok = await systemAuth.prompt(reason).catch(() => false);
    return ok ? { ok: true, method } : { ok: false, error: 'canceled' };
  }

  async function unlockWithSystem() {
    if (!config.enabled) return { ok: true };
    if (!isLocked()) return { ok: true };
    const result = await verifySystem('解锁 SoloDock 密钥');
    if (!result.ok) return result;
    failures = 0;
    cooldownUntil = 0;
    setUnlocked(true, 'system');
    return { ok: true };
  }

  async function unlockWithPassword(password) {
    if (!config.enabled || !isLocked()) return { ok: true };
    if (cooldownRemaining()) return { ok: false, error: 'cooldown', cooldownUntil };
    if (!config.password) return { ok: false, error: 'no_password' };
    const { salt, hash, ...params } = config.password;
    let matches = false;
    try {
      const expected = Buffer.from(hash, 'base64');
      const actual = await scryptHash(password, Buffer.from(salt, 'base64'), params);
      matches = actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (error) {
      matches = false;
    }
    if (!matches) {
      failures += 1;
      if (failures >= MAX_PASSWORD_FAILURES) {
        failures = 0;
        cooldownUntil = now() + PASSWORD_COOLDOWN_MS;
        return { ok: false, error: 'cooldown', cooldownUntil };
      }
      return { ok: false, error: 'wrong', attemptsLeft: MAX_PASSWORD_FAILURES - failures };
    }
    failures = 0;
    setUnlocked(true, 'password');
    return { ok: true };
  }

  async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scryptHash(password, salt);
    return { salt: salt.toString('base64'), hash: hash.toString('base64'), ...SCRYPT };
  }

  // 修改设置需要先解锁（或者锁还没开）。
  async function configure(options = {}) {
    if (isLocked()) return { ok: false, error: 'locked' };
    const next = { ...config, setupSeen: true };
    if (options.autoLockMinutes !== undefined) {
      if (!AUTO_LOCK_CHOICES.includes(Number(options.autoLockMinutes))) return { ok: false, error: 'invalid_auto_lock' };
      next.autoLockMinutes = Number(options.autoLockMinutes);
    }
    if (typeof options.password === 'string') {
      if (Array.from(options.password).length < MIN_PASSWORD_LENGTH) return { ok: false, error: 'password_too_short' };
      next.password = await hashPassword(options.password);
    }
    if (options.removePassword === true) next.password = null;
    if (options.enabled !== undefined) next.enabled = options.enabled === true;
    // 没有 Touch ID / Windows Hello 时，开着锁就必须有主密码，否则没法解锁。
    if (next.enabled && !next.password && !(await systemAuth.available().catch(() => null))) {
      return { ok: false, error: 'password_required' };
    }
    if (!write(next)) return { ok: false, error: 'save_failed' };
    // 刚设置完保持解锁，从现在开始计算自动锁定。
    setUnlocked(true, 'configured');
    return { ok: true };
  }

  async function dismissSetup() {
    if (config.setupSeen) return { ok: true };
    return write({ ...config, setupSeen: true }) ? { ok: true } : { ok: false, error: 'save_failed' };
  }

  // 忘记主密码：通过 Touch ID / Windows Hello（或它们的系统密码兜底）确认是本人，清除主密码并解锁。
  async function resetPasswordWithSystem() {
    const result = await verifySystem('重置 SoloDock 密钥的主密码');
    if (!result.ok) return result;
    if (!write({ ...config, password: null })) return { ok: false, error: 'save_failed' };
    failures = 0;
    cooldownUntil = 0;
    setUnlocked(true, 'reset');
    return { ok: true };
  }

  function dispose() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  return { status, isLocked, touch, lock, unlockWithSystem, unlockWithPassword, configure, dismissSetup, resetPasswordWithSystem, dispose };
}

module.exports = {
  createVaultLock,
  AUTO_LOCK_CHOICES,
  DEFAULT_AUTO_LOCK_MINUTES,
  MAX_PASSWORD_FAILURES,
  PASSWORD_COOLDOWN_MS,
  MIN_PASSWORD_LENGTH,
};
