const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  createScreen, parseResetTime, parseUsageScreen, mergeUsageWindows, usageSnapshot,
  findClaude, nodeSupportsSystemCa, claudeEnvironment, markOnboarded, ensureOnboarded, createClaudeUsageService,
} = require('../claude-usage');

const at = (text) => new Date(text).getTime();

test('the virtual screen rebuilds text drawn with cursor moves instead of spaces', () => {
  const screen = createScreen({ cols: 40, rows: 6 });
  screen.write('Current wxxk\x1b[3Dee\x1b[2Cused\r\n');
  screen.write('\x1b[3Gab\x1b[1Ccd\x1b[2;1Hxx');
  assert.deepEqual(screen.lines().slice(0, 2), ['Current week used', 'xxab cd']);
  screen.write('\x1b[1;5H\x1b[K');
  assert.equal(screen.lines()[0], 'Curr');
  screen.write('\x1b[?1049h\x1b[2JAlt');
  assert.equal(screen.lines()[0], 'Alt');
  screen.write('\x1b[?1049l');
  assert.equal(screen.lines()[0], 'Curr', 'leaving the alternate screen restores the main one');
  screen.write('\x1b]0;title\x07\x1b[38;5;12mcolor\x1b[0m');
  assert.ok(screen.text().includes('color') && !screen.text().includes('title'));
});

test('the real /usage capture parses into both quota windows with their reset times', () => {
  const data = fs.readFileSync(path.join(__dirname, 'fixtures', 'claude-usage-tui.txt'), 'utf8');
  const screen = createScreen();
  const now = at('2026-09-29T20:10:00-07:00');
  let windows = [];
  // Fed in small pieces, like a pty delivers it; mid-draw frames must not win over complete ones.
  for (let index = 0; index < data.length; index += 16) {
    screen.write(data.slice(index, index + 16));
    windows = mergeUsageWindows(windows, parseUsageScreen(screen.text(), now));
  }
  assert.deepEqual(windows.map((item) => [item.key, item.label, item.usedPercent]), [['fiveHour', '5 小时', 20], ['sevenDay', '本周', 3]]);
  assert.equal(windows[0].resetsAt, at('2026-09-30T00:40:00-07:00'));
  assert.equal(windows[1].resetsAt, at('2026-10-06T16:00:00-07:00'));
  const snapshot = usageSnapshot(windows, now);
  assert.deepEqual([snapshot.fiveHour.usedPercent, snapshot.sevenDay.usedPercent, snapshot.source], [20, 3, 'cli']);
});

test('reset times honour the time zone Claude prints and ignore half-drawn values', () => {
  const now = at('2026-09-29T20:10:00-07:00');
  assert.equal(parseResetTime('Resets 12:40am (America/Los_Angeles)', now), at('2026-09-30T00:40:00-07:00'));
  assert.equal(parseResetTime('Resets 9pm (America/Los_Angeles)', now), at('2026-09-29T21:00:00-07:00'));
  assert.equal(parseResetTime('Resets 8pm (America/Los_Angeles)', now), at('2026-09-30T20:00:00-07:00'), 'already past today: tomorrow');
  assert.equal(parseResetTime('Resets Oct 6 at 4pm (America/Los_Angeles)', now), at('2026-10-06T16:00:00-07:00'));
  assert.equal(parseResetTime('Resets Oct 6, 4:30pm (Asia/Shanghai)', now), at('2026-10-06T16:30:00+08:00'));
  assert.equal(parseResetTime('Resets Jan 2 at 9am (America/Los_Angeles)', now), at('2027-01-02T09:00:00-08:00'), 'across the new year, standard time');
  assert.equal(parseResetTime('Resets Oct 6 at 4p', now), null);
  assert.equal(parseResetTime('Resets 4', now), null);
  assert.equal(parseResetTime('Resets 4pm (Not/A_Zone)', now), null);
  assert.equal(parseResetTime('', now), null);
});

test('per-model weekly windows are kept and a window without a percentage is skipped', () => {
  const text = [
    'Current session', '████ 45% used', 'Resets 3pm (UTC)',
    'Current week (all models)', '██ 12% used', 'Resets Oct 6 at 4pm (UTC)',
    'Current week (Opus)', '█ 30% used', 'Resets Oct 6 at 4pm (UTC)',
    'Current week (Sonnet)', 'Loading…',
  ].join('\n');
  const windows = parseUsageScreen(text, at('2026-09-29T10:00:00Z'));
  assert.deepEqual(windows.map((item) => [item.key, item.label, item.usedPercent]), [
    ['fiveHour', '5 小时', 45], ['sevenDay', '本周', 12], ['sevenDay:opus', '本周 · Opus', 30],
  ]);
  assert.deepEqual(usageSnapshot(windows, 1).models, [{ label: '本周 · Opus', usedPercent: 30, resetsAt: at('2026-10-06T16:00:00Z') }]);
});

test('finding claude covers installs a Finder-launched app cannot see on its PATH', () => {
  const home = '/Users/me';
  const only = (file) => ({ access(candidate) { if (candidate !== file) throw new Error('ENOENT'); } });
  assert.equal(findClaude({ platform: 'darwin', env: { PATH: '/usr/bin:/bin' }, home, ...only('/opt/homebrew/bin/claude') }), '/opt/homebrew/bin/claude');
  assert.equal(findClaude({ platform: 'darwin', env: { PATH: '/usr/bin' }, home, ...only('/Users/me/.local/bin/claude') }), '/Users/me/.local/bin/claude');
  assert.equal(findClaude({ platform: 'linux', env: { PATH: '.:rel:/usr/bin' }, home, ...only('rel/claude') }), null, 'relative PATH entries are never used');
  assert.equal(findClaude({ platform: 'darwin', env: { PATH: '' }, home, ...only('/nowhere') }), null);
});

test('claude runs with a clean environment, a PATH that finds node, and system certificates when node supports them', () => {
  assert.deepEqual(['v23.11.0', 'v23.7.0', 'v22.15.1', 'v22.12.0', 'v24.1.0', 'garbage'].map(nodeSupportsSystemCa), [true, false, true, false, true, false]);
  const env = claudeEnvironment({
    executable: '/opt/homebrew/bin/claude',
    baseEnv: { PATH: '/usr/bin:/bin', HOME: '/Users/me', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'x', ANTHROPIC_API_KEY: 'k', HTTPS_PROXY: 'http://p', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--max-old-space-size=4096' },
    systemCa: true,
  });
  assert.equal(env.HOME, '/Users/me');
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_API_KEY', 'HTTPS_PROXY', 'ELECTRON_RUN_AS_NODE']) assert.equal(env[key], undefined, key);
  assert.ok(env.PATH.split(':').includes('/opt/homebrew/bin'));
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=4096 --use-system-ca');
  assert.equal(env.DISABLE_AUTOUPDATER, '1');
  assert.equal(claudeEnvironment({ executable: '/x/claude', baseEnv: { NODE_OPTIONS: '--foo' } }).NODE_OPTIONS, undefined, 'no node flags for a native build');
});

test('the first-run flag is added only when missing, atomically, with a one-time backup', () => {
  assert.deepEqual(markOnboarded({ a: 1 }), { a: 1, hasCompletedOnboarding: true });
  const done = { hasCompletedOnboarding: true };
  assert.equal(markOnboarded(done), done);
  assert.equal(markOnboarded([]), null);

  const files = new Map([['/h/.claude.json', JSON.stringify({ theme: 'light', projects: { '/p': {} } })]]);
  const fsApi = {
    readFileSync(file) { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); },
    writeFileSync(file, data) { files.set(file, String(data)); },
    existsSync(file) { return files.has(file); },
    statSync() { return { mode: 0o100600 }; },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); },
    unlinkSync(file) { files.delete(file); },
  };
  assert.equal(ensureOnboarded({ file: '/h/.claude.json', fsApi }), 'updated');
  assert.deepEqual(JSON.parse(files.get('/h/.claude.json')), { theme: 'light', projects: { '/p': {} }, hasCompletedOnboarding: true });
  assert.deepEqual(JSON.parse(files.get('/h/.claude.json.before-solodock')), { theme: 'light', projects: { '/p': {} } });
  assert.equal(ensureOnboarded({ file: '/h/.claude.json', fsApi }), 'ok');
  assert.equal(ensureOnboarded({ file: '/h/missing.json', fsApi }), 'missing');
  files.set('/h/bad.json', '{ not json');
  assert.equal(ensureOnboarded({ file: '/h/bad.json', fsApi }), 'invalid');
  assert.equal(files.get('/h/bad.json'), '{ not json', 'a broken file is never rewritten');
});

// A scripted Claude Code: `auth status` answers with JSON, the pty run plays screens in response to keys.
function fakeClaude({ loggedIn = true, screens }) {
  const spawned = [];
  const keys = [];
  function spawnProcess(executable, args) {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.exitCode = null;
    child.pid = 999999;
    child.kill = () => { if (child.exitCode === null) { child.exitCode = 0; setImmediate(() => child.emit('close', 0)); } };
    spawned.push([executable, ...args].join(' '));
    if (args.join(' ') === 'auth status --json') {
      setImmediate(() => { child.stdout.end(JSON.stringify({ loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none' })); child.exitCode = 0; child.emit('close', 0); });
      return child;
    }
    if (executable === 'node') {
      setImmediate(() => { child.stdout.end('v23.11.0\n'); child.exitCode = 0; child.emit('close', 0); });
      return child;
    }
    // The pty run: the first screen appears at start, then each matching key reveals the next one.
    let step = 0;
    const show = () => { const next = screens[step]; if (next) child.stdout.write(next.output); };
    child.stdin.on('data', (data) => {
      const text = String(data);
      keys.push(text);
      const next = screens[step + 1];
      if (next && next.after && text.includes(next.after)) { step += 1; show(); }
    });
    setImmediate(show);
    return child;
  }
  return { spawnProcess, spawned, keys };
}

const TRUST = '\x1b[2J\x1b[HDo you trust the files in this folder?\r\n❯ No, exit\r\n  Yes, I trust this folder\r\nEnter to confirm';
const TRUST_YES = '\x1b[2J\x1b[HDo you trust the files in this folder?\r\n  No, exit\r\n❯ Yes, I trust this folder\r\nEnter to confirm';
const READY_SCREEN = '\x1b[2J\x1b[H────\r\n❯ \r\n────\r\n? for shortcuts';
const USAGE = '\x1b[2J\x1b[HCurrent session\r\n███ 42% used\r\nResets 11pm (UTC)\r\nCurrent week (all models)\r\n█ 7% used\r\nResets Oct 6 at 4pm (UTC)\r\n';

function service(claude, extra = {}) {
  let clock = at('2026-09-29T20:00:00Z');
  return {
    advance(ms) { clock += ms; },
    usage: createClaudeUsageService({
      spawnProcess: claude.spawnProcess,
      locate: () => '/opt/homebrew/bin/claude',
      probeDir: path.join(require('node:os').tmpdir(), 'solodock-claude-test'),
      onboard: () => 'ok',
      settleMs: 5,
      keyGapMs: 0,
      usageWaitMs: 50,
      timeoutMs: 3000,
      now: () => clock,
      ...extra,
    }),
  };
}

test('a read accepts the folder-trust prompt by moving to Yes, runs /usage and parses it', async () => {
  const claude = fakeClaude({
    screens: [
      { output: TRUST },
      { after: '\x1b[B', output: TRUST_YES },
      { after: '\r', output: READY_SCREEN },
      { after: '\r', output: USAGE },
    ],
  });
  const { usage } = service(claude);
  const result = await usage.read();
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.windows.map((item) => [item.key, item.usedPercent]), [['fiveHour', 42], ['sevenDay', 7]]);
  assert.equal(result.snapshot.fiveHour.resetsAt, at('2026-09-29T23:00:00Z'));
  assert.ok(claude.keys.indexOf('\x1b[B') < claude.keys.indexOf('/usage'), 'trust first, then /usage');
  assert.ok(!claude.keys.slice(0, claude.keys.indexOf('\x1b[B')).includes('\r'), 'never confirms while "No, exit" is selected');
  assert.ok(claude.spawned.some((line) => line.startsWith('/bin/sh -c cat | exec /usr/bin/script')));
  // Cached for 15 minutes: no second pty run.
  const count = claude.spawned.length;
  assert.equal((await usage.read()).ok, true);
  assert.equal(claude.spawned.length, count);
});

test('not logged in, not installed and network problems come back as clear states', async () => {
  const loggedOut = fakeClaude({ loggedIn: false, screens: [] });
  assert.deepEqual(await service(loggedOut).usage.read(), { ok: false, error: 'login_required' });
  assert.ok(!loggedOut.spawned.some((line) => line.includes('/usr/bin/script')), 'no pty run when logged out');

  assert.deepEqual(await service(fakeClaude({ screens: [] }), { locate: () => null }).usage.read(), { ok: false, error: 'not_installed' });

  const offline = fakeClaude({ screens: [{ output: 'Unable to connect to Anthropic services\r\nUNABLE_TO_GET_ISSUER_CERT_LOCALLY' }] });
  assert.deepEqual(await service(offline).usage.read(), { ok: false, error: 'network' });

  const wizard = fakeClaude({ screens: [{ output: 'Select login method:\r\n❯ 1. Claude account with subscription' }] });
  assert.deepEqual(await service(wizard).usage.read(), { ok: false, error: 'login_required' });
});
