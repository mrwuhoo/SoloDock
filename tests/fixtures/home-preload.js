// Home page tests: the clock is fixed at 2026-09-29 14:20 (it still ticks), then the panel fixture
// loads; the energy status comes from window.__energy.
const RealDate = Date;
const offset = new RealDate(2026, 8, 29, 14, 20, 0).getTime() - RealDate.now();
class FixedDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...args);
  }
  static now() { return RealDate.now() + offset; }
}
window.Date = FixedDate;
require('./panel-preload.js');

window.__energy = { activeSince: Date.now() - 48 * 60000, breakMinutes: 50, offwork: { enabled: true, time: '22:30' }, worklogEnabled: true, held: 0 };
window.__focus = [];
Object.assign(window.notchAPI, {
  getEnergyStatus: async () => ({ ...window.__energy }),
  takeBreak: async () => { window.__calls.push(['take-break']); return true; },
  setFocusState: (state) => { window.__focus.push(state); },
  notifyPomodoro: async (payload) => { window.__calls.push(['pomodoro', payload]); return { ok: true }; },
});
