// AI subscriptions shown on the home "AI 用量" card: pure helpers shared by the renderer and tests.
// Codex and Claude can report quotas; any other subscription only has a plan and a renewal day.
(function exposeAiUsageDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchAiUsage = api;
})(typeof window !== 'undefined' ? window : globalThis, function createAiUsageDomain() {
  const MAX_ON_HOME = 3;
  const MAX_MANUAL = 8;
  const BUILTIN = [
    { id: 'codex', kind: 'codex', name: 'Codex', mark: 'Cx' },
    { id: 'claude', kind: 'claude', name: 'Claude', mark: 'C' },
  ];
  const clean = (value, limit) => Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim())
    .slice(0, limit).join('');
  const renewalDay = (value) => {
    const day = Math.floor(Number(value));
    return day >= 1 && day <= 31 ? day : null;
  };

  // Codex is on by default (it was the only provider before); Claude waits until the user turns it on.
  function normalizeSubscriptions(value) {
    const saved = Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
    const byId = new Map(saved.map((item) => [String(item.id || ''), item]));
    const ordered = [];
    const seen = new Set();
    saved.forEach((item) => {
      const id = String(item.id || '');
      if (!id || seen.has(id)) return;
      const builtin = BUILTIN.find((entry) => entry.id === id);
      if (builtin) {
        ordered.push({
          ...builtin,
          plan: clean(item.plan, 16),
          renewalDay: renewalDay(item.renewalDay),
          enabled: item.enabled !== false,
        });
        seen.add(id);
        return;
      }
      if (!/^manual-[a-z0-9-]{1,40}$/.test(id) || ordered.filter((entry) => entry.kind === 'manual').length >= MAX_MANUAL) return;
      const name = clean(item.name, 16);
      if (!name) return;
      ordered.push({
        id,
        kind: 'manual',
        name,
        mark: Array.from(name)[0].toUpperCase(),
        plan: clean(item.plan, 16),
        renewalDay: renewalDay(item.renewalDay),
        enabled: item.enabled !== false,
      });
      seen.add(id);
    });
    BUILTIN.forEach((builtin) => {
      if (seen.has(builtin.id)) return;
      const savedEntry = byId.get(builtin.id);
      ordered.push({
        ...builtin,
        plan: clean(savedEntry && savedEntry.plan, 16),
        renewalDay: renewalDay(savedEntry && savedEntry.renewalDay),
        enabled: builtin.id === 'codex',
      });
    });
    return ordered;
  }

  function homeSubscriptions(subscriptions) {
    return normalizeSubscriptions(subscriptions).filter((item) => item.enabled).slice(0, MAX_ON_HOME);
  }

  function daysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  // Next renewal for a monthly subscription billed on `day` (clamped to short months).
  function renewalInfo(day, now = Date.now()) {
    const value = renewalDay(day);
    if (!value) return null;
    const current = new Date(Number(now));
    const today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
    const at = (year, month) => new Date(year, month, Math.min(value, daysInMonth(year, month)));
    let next = at(today.getFullYear(), today.getMonth());
    if (next < today) next = at(today.getFullYear(), today.getMonth() + 1);
    const previous = at(next.getFullYear(), next.getMonth() - 1);
    const daysLeft = Math.round((next - today) / 86400000);
    const cycleDays = Math.max(1, Math.round((next - previous) / 86400000));
    return {
      date: next.getTime(),
      daysLeft,
      label: `${next.getMonth() + 1}月${next.getDate()}日`,
      progress: Math.max(0, Math.min(1, 1 - daysLeft / cycleDays)),
    };
  }

  function until(time, now = Date.now()) {
    const minutes = Math.ceil((time - now) / 60000);
    if (minutes <= 0) return '等待刷新';
    if (minutes < 60) return `${minutes} 分钟后`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}后`;
    return `${Math.floor(minutes / 1440)} 天后`;
  }

  function clock(time) {
    const date = new Date(time);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  // The tightest non-expired window decides the headline number.
  function claudeSummary(snapshot, now = Date.now()) {
    if (!snapshot || snapshot.ok === false) return { state: 'disconnected' };
    const windows = [
      ['fiveHour', '5 小时', snapshot.fiveHour],
      ['sevenDay', '本周', snapshot.sevenDay],
    ].map(([key, label, raw]) => {
      if (!raw || !Number.isFinite(raw.usedPercent)) return null;
      if (raw.resetsAt && raw.resetsAt <= now) return { key, label, remaining: null, resetsAt: raw.resetsAt, expired: true };
      return { key, label, remaining: Math.max(0, Math.min(100, 100 - raw.usedPercent)), resetsAt: raw.resetsAt || null, expired: false };
    }).filter(Boolean);
    const live = windows.filter((item) => item.remaining !== null);
    if (!live.length) return { state: 'stale', windows, receivedAt: snapshot.receivedAt || null };
    const primary = live.reduce((low, item) => (item.remaining < low.remaining ? item : low));
    const secondary = live.find((item) => item !== primary) || null;
    return { state: 'ready', primary, secondary, windows, receivedAt: snapshot.receivedAt || null };
  }

  function level(remaining) {
    if (!Number.isFinite(remaining)) return 'unknown';
    if (remaining <= 5) return 'critical';
    if (remaining <= 20) return 'low';
    return 'normal';
  }

  return {
    MAX_ON_HOME,
    MAX_MANUAL,
    normalizeSubscriptions,
    homeSubscriptions,
    renewalInfo,
    claudeSummary,
    until,
    clock,
    level,
  };
});
