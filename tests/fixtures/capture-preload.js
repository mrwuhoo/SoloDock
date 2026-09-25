// Test-only preload for the quick capture window: records what the page asks the main process to do
// and keeps the main-process events so tests can push them (open, hide, escape).
window.__calls = [];
window.__handlers = {};
window.notchAPI = {
  platform: 'darwin',
  resizeCapture: (height) => { window.__calls.push(['resize', height]); },
  submitCapture: async (entry) => { window.__calls.push(['submit', entry]); return { ok: !window.__submitFails }; },
  cancelCapture: async (reason) => { window.__calls.push(['cancel', reason]); return true; },
  onCaptureOpen: (callback) => { window.__handlers.open = callback; return () => {}; },
  onCaptureHide: (callback) => { window.__handlers.hide = callback; return () => {}; },
  onCaptureEscape: (callback) => { window.__handlers.escape = callback; return () => {}; },
};
