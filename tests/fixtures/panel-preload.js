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
  listCredentials: async () => ({ ok: true, secureStorage: true, locked: false, items: [] }),
  getVaultStatus: async () => ({ enabled: false, setupSeen: true, locked: false, system: 'touchid', hasPassword: false, autoLockMinutes: 10, lockAt: null, cooldownUntil: 0, attemptsLeft: 5 }),
  listTaskCompletions: async () => [],
  listFramePhotos: async () => [],
  scheduleReminders: async () => true,
  scheduleTodoReminders: async () => ({ ok: true }),
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
