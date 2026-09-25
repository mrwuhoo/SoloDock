// 通知中心：记下每一条提醒，找回错过的，尤其是 AI 的「需要你确认」。保存在 userData/notices.json，默认保留 7 天。
const fs = require('fs');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NOTICES = 300;
const WRITE_DELAY_MS = 400;
// 只是回执或本身就是汇总的提醒不进通知中心；护眼是 20 秒的安静提示，也不需要找回。
const SKIPPED_SOURCES = new Set(['info', 'eye', 'focus-summary']);

const clean = (value, limit) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit);

// 稍后提醒和专注结束后补发的提醒，与原始那条是同一件事。
function baseNoticeId(eventId) {
  return String(eventId || '').split('-snoozed-')[0].replace(/-after-focus$/, '');
}

function normalizeNotice(value) {
  if (!value || typeof value !== 'object') return null;
  const id = clean(value.id, 120);
  const at = Number(value.at);
  if (!id || !Number.isFinite(at)) return null;
  return {
    id,
    source: clean(value.source, 32) || 'task',
    agent: clean(value.agent, 32),
    title: clean(value.title, 120) || '提醒',
    detail: clean(value.detail, 200),
    project: clean(value.project, 80),
    taskId: clean(value.taskId, 160),
    at,
    read: value.read === true,
    handled: value.handled === true,
  };
}

function createNoticeStore({ file, now = Date.now, onChange = () => {} }) {
  let items = read();
  let writeTimer = null;

  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return (Array.isArray(parsed.items) ? parsed.items : []).map(normalizeNotice).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function prune() {
    const cutoff = now() - RETENTION_MS;
    items = items.filter((item) => item.at >= cutoff).sort((left, right) => right.at - left.at).slice(0, MAX_NOTICES);
  }

  function flush() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = null;
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, items }), { mode: 0o600 });
      fs.renameSync(temporary, file);
    } catch (error) {
      try { fs.unlinkSync(temporary); } catch (unlinkError) {}
    }
  }

  function changed() {
    if (writeTimer) clearTimeout(writeTimer);
    writeTimer = setTimeout(flush, WRITE_DELAY_MS);
    writeTimer.unref?.();
    onChange(summary());
  }

  function summary() {
    return {
      unread: items.filter((item) => !item.read).length,
      needsYou: items.filter((item) => item.source === 'needs-you' && !item.handled).length,
    };
  }

  function add(notification) {
    if (!notification || SKIPPED_SOURCES.has(notification.source)) return null;
    const id = baseNoticeId(notification.eventId);
    if (!id || id !== String(notification.eventId || '')) return null; // 补发的不重复记录
    const item = normalizeNotice({
      id,
      source: notification.source,
      agent: notification.agent,
      title: notification.title,
      detail: notification.detail || notification.project,
      project: notification.project,
      taskId: notification.taskId,
      at: Number(notification.completedAt) || now(),
    });
    if (!item) return null;
    items = [item, ...items.filter((existing) => existing.id !== id)];
    prune();
    changed();
    return item;
  }

  function markHandled(eventId) {
    const id = baseNoticeId(eventId);
    let hit = false;
    items = items.map((item) => {
      if (item.id !== id || item.handled) return item;
      hit = true;
      return { ...item, handled: true, read: true };
    });
    if (hit) changed();
    return hit;
  }

  // Claude 继续干活（或你已经处理），这一个 agent 待确认的事件都算处理完了。
  function resolveNeedsYou(agent = '') {
    let hit = false;
    items = items.map((item) => {
      if (item.source !== 'needs-you' || item.handled || (agent && item.agent !== agent)) return item;
      hit = true;
      return { ...item, handled: true };
    });
    if (hit) changed();
    return hit;
  }

  function markAllRead() {
    if (!items.some((item) => !item.read)) return false;
    items = items.map((item) => ({ ...item, read: true }));
    changed();
    return true;
  }

  function clear() {
    items = [];
    changed();
  }

  function list() {
    prune();
    return items.map((item) => ({ ...item }));
  }

  function get(id) {
    const found = items.find((item) => item.id === baseNoticeId(id));
    return found ? { ...found } : null;
  }

  prune();
  return { add, markHandled, resolveNeedsYou, markAllRead, clear, list, get, summary, flush };
}

module.exports = { createNoticeStore, baseNoticeId, RETENTION_MS, MAX_NOTICES };
