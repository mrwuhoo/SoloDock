// Home page tests: the clock is fixed at 2026-09-29 14:20 (it still ticks) by the fixed-clock
// panel fixture; the energy status comes from window.__energy.
require('./fixed-clock-preload.js');

window.__energy = { activeSince: Date.now() - 48 * 60000, breakMinutes: 50, offwork: { enabled: true, time: '22:30' }, worklogEnabled: true, held: 0 };
window.__focus = [];
Object.assign(window.notchAPI, {
  getEnergyStatus: async () => ({ ...window.__energy }),
  takeBreak: async () => { window.__calls.push(['take-break']); return true; },
  setFocusState: (state) => { window.__focus.push(state); },
  notifyPomodoro: async (payload) => { window.__calls.push(['pomodoro', payload]); return { ok: true }; },
});
