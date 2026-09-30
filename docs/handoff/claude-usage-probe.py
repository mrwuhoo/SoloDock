#!/usr/bin/env python3
"""只读验证：用伪终端启动本机 claude，输入 /usage，读出额度后退出。

用法：python3 probe.py <claude 可执行文件> <工作文件夹> <原始输出保存路径>
"""
import json
import os
import pty
import re
import select
import signal
import subprocess
import sys
import time

binary, workdir, raw_path = sys.argv[1], sys.argv[2], sys.argv[3]

# 干净的环境：像 SoloDock 那样启动，不继承 Claude Code 会话与代理变量；关掉自动更新；
# 让 Node 也信任系统钥匙串里的证书（代理 / 安全软件装的根证书），和浏览器、桌面 App 一致。
env = {k: v for k, v in os.environ.items()
       if not (k.startswith('CLAUDE') or k.startswith('ANTHROPIC') or k.upper() in ('HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'ALL_PROXY'))}
env.update({'TERM': 'xterm-256color', 'COLUMNS': '120', 'LINES': '45', 'DISABLE_AUTOUPDATER': '1'})
env['NODE_OPTIONS'] = (env.get('NODE_OPTIONS', '') + ' --use-system-ca').strip()

try:
    node_version = subprocess.run(['node', '--version'], capture_output=True, text=True, env=env, timeout=10).stdout.strip()
except Exception as error:  # noqa: BLE001
    node_version = f'unknown ({error})'
print('诊断:', json.dumps({'node': node_version, 'env_set': sorted(k for k in os.environ if k.upper() in ('HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'))}, ensure_ascii=False), flush=True)

ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]')


def clean(data):
    return ANSI.sub('', data.decode('utf-8', 'replace')).replace('\r', '\n')


pid, fd = pty.fork()
if pid == 0:
    os.chdir(workdir)
    os.execve(binary, [binary], env)

buffer = b''
started = time.time()
log = []


def save():
    with open(raw_path, 'wb') as file:
        file.write(buffer)


def pump(seconds):
    """读屏幕 seconds 秒；子进程结束返回 False。"""
    global buffer
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if fd in ready:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                return False
            if not chunk:
                return False
            buffer += chunk
    return True


def wait_for(pattern, seconds, since=0):
    end = time.time() + seconds
    while time.time() < end:
        if re.search(pattern, clean(buffer[since:]), re.I):
            return True
        if not pump(0.5):
            return False
    return False


def send(data):
    try:
        os.write(fd, data)
        return True
    except OSError:
        return False


def finish(result):
    """先保存、打印，再收尾：退出时一直读屏幕，claude 不走就强制结束，不死等。"""
    save()
    print(json.dumps({**result, 'log': log, 'elapsed': round(time.time() - started, 1)}, ensure_ascii=False, indent=1), flush=True)
    send(b'\x1b')
    pump(0.8)
    send(b'/exit\r')
    pump(3)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            done = pid
        if done:
            break
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            break
        pump(2)
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        os.waitpid(pid, os.WNOHANG)
    except ChildProcessError:
        pass
    save()
    sys.exit(0)


def on_alarm(signum, frame):
    log.append('总超时 120 秒')
    finish({'ok': False, 'reason': 'timeout', 'screen_tail': tail()})


def tail(count=25):
    lines = [line.strip() for line in clean(buffer).split('\n') if line.strip()]
    return lines[-count:]


signal.signal(signal.SIGALRM, on_alarm)
signal.alarm(120)

CERT = r'UNABLE_TO_GET_ISSUER_CERT|certificate|Unable ?to ?connect'
pump(4)
if re.search(CERT, clean(buffer), re.I):
    log.append('启动时就连不上 Anthropic（证书 / 网络）')
    finish({'ok': False, 'reason': 'network', 'screen_tail': tail()})
# 首次使用的确认画面：选主题、安全提示回车接受默认；「是否信任文件夹」这一版默认选中的是「No, exit」，
# 要先用方向键把光标移到「Yes, I trust this folder」、确认光标在 Yes 上才回车；看到登录选择说明还没登录。
# 每一轮只看上一次按键之后新输出的画面，免得对着旧画面反复按键。
READY = r'for shortcuts|\? for|Try "'
DOWN, UP = b'\x1b[B', b'\x1b[A'
ready = False
since_key = max(0, len(buffer) - 6000)
arrow_tries = 0
for step in range(14):
    recent = clean(buffer[since_key:])
    if re.search(r'Select ?login ?method', recent, re.I):
        log.append('终端版 claude 还没登录')
        finish({'ok': False, 'reason': 'not_logged_in', 'screen_tail': tail(8)})
    if re.search(r'trust ?this ?folder|you ?trust\?', recent, re.I):
        pointer = recent.rfind('❯')
        choice = recent[pointer:pointer + 40] if pointer >= 0 else ''
        if re.match(r'❯\s*(?:\d\.\s*)?Yes', choice):
            log.append('信任文件夹：光标在 Yes → 回车')
            since_key = len(buffer)
            send(b'\r')
            pump(3)
            continue
        if arrow_tries >= 4:
            log.append('信任文件夹：没能把光标移到 Yes，放弃')
            finish({'ok': False, 'reason': 'trust_prompt', 'screen_tail': tail(14)})
        key = DOWN if arrow_tries % 2 == 0 else UP
        arrow_tries += 1
        log.append(f'信任文件夹：光标在 {choice[1:14].strip()!r} → {"↓" if key == DOWN else "↑"}')
        since_key = len(buffer)
        send(key)
        pump(1.5)
        continue
    if re.search(READY, recent, re.I):
        ready = True
        break
    if re.search(r'Choose ?the ?text ?style|Press ?Enter ?to ?continue|Enter ?to ?confirm', recent, re.I):
        log.append(f'首次画面 {step + 1} → 回车')
        since_key = len(buffer)
        send(b'\r')
        pump(3)
        continue
    if not pump(2):
        break
if not ready:
    ready = wait_for(READY, 15)
log.append(f'输入框就绪={ready}（{time.time() - started:.1f}s）')
if re.search(CERT, clean(buffer), re.I):
    finish({'ok': False, 'reason': 'network', 'screen_tail': tail()})

mark = len(buffer)
send(b'/usage')
pump(1.5)
send(b'\r')
seen = wait_for(r'% ?used|Resets|resets', 30, since=mark)
pump(3)
log.append(f'看到额度={seen}（{time.time() - started:.1f}s）')
usage_text = clean(buffer[mark:])
keep = re.compile(r'used|Resets|resets|session|week|Opus|Sonnet|Fable|limit|loading|Current|error|rate|subscription|plan', re.I)
lines = []
for line in (item.strip() for item in usage_text.split('\n')):
    if line and keep.search(line) and line not in lines:
        lines.append(line)
finish({'ok': seen, 'usage_lines': lines[-40:], **({} if seen else {'screen_tail': tail()})})
