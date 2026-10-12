// Test-only preload for the break cat window: records what the page asks the main process to do.
window.__calls = [];
window.notchAPI = {
  platform: 'darwin',
  breakCatInteractive: (interactive) => { window.__calls.push(['interactive', interactive]); },
  breakCatDismiss: () => { window.__calls.push(['dismiss']); },
  breakCatLeft: () => { window.__calls.push(['left']); },
};
