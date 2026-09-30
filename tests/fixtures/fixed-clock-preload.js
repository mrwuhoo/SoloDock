// Panel fixture with a fixed clock: 2026-09-29 14:20 local time (it still ticks), so tests that
// group or label things by day don't depend on when they run.
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
