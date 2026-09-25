#!/usr/bin/env node
'use strict';

// Claude Code 状态栏命令：把状态栏输入里的额度窗口（rate_limits）转发给 SoloDock，
// 再输出一行状态栏文字。只转发 five_hour / seven_day 的已用百分比与重置时间；
// 会话、路径、模型等字段不会离开本机进程。任何失败都静默忽略，不能拖慢状态栏。
//
// 用法（~/.claude/settings.json）：
//   "statusLine": { "type": "command", "command": "node /path/to/claude-statusline.js" }
// 已有自己的状态栏命令时，把它接在 --then 后面，状态栏继续显示原来的内容：
//   "command": "node /path/to/claude-statusline.js --then 'your-existing-command'"

const http = require('node:http');
const { spawn } = require('node:child_process');

const NOTCH_HOST = '127.0.0.1';
const NOTCH_PORT = 43821;
const REQUEST_TIMEOUT_MS = 400;
const STDIN_TIMEOUT_MS = 1000;
const CHAIN_TIMEOUT_MS = 2000;

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(finish, STDIN_TIMEOUT_MS);
    timer.unref();
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
  });
}

function pickRateLimits(input) {
  const limits = input && typeof input === 'object' ? input.rate_limits : null;
  if (!limits || typeof limits !== 'object') return null;
  const window = (raw) => (raw && typeof raw === 'object' && Number.isFinite(Number(raw.used_percentage))
    ? { used_percentage: Number(raw.used_percentage), resets_at: raw.resets_at ?? null }
    : undefined);
  const picked = { five_hour: window(limits.five_hour), seven_day: window(limits.seven_day) };
  return picked.five_hour || picked.seven_day ? picked : null;
}

function forward(rateLimits) {
  return new Promise((resolve) => {
    if (!rateLimits) {
      resolve();
      return;
    }
    const body = JSON.stringify({ rate_limits: rateLimits });
    const request = http.request({
      host: NOTCH_HOST,
      port: NOTCH_PORT,
      path: '/usage/claude',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: REQUEST_TIMEOUT_MS,
    }, (response) => {
      response.resume();
      response.on('end', resolve);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve());
    request.on('close', () => resolve());
    request.end(body);
  });
}

function remaining(window) {
  return window ? `${Math.max(0, Math.round(100 - window.used_percentage))}%` : '';
}

function ownStatusLine(input, rateLimits) {
  const parts = [];
  const model = input && input.model && (input.model.display_name || input.model.id);
  if (model) parts.push(String(model));
  if (rateLimits && rateLimits.five_hour) parts.push(`5h 剩 ${remaining(rateLimits.five_hour)}`);
  if (rateLimits && rateLimits.seven_day) parts.push(`周 剩 ${remaining(rateLimits.seven_day)}`);
  return parts.join(' · ') || 'SoloDock';
}

function runChained(command, raw) {
  return new Promise((resolve) => {
    let output = '';
    let child;
    try {
      child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch (error) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => { child.kill(); resolve(output || null); }, CHAIN_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => { clearTimeout(timer); resolve(output); });
    child.stdin.on('error', () => {});
    child.stdin.end(raw);
  });
}

async function main() {
  const raw = await readStdin();
  let input = null;
  try { input = raw.trim() ? JSON.parse(raw) : null; } catch (error) { input = null; }
  const rateLimits = pickRateLimits(input);
  const thenIndex = process.argv.indexOf('--then');
  const chained = thenIndex > -1 ? process.argv.slice(thenIndex + 1).join(' ').trim() : '';
  const [, chainedOutput] = await Promise.all([
    forward(rateLimits),
    chained ? runChained(chained, raw) : Promise.resolve(null),
  ]);
  process.stdout.write(chainedOutput !== null && chainedOutput !== undefined && chainedOutput !== ''
    ? String(chainedOutput)
    : `${ownStatusLine(input, rateLimits)}\n`);
}

if (require.main === module) {
  main().catch(() => process.stdout.write('SoloDock\n')).finally(() => process.exit(0));
}

module.exports = { pickRateLimits, ownStatusLine };
