// 工作时间记录：每 30 秒根据系统空闲时间记一段「在用电脑 / 专注」，存在 userData/worklog.json。
// 不记录应用名、窗口标题、网址或任何内容；离开电脑 5 分钟以上、锁屏、休眠都不计；默认保留 13 个月。
const fs = require('fs');
const { dayKey, dayStart, addInterval } = require('./renderer/worklog-domain');

const IDLE_BREAK_MS = 5 * 60 * 1000;
const SAMPLE_GAP_MS = 90 * 1000; // 两次采样间隔超过这个数（睡眠、卡顿），只记最近 30 秒
const SAMPLE_MS = 30 * 1000;
const RETENTION_MONTHS = 13;
const WRITE_DELAY_MS = 60 * 1000;

function createWorklogStore({ file, now = Date.now }) {
  let days = read();
  let lastSampleAt = 0;
  let writeTimer = null;

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed.days === 'object' && parsed.days ? parsed.days : {};
    } catch (error) {
      return {};
    }
  }

  function flush() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null;
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, days }), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch (unlinkError) {}
    }
  }

  function scheduleWrite() {
    if (writeTimer) return;
    writeTimer = setTimeout(flush, WRITE_DELAY_MS);
    writeTimer.unref?.();
  }

  function day(key) {
    if (!days[key]) days[key] = { runs: [] };
    return days[key];
  }

  function prune() {
    const cutoff = new Date(now());
    cutoff.setMonth(cutoff.getMonth() - RETENTION_MONTHS);
    const oldest = dayKey(cutoff.getTime());
    for (const key of Object.keys(days)) if (key < oldest) delete days[key];
  }

  // 一段时间跨过 04:00 时拆到两天。
  function addSpan(start, end, kind) {
    let from = start;
    while (from < end) {
      const key = dayKey(from);
      const next = dayStart(key) + 24 * 3600 * 1000;
      const to = Math.min(end, next);
      day(key).runs = addInterval(day(key).runs, from, to, kind);
      from = to;
    }
  }

  function record(idleMs, focusing, time = now()) {
    if (idleMs >= IDLE_BREAK_MS) {
      lastSampleAt = 0;
      return false;
    }
    const start = lastSampleAt && time - lastSampleAt <= SAMPLE_GAP_MS ? lastSampleAt : time - SAMPLE_MS;
    lastSampleAt = time;
    addSpan(start, time, focusing ? 'focus' : 'active');
    scheduleWrite();
    return true;
  }

  // 锁屏、休眠：下一次采样重新开始，不把中间的时间算进去。
  function pause() {
    lastSampleAt = 0;
  }

  function bump(field, delta = 1, time = now()) {
    const target = day(dayKey(time));
    target[field] = Math.max(0, (Number(target[field]) || 0) + delta);
    scheduleWrite();
  }

  function range(fromKey, toKey) {
    prune();
    const result = {};
    for (const [key, value] of Object.entries(days)) {
      if (key >= fromKey && key <= toKey) result[key] = JSON.parse(JSON.stringify(value));
    }
    return result;
  }

  function clear() {
    days = {};
    lastSampleAt = 0;
    flush();
  }

  prune();
  return { record, pause, bump, range, clear, flush, recordedDays: () => Object.keys(days).filter((key) => days[key].runs.length).length };
}

module.exports = { createWorklogStore, IDLE_BREAK_MS, RETENTION_MONTHS };
