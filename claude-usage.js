// 只读获取 Claude 订阅额度：在专用文件夹里用伪终端启动用户自己的终端版 claude，输入 /usage，
// 把界面还原成真实屏幕后读出「当前 5 小时」「本周」等额度窗口，然后退出。
// 不读取、不复制任何登录凭据（查询由 Claude Code 自己完成），/usage 不调用模型、不消耗额度。
// Claude Code 的界面靠光标定位来画，直接去掉控制符会丢字，所以这里带一个很小的虚拟终端。
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCREEN_COLS = 120;
const SCREEN_ROWS = 60;

// ============ 虚拟终端 ============
// 只实现 Claude Code（Ink）实际用到的部分：光标移动与定位、清行清屏、滚动区、备用屏幕、保存 / 恢复光标。
// 颜色、键盘协议、设备查询等一律忽略。

function charWidth(code) {
  if (code === 0) return 0;
  if (code < 0x1100) return 1;
  if ((code >= 0x1100 && code <= 0x115f) || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6) || (code >= 0x1f300 && code <= 0x1f64f) || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x20000 && code <= 0x3fffd)) return 2;
  return 1;
}

function createScreen({ cols = SCREEN_COLS, rows = SCREEN_ROWS } = {}) {
  const blank = () => Array.from({ length: cols }, () => ' ');
  let main = Array.from({ length: rows }, blank);
  let alternate = null;
  let lines = main;
  let row = 0;
  let col = 0;
  let top = 0;
  let bottom = rows - 1;
  let saved = { row: 0, col: 0 };
  let pendingWrap = false;
  let state = 'text';
  let sequence = '';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function scrollUp(count = 1) {
    for (let index = 0; index < count; index += 1) {
      lines.splice(top, 1);
      lines.splice(bottom, 0, blank());
    }
  }

  function scrollDown(count = 1) {
    for (let index = 0; index < count; index += 1) {
      lines.splice(bottom, 1);
      lines.splice(top, 0, blank());
    }
  }

  function lineFeed() {
    pendingWrap = false;
    if (row === bottom) scrollUp();
    else row = clamp(row + 1, 0, rows - 1);
  }

  function put(char) {
    const width = charWidth(char.codePointAt(0));
    if (width === 0) return;
    if (pendingWrap || col + width > cols) {
      col = 0;
      lineFeed();
    }
    lines[row][col] = char;
    if (width === 2 && col + 1 < cols) lines[row][col + 1] = '';
    col += width;
    if (col >= cols) {
      col = cols - 1;
      pendingWrap = true;
    }
  }

  function eraseLine(mode, target = row) {
    const line = lines[target];
    const [from, to] = mode === 1 ? [0, col] : mode === 2 ? [0, cols - 1] : [col, cols - 1];
    for (let index = from; index <= to; index += 1) line[index] = ' ';
  }

  function csi(body) {
    const final = body[body.length - 1];
    const raw = body.slice(0, -1);
    const prefix = /^[?<>=]/.test(raw) ? raw[0] : '';
    const params = (prefix ? raw.slice(1) : raw).replace(/[ -/]+$/, '').split(';').map((value) => (value === '' ? NaN : Number(value)));
    const first = Number.isFinite(params[0]) ? params[0] : NaN;
    const count = Number.isFinite(first) && first > 0 ? first : 1;
    if (prefix === '?') {
      if (/^(1049|47|1047)$/.test(String(first))) {
        if (final === 'h' && !alternate) {
          saved = { row, col };
          alternate = Array.from({ length: rows }, blank);
          lines = alternate;
          row = 0; col = 0;
        } else if (final === 'l' && alternate) {
          alternate = null;
          lines = main;
          ({ row, col } = saved);
        }
      }
      return;
    }
    if (prefix) return; // 键盘协议、设备属性等
    pendingWrap = false;
    switch (final) {
      case 'A': row = clamp(row - count, 0, rows - 1); break;
      case 'B': row = clamp(row + count, 0, rows - 1); break;
      case 'C': col = clamp(col + count, 0, cols - 1); break;
      case 'D': col = clamp(col - count, 0, cols - 1); break;
      case 'E': row = clamp(row + count, 0, rows - 1); col = 0; break;
      case 'F': row = clamp(row - count, 0, rows - 1); col = 0; break;
      case 'G': case '`': col = clamp(count - 1, 0, cols - 1); break;
      case 'd': row = clamp(count - 1, 0, rows - 1); break;
      case 'H': case 'f': {
        row = clamp((Number.isFinite(params[0]) && params[0] > 0 ? params[0] : 1) - 1, 0, rows - 1);
        col = clamp((Number.isFinite(params[1]) && params[1] > 0 ? params[1] : 1) - 1, 0, cols - 1);
        break;
      }
      case 'K': eraseLine(Number.isFinite(first) ? first : 0); break;
      case 'J': {
        const mode = Number.isFinite(first) ? first : 0;
        if (mode === 2 || mode === 3) {
          for (let index = 0; index < rows; index += 1) lines[index] = blank();
        } else if (mode === 1) {
          for (let index = 0; index < row; index += 1) lines[index] = blank();
          eraseLine(1);
        } else {
          eraseLine(0);
          for (let index = row + 1; index < rows; index += 1) lines[index] = blank();
        }
        break;
      }
      case 'r': {
        top = clamp((Number.isFinite(params[0]) && params[0] > 0 ? params[0] : 1) - 1, 0, rows - 1);
        bottom = clamp((Number.isFinite(params[1]) && params[1] > 0 ? params[1] : rows) - 1, top, rows - 1);
        row = 0; col = 0;
        break;
      }
      case 'S': scrollUp(count); break;
      case 'T': scrollDown(count); break;
      case 'L': for (let index = 0; index < count; index += 1) { lines.splice(bottom, 1); lines.splice(row, 0, blank()); } break;
      case 'M': for (let index = 0; index < count; index += 1) { lines.splice(row, 1); lines.splice(bottom, 0, blank()); } break;
      case 'P': { const line = lines[row]; line.splice(col, count); while (line.length < cols) line.push(' '); break; }
      case 'X': for (let index = col; index < Math.min(cols, col + count); index += 1) lines[row][index] = ' '; break;
      case 's': saved = { row, col }; break;
      case 'u': ({ row, col } = saved); break;
      default: break; // m（颜色）等
    }
  }

  function write(text) {
    for (const char of String(text)) {
      if (state === 'esc') {
        if (char === '[') { state = 'csi'; sequence = ''; }
        else if (char === ']') { state = 'osc'; sequence = ''; }
        else if (char === '(' || char === ')' || char === '#' || char === '%') state = 'charset';
        else {
          if (char === '7') saved = { row, col };
          else if (char === '8') ({ row, col } = saved);
          else if (char === 'M') { if (row === top) scrollDown(); else row = clamp(row - 1, 0, rows - 1); }
          else if (char === 'D') lineFeed();
          else if (char === 'E') { col = 0; lineFeed(); }
          state = 'text';
        }
        continue;
      }
      if (state === 'charset') { state = 'text'; continue; }
      if (state === 'csi') {
        sequence += char;
        // 参数字节 0x30–0x3F、中间字节 0x20–0x2F，遇到 0x40–0x7E 的结束字节就执行。
        if (char >= '@' && char <= '~') {
          csi(sequence);
          state = 'text';
        } else if (sequence.length > 64) {
          state = 'text';
        }
        continue;
      }
      if (state === 'osc') {
        if (char === '\x07') state = 'text';
        else if (char === '\x1b') state = 'osc-esc';
        continue;
      }
      if (state === 'osc-esc') { state = char === '\\' ? 'text' : 'osc'; continue; }
      if (char === '\x1b') { state = 'esc'; continue; }
      if (char === '\r') { col = 0; pendingWrap = false; continue; }
      if (char === '\n' || char === '\x0b' || char === '\x0c') { lineFeed(); continue; }
      if (char === '\b') { col = Math.max(0, col - 1); pendingWrap = false; continue; }
      if (char === '\t') { col = Math.min(cols - 1, (Math.floor(col / 8) + 1) * 8); continue; }
      if (char < ' ' || char === '\x7f') continue;
      put(char);
    }
  }

  return {
    write,
    text: () => lines.map((line) => line.join('').replace(/\s+$/, '')).join('\n'),
    lines: () => lines.map((line) => line.join('').replace(/\s+$/, '')),
  };
}

// ============ 解析 /usage ============

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// 某个时区里的「年月日 时分」对应的时间戳（不依赖第三方时区库，用 Intl 反推偏移）。
function zonedTimestamp(year, month, day, hour, minute, timeZone) {
  const guess = Date.UTC(year, month, day, hour, minute);
  let offset = 0;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const asZone = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute));
    offset = asZone - guess;
  } catch {
    return null;
  }
  return guess - offset;
}

function zonedParts(time, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(time)).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day) };
}

// 「Resets 12:40am (America/Los_Angeles)」「Resets Oct 6 at 4pm (…)」→ 时间戳；认不出来返回 null。
function parseResetTime(text, now = Date.now()) {
  const match = String(text || '').match(/Resets?\s+(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,)?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:\(([^)]+)\))?/i);
  if (!match) return null;
  const [, monthName, dayText, hourText, minuteText, meridiem, zoneText] = match;
  // 必须有上午 / 下午或分钟，免得把画到一半的「4p」读成凌晨 4 点。
  if (!meridiem && minuteText === undefined) return null;
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (meridiem) {
    hour %= 12;
    if (/pm/i.test(meridiem)) hour += 12;
  }
  if (hour > 23 || minute > 59) return null;
  const timeZone = (zoneText || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC').trim();
  try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { return null; }
  const today = zonedParts(now, timeZone);
  if (monthName) {
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (month === undefined) return null;
    const day = Number(dayText);
    let year = today.year;
    let at = zonedTimestamp(year, month, day, hour, minute, timeZone);
    // 年份没写：已经过去超过一个月就当作明年。
    if (at !== null && at < now - 31 * 86400000) at = zonedTimestamp(year + 1, month, day, hour, minute, timeZone);
    return at;
  }
  let at = zonedTimestamp(today.year, today.month, today.day, hour, minute, timeZone);
  if (at !== null && at <= now) at = zonedTimestamp(today.year, today.month, today.day + 1, hour, minute, timeZone);
  return at;
}

// 从还原后的屏幕里读额度窗口：标题行（Current session / Current week (all models) / Current week (Opus) …）
// 后面紧跟「NN% used」和「Resets …」。按关键词和百分号找，不依赖固定行号。
function parseUsageScreen(text, now = Date.now()) {
  const lines = String(text || '').split('\n').map((line) => line.trim());
  const windows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index].match(/^Current\s+(session|week)\b(?:\s*\(([^)]+)\))?/i);
    if (!title) continue;
    let used = null;
    let resetText = '';
    for (let look = index + 1; look < Math.min(lines.length, index + 5); look += 1) {
      if (/^Current\s+(session|week)\b/i.test(lines[look])) break;
      const percent = lines[look].match(/(\d{1,3}(?:\.\d+)?)\s*%\s*used/i);
      if (percent && used === null) used = Math.max(0, Math.min(100, Number(percent[1])));
      if (/^Resets?\b/i.test(lines[look]) && !resetText) resetText = lines[look];
    }
    if (used === null) continue;
    const kind = title[1].toLowerCase();
    const scope = (title[2] || '').trim();
    const key = kind === 'session' ? 'fiveHour' : /^all/i.test(scope) || !scope ? 'sevenDay' : `sevenDay:${scope.toLowerCase()}`;
    if (windows.some((item) => item.key === key)) continue;
    windows.push({ key, label: kind === 'session' ? '5 小时' : scope && !/^all/i.test(scope) ? `本周 · ${scope}` : '本周', usedPercent: used, resetsAt: parseResetTime(resetText, now), resetText });
  }
  return windows;
}

// 界面是一点点画出来的，某一帧里重置时间可能只画了一半或被别的元素盖住：
// 合并多帧的结果，百分比取最新的，重置时间保留最完整的那一版（带时区括号的优先）。
function mergeUsageWindows(previous, next) {
  const merged = new Map((previous || []).map((item) => [item.key, item]));
  for (const item of next || []) {
    const old = merged.get(item.key);
    const complete = (window) => Boolean(window && window.resetsAt && /\)\s*$/.test(window.resetText || ''));
    const keepOldReset = old && (complete(old) && !complete(item) || (old.resetsAt && !item.resetsAt));
    merged.set(item.key, keepOldReset ? { ...item, resetsAt: old.resetsAt, resetText: old.resetText } : item);
  }
  return [...merged.values()];
}

// 转成和状态栏上报一样的结构，首页、详情浮层和额度提醒都不用改。
function usageSnapshot(windows, now = Date.now()) {
  const pick = (key) => {
    const item = windows.find((window) => window.key === key);
    return item ? { usedPercent: item.usedPercent, resetsAt: item.resetsAt } : null;
  };
  return {
    fiveHour: pick('fiveHour'),
    sevenDay: pick('sevenDay'),
    models: windows.filter((item) => item.key.startsWith('sevenDay:')).map((item) => ({ label: item.label, usedPercent: item.usedPercent, resetsAt: item.resetsAt })),
    receivedAt: now,
    source: 'cli',
  };
}

// ============ 找本机的 claude ============
// 从访达打开的 App 拿不到终端里的 PATH，所以把常见的安装位置写全；只接受绝对路径，不执行 shell。
function findClaude({ platform = process.platform, env = process.env, access = fs.accessSync, home = os.homedir() } = {}) {
  const executable = platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = platform === 'darwin' ? [
    '/opt/homebrew/bin/claude', '/usr/local/bin/claude',
    path.join(home, '.local/bin/claude'), path.join(home, '.claude/local/claude'),
    path.join(home, '.npm-global/bin/claude'), path.join(home, '.bun/bin/claude'), path.join(home, '.volta/bin/claude'),
  ] : [];
  for (const directory of (env.PATH || '').split(platform === 'win32' ? ';' : ':')) {
    if ((platform === 'win32' ? path.win32 : path).isAbsolute(directory)) {
      candidates.push((platform === 'win32' ? path.win32 : path).join(directory, executable));
    }
  }
  return [...new Set(candidates)].find((candidate) => {
    try { access(candidate, fs.constants.X_OK); return true; } catch { return false; }
  }) || null;
}

// npm 装的 claude 是 node 脚本；Node 23.8+ / 22.15+ 才认识 --use-system-ca。
function nodeSupportsSystemCa(version) {
  const match = String(version || '').match(/v?(\d+)\.(\d+)/);
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major >= 24 || (major === 23 && minor >= 8) || (major === 22 && minor >= 15);
}

// 启动 claude 用的环境：不继承 Claude Code 会话、代理和 Electron 的变量；补全 PATH 以便找到 node；
// 关掉自动更新；Node 支持时让它信任系统钥匙串里的证书（代理 / 安全软件装的根证书，和浏览器一致）。
function claudeEnvironment({ executable, baseEnv = process.env, systemCa = false } = {}) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (/^(CLAUDE|ANTHROPIC|ELECTRON_)/.test(key) || /^(https?|all|no)_proxy$/i.test(key)) continue;
    env[key] = value;
  }
  const dirs = [];
  if (executable) {
    dirs.push(path.dirname(executable));
    try { dirs.push(path.dirname(fs.realpathSync(executable))); } catch {}
  }
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', ...String(baseEnv.PATH || '').split(':'));
  env.PATH = [...new Set(dirs.filter((dir) => dir && path.isAbsolute(dir)))].join(':');
  env.TERM = 'xterm-256color';
  env.COLUMNS = String(SCREEN_COLS);
  env.LINES = String(SCREEN_ROWS);
  env.DISABLE_AUTOUPDATER = '1';
  if (systemCa) env.NODE_OPTIONS = `${env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : ''}--use-system-ca`;
  else delete env.NODE_OPTIONS;
  return env;
}

// ============ 首次设置 ============
// 交互界面只要没有 hasCompletedOnboarding，就会从头走首次向导（连已登录的也会问登录方式）。
// 用户已经登录时由 SoloDock 补上这一个标记，免得用户自己去终端里走一遍；别的内容原样保留。
function markOnboarded(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  if (config.hasCompletedOnboarding === true) return config;
  return { ...config, hasCompletedOnboarding: true };
}

function ensureOnboarded({ home = os.homedir(), file = path.join(home, '.claude.json'), fsApi = fs } = {}) {
  let raw;
  try { raw = fsApi.readFileSync(file, 'utf8'); } catch { return 'missing'; }
  let config;
  try { config = JSON.parse(raw); } catch { return 'invalid'; }
  const next = markOnboarded(config);
  if (!next) return 'invalid';
  if (next === config) return 'ok';
  try {
    const backup = `${file}.before-solodock`;
    if (!fsApi.existsSync(backup)) fsApi.writeFileSync(backup, raw, { mode: 0o600 });
    const mode = fsApi.statSync(file).mode & 0o777;
    const temporary = `${file}.solodock-${process.pid}.tmp`;
    fsApi.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode });
    // 写入前再确认文件没在这期间被 Claude Code 改过，改过就放弃，下次再试。
    if (fsApi.readFileSync(file, 'utf8') !== raw) { fsApi.unlinkSync(temporary); return 'busy'; }
    fsApi.renameSync(temporary, file);
    return 'updated';
  } catch {
    return 'failed';
  }
}

// ============ 读取服务 ============
const SUCCESS_TTL_MS = 15 * 60 * 1000; // Anthropic 的用量接口限流很严
const FAILURE_TTL_MS = 2 * 60 * 1000;
const FORCE_MIN_MS = 60 * 1000;
const DOWN = '\x1b[B';
const UP = '\x1b[A';
const READY = /for shortcuts|\? for|Try "|manual mode|←\s*for/i;

function killGroup(child, signal) {
  if (!child || child.exitCode !== null) return;
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}

function run(spawnProcess, executable, args, { env, timeoutMs = 15000, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnProcess(executable, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return resolve({ code: -1, stdout: '' }); }
    let stdout = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: -1, stdout }); }, timeoutMs);
    child.stdout.on('data', (data) => { if (stdout.length < 65536) stdout += data; });
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
  });
}

function createClaudeUsageService({
  spawnProcess = spawn,
  locate = findClaude,
  probeDir = path.join(os.tmpdir(), 'solodock-claude-probe'),
  onboard = ensureOnboarded,
  now = Date.now,
  timeoutMs = 45000,
  settleMs = 900,
  keyGapMs = 700,
  usageWaitMs = 5000,
  baseEnv = process.env,
} = {}) {
  let cached = null;
  let cachedAt = 0;
  let pending = null;
  let disposed = false;
  let activeChild = null;

  async function environment(executable) {
    let systemCa = false;
    try {
      const head = fs.readFileSync(executable, { encoding: 'utf8', flag: 'r' }).slice(0, 64);
      if (/^#!.*\bnode\b/.test(head)) {
        const env = claudeEnvironment({ executable, baseEnv });
        const { stdout } = await run(spawnProcess, 'node', ['--version'], { env, timeoutMs: 5000 });
        systemCa = nodeSupportsSystemCa(stdout.trim());
      }
    } catch {}
    return claudeEnvironment({ executable, baseEnv, systemCa });
  }

  async function authStatus(executable, env) {
    const { code, stdout } = await run(spawnProcess, executable, ['auth', 'status', '--json'], { env, timeoutMs: 20000 });
    if (code === -1) return 'unknown';
    try {
      const status = JSON.parse(stdout);
      if (typeof status.loggedIn === 'boolean') return status.loggedIn ? 'logged_in' : 'logged_out';
    } catch {}
    return 'unknown';
  }

  // 在伪终端里跑一次 /usage。用 macOS 自带的 /usr/bin/script，不需要要重新编译的原生模块。
  // Node 给子进程的输入是 socket，script 把它当终端用会报错，所以中间用 cat 转成普通管道。
  function probe(executable, env) {
    return new Promise((resolve) => {
      try { fs.mkdirSync(probeDir, { recursive: true }); } catch {}
      let child;
      try {
        const inner = `stty rows ${SCREEN_ROWS} cols ${SCREEN_COLS} 2>/dev/null; exec "$0"`;
        child = spawnProcess('/bin/sh', ['-c', `cat | exec /usr/bin/script -q /dev/null /bin/sh -c '${inner}' "$0"`, executable], {
          cwd: probeDir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: true,
        });
      } catch { return resolve({ ok: false, error: 'unavailable' }); }
      activeChild = child;
      const screen = createScreen();
      let stage = 'starting';
      let windows = [];
      let firstSeenAt = 0;
      let arrowTries = 0;
      let lastKeyAt = 0;
      let complete = false;
      let settleTimer = null;
      const send = (text) => { if (!complete) { try { child.stdin.write(text); } catch {} } };
      const finish = (result) => {
        if (complete) return;
        complete = true;
        clearTimeout(overall);
        clearTimeout(settleTimer);
        activeChild = null;
        // 退出时一直在读输出（stdout 处于流动模式），不会和子进程互相卡住；最后连同 cat、script 整组结束。
        try { child.stdin.write('\x1b'); child.stdin.write('/exit\r'); } catch {}
        setTimeout(() => { try { child.stdin.end(); } catch {} killGroup(child, 'SIGTERM'); }, 800).unref?.();
        setTimeout(() => killGroup(child, 'SIGKILL'), 2500).unref?.();
        resolve(result);
      };
      const overall = setTimeout(() => finish(windows.length ? { ok: true, windows } : { ok: false, error: stage === 'usage' ? 'parse_failed' : 'timeout' }), timeoutMs);

      const evaluate = () => {
        if (complete) return;
        const text = screen.text();
        if (/UNABLE_TO_GET_ISSUER_CERT|certificate|Unable to connect to Anthropic/i.test(text)) return finish({ ok: false, error: 'network' });
        if (/Select login method/i.test(text)) return finish({ ok: false, error: 'login_required' });
        if (stage === 'starting') {
          if (/trust this folder|you trust\?/i.test(text) && now() - lastKeyAt >= keyGapMs) {
            const pointer = text.lastIndexOf('❯');
            const choice = pointer >= 0 ? text.slice(pointer, pointer + 40) : '';
            lastKeyAt = now();
            if (/^❯\s*(?:\d\.\s*)?Yes/.test(choice)) send('\r');
            else if (arrowTries >= 4) return finish({ ok: false, error: 'trust_failed' });
            else { send(arrowTries % 2 === 0 ? DOWN : UP); arrowTries += 1; }
            return;
          }
          if (/Choose the text style|Press Enter to continue/i.test(text) && now() - lastKeyAt >= keyGapMs) {
            lastKeyAt = now();
            send('\r');
            return;
          }
          if (READY.test(text) && !/trust this folder|you trust\?/i.test(text)) {
            stage = 'typing';
            send('/usage');
            setTimeout(() => { if (!complete) { stage = 'usage'; send('\r'); } }, Math.min(600, keyGapMs));
          }
          return;
        }
        if (stage === 'usage') {
          if (/rate.?limited|Too many requests/i.test(text) && !/%\s*used/i.test(text)) return finish({ ok: false, error: 'rate_limited' });
          windows = mergeUsageWindows(windows, parseUsageScreen(text, now()));
          if (!windows.length) return;
          if (!firstSeenAt) firstSeenAt = now();
          const allComplete = windows.every((item) => item.resetsAt && /\)\s*$/.test(item.resetText || ''));
          if (allComplete || now() - firstSeenAt > usageWaitMs) finish({ ok: true, windows });
        }
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (data) => {
        screen.write(data);
        // 界面一段一段地画，等输出停一会儿再判断，免得对着画了一半的画面按键。
        clearTimeout(settleTimer);
        settleTimer = setTimeout(evaluate, settleMs);
        if (stage === 'usage') evaluate();
      });
      child.stderr.resume();
      child.on('error', () => finish({ ok: false, error: 'unavailable' }));
      child.on('close', () => finish(windows.length ? { ok: true, windows } : { ok: false, error: 'unavailable' }));
      child.stdin.on('error', () => {});
    });
  }

  async function request() {
    const executable = locate();
    if (!executable) return { ok: false, error: 'not_installed' };
    const env = await environment(executable);
    const auth = await authStatus(executable, env);
    if (auth === 'logged_out') return { ok: false, error: 'login_required' };
    if (auth === 'logged_in') onboard();
    const result = await probe(executable, env);
    if (!result.ok) return result;
    const at = now();
    return { ok: true, updatedAt: at, windows: result.windows, snapshot: usageSnapshot(result.windows, at) };
  }

  return {
    read({ force = false } = {}) {
      if (disposed) return Promise.resolve({ ok: false, error: 'cancelled' });
      if (pending) return pending;
      const age = now() - cachedAt;
      if (cached && (force ? age < FORCE_MIN_MS : age < (cached.ok ? SUCCESS_TTL_MS : FAILURE_TTL_MS))) return Promise.resolve(cached);
      pending = request().catch(() => ({ ok: false, error: 'unavailable' })).then((result) => {
        cached = result;
        cachedAt = now();
        pending = null;
        return result;
      });
      return pending;
    },
    // 用户点「登录 Claude」：由 Claude Code 自己打开浏览器完成登录，SoloDock 不经手任何凭据。
    async login() {
      const executable = locate();
      if (!executable) return { ok: false, error: 'not_installed' };
      const env = await environment(executable);
      const { code } = await run(spawnProcess, executable, ['auth', 'login', '--claudeai'], { env, timeoutMs: 10 * 60 * 1000 });
      cached = null;
      cachedAt = 0;
      return code === 0 ? { ok: true } : { ok: false, error: 'login_failed' };
    },
    invalidate() { cached = null; cachedAt = 0; },
    dispose() {
      disposed = true;
      killGroup(activeChild, 'SIGKILL');
    },
  };
}

module.exports = {
  findClaude,
  nodeSupportsSystemCa,
  claudeEnvironment,
  markOnboarded,
  ensureOnboarded,
  createClaudeUsageService,
  SCREEN_COLS,
  SCREEN_ROWS,
  createScreen,
  parseResetTime,
  parseUsageScreen,
  mergeUsageWindows,
  usageSnapshot,
  zonedTimestamp,
};
