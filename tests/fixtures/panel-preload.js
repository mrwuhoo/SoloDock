// Test-only preload for the main panel: a stand-in notchAPI that records calls.
// Known methods behave like the main process; anything else resolves to undefined,
// and on* subscriptions are kept in window.__handlers so tests can push events.
window.__calls = [];
window.__handlers = {};
const known = {
  platform: 'darwin',
  setNotchStatus: async (active) => { window.__calls.push(['status', active]); return active; },
  getNeedsYou: async () => null,
  showNotchMenu: async (context) => { window.__calls.push(['menu', context]); return true; },
  notifyReminderInfo: async (info) => { window.__calls.push(['info', info]); return true; },
  getAppSettings: async () => ({ features: {}, body: { sit: { enabled: true, minutes: 50 }, eye: { enabled: false, minutes: 20 }, offwork: { enabled: false, time: '22:30' } } }),
  getMetrics: async () => ({ stripHeight: 37, menuBarHeight: 37 }),
  listCredentials: async () => ({ ok: true, secureStorage: true, locked: Boolean(window.__vaultLocked), items: window.__vaultLocked ? [] : (window.__credentials || []) }),
  copyCredential: async (id, field) => { window.__calls.push(['copy-credential', id, field]); return true; },
  openExternal: async (url) => { window.__calls.push(['open-external', url]); return true; },
  writeClipboard: async (entry) => { window.__calls.push(['write-clipboard', entry]); return true; },
  pasteClipboard: async (entry) => { window.__calls.push(['paste', entry]); return { ok: true, pasted: true }; },
  getVaultStatus: async () => ({ enabled: false, setupSeen: true, locked: false, system: 'touchid', hasPassword: false, autoLockMinutes: 10, lockAt: null, cooldownUntil: 0, attemptsLeft: 5 }),
  listTaskCompletions: async () => [],
  listFramePhotos: async () => [],
  scheduleReminders: async () => true,
  scheduleTodoReminders: async () => ({ ok: true }),
  // Notice center: a tiny in-memory store the tests fill through window.__notices.
  listNotices: async () => {
    const items = window.__notices || [];
    return { items, summary: { unread: items.filter((item) => !item.read).length, needsYou: items.filter((item) => item.source === 'needs-you' && !item.handled).length } };
  },
  readAllNotices: async () => { (window.__notices || []).forEach((item) => { item.read = true; }); window.__calls.push(['read-all']); return true; },
  clearNotices: async () => { window.__notices = []; window.__calls.push(['clear']); return true; },
  // Time page: days the tests put in window.__worklog.
  getWorklog: async (from, to) => {
    window.__calls.push(['worklog', from, to]);
    const days = Object.fromEntries(Object.entries(window.__worklog || {}).filter(([key]) => key >= from && key <= to));
    return { ok: true, enabled: window.__worklogEnabled !== false, days, recordedDays: Object.keys(window.__worklog || {}).length };
  },
  actOnNotice: async (id, action) => {
    window.__calls.push(['act', id, action]);
    const item = (window.__notices || []).find((entry) => entry.id === id);
    if (item && action !== 'open') item.handled = true;
    return { ok: action !== 'open' || Boolean(window.__openWorks), error: action === 'open' && !window.__openWorks ? 'window_not_found' : undefined };
  },
};
window.notchAPI = new Proxy(known, {
  get(target, key) {
    if (key in target) return target[key];
    if (typeof key === 'string' && key.startsWith('on')) {
      return (callback) => {
        (window.__handlers[key] = window.__handlers[key] || []).push(callback);
        return () => {};
      };
    }
    if (typeof key !== 'string' || key === 'then') return undefined;
    return async () => undefined;
  },
});
