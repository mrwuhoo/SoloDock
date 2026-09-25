// Test-only preload for the reminder window: records what the page asks the main process to do.
window.__calls = [];
window.notchAPI = {
  platform: 'darwin',
  taskNotificationAction: async (eventId, actionId) => { window.__calls.push(['action', eventId, actionId]); return true; },
  activateTaskNotification: async (eventId) => { window.__calls.push(['activate', eventId]); return true; },
  taskNotificationHover: (paused) => { window.__calls.push(['hover', paused]); },
  taskNotificationDismissed: (eventId) => { window.__calls.push(['dismissed', eventId]); },
};
