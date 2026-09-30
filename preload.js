const { contextBridge, ipcRenderer } = require('electron');

// 所有 on* 订阅统一经此注册，并回传退订函数：渲染层若重新初始化，
// 不退订就会叠加监听器，同一条通知被回调多次。
function subscribe(channel, handler) {
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('notchAPI', {
  platform: process.platform,
  getCodexUsage: () => ipcRenderer.invoke('codex:usage'),
  getClaudeUsage: (options) => ipcRenderer.invoke('claude:usage', options),
  claudeLogin: () => ipcRenderer.invoke('claude:login'),
  getClaudeStatuslineSetup: () => ipcRenderer.invoke('claude:statusline-setup'),
  connectClaude: () => ipcRenderer.invoke('claude:connect'),
  disconnectClaude: () => ipcRenderer.invoke('claude:disconnect'),
  moveToApplications: () => ipcRenderer.invoke('app:move-to-applications'),
  getAiIntegrationStatus: () => ipcRenderer.invoke('ai:integration-status'),
  getAiIntegrationSetup: (tool) => ipcRenderer.invoke('ai:integration-setup', tool),
  finishOnboarding: () => ipcRenderer.invoke('onboarding:done'),
  getResetNews: (force = false) => ipcRenderer.invoke('resets:read', force === true),
  setMode: (mode) => ipcRenderer.invoke('window:set-mode', mode),
  beginCollapse: () => ipcRenderer.invoke('window:begin-collapse'),
  setTab: (tab) => ipcRenderer.invoke('window:set-tab', tab),
  ensureMicrophone: () => ipcRenderer.invoke('media:microphone'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openPrivacySettings: (pane) => ipcRenderer.invoke('shell:open-privacy-settings', pane),
  inspectLink: (url) => ipcRenderer.invoke('links:inspect', url),
  saveRecording: (payload) => ipcRenderer.invoke('recordings:save', payload),
  readRecording: (audioPath) => ipcRenderer.invoke('recordings:read', audioPath),
  deleteRecording: (audioPath) => ipcRenderer.invoke('recordings:delete', audioPath),
  revealRecording: (audioPath) => ipcRenderer.invoke('recordings:reveal', audioPath),
  organizeMaterial: (payload) => ipcRenderer.invoke('smart:organize-material', payload),
  listCredentials: () => ipcRenderer.invoke('credentials:list'),
  getCredential: (id) => ipcRenderer.invoke('credentials:get', id),
  saveCredential: (payload) => ipcRenderer.invoke('credentials:save', payload),
  deleteCredentials: (ids) => ipcRenderer.invoke('credentials:delete-many', ids),
  copyCredential: (id, field) => ipcRenderer.invoke('credentials:copy', { id, field }),
  clearSecretClipboard: () => ipcRenderer.invoke('credentials:clear-clipboard'),
  getVaultStatus: () => ipcRenderer.invoke('vault:status'),
  unlockVault: (method, password) => ipcRenderer.invoke('vault:unlock', { method, password }),
  lockVault: () => ipcRenderer.invoke('vault:lock'),
  touchVault: () => ipcRenderer.invoke('vault:touch'),
  configureVault: (options) => ipcRenderer.invoke('vault:configure', options),
  dismissVaultSetup: () => ipcRenderer.invoke('vault:dismiss-setup'),
  resetVaultPassword: () => ipcRenderer.invoke('vault:reset-password'),
  onVaultChanged: (cb) => subscribe('vault:changed', (event, payload) => cb(payload)),
  getTranscriptionConfig: () => ipcRenderer.invoke('transcription:get-config'),
  setTranscriptionConfig: (config) => ipcRenderer.invoke('transcription:set-config', config),
  startTranscription: () => ipcRenderer.invoke('transcription:start'),
  sendTranscriptionAudio: (bytes) => ipcRenderer.send('transcription:audio', bytes),
  finishTranscription: () => ipcRenderer.invoke('transcription:finish'),
  onTranscriptionEvent: (cb) => subscribe('transcription:event', (event, payload) => cb(payload)),
  listTaskCompletions: () => ipcRenderer.invoke('tasks:recent'),
  scheduleReminders: (items) => ipcRenderer.invoke('reminders:schedule', items),
  scheduleHabitReminders: (items) => ipcRenderer.invoke('habits:schedule', items),
  exportLifeCsv: (csv) => ipcRenderer.invoke('life:export', csv),
  onLogHabit: (cb) => subscribe('app:log-habit', (event, payload) => cb(payload || {})),
  onOpenUsage: (cb) => subscribe('app:open-usage', (event, payload) => cb(payload || {})),
  onReminderFired: (cb) => subscribe('reminder:fired', (event, payload) => cb(payload)),
  scheduleTodoReminders: (items) => ipcRenderer.invoke('todos:schedule-reminders', items),
  notifyPomodoro: (payload) => ipcRenderer.invoke('pomodoro:notify', payload),
  setFocusState: (state) => ipcRenderer.send('focus:state', state),
  onFocusHeld: (cb) => subscribe('focus:held', (event, count) => cb(Number(count) || 0)),
  getEnergyStatus: () => ipcRenderer.invoke('energy:status'),
  takeBreak: () => ipcRenderer.invoke('body:break'),
  notifyReminderInfo: (info) => ipcRenderer.invoke('reminder:info', info),
  onReminderAction: (cb) => subscribe('reminder:action', (event, payload) => cb(payload)),
  setBodySettings: (patch) => ipcRenderer.invoke('settings:set-body', patch),
  onTodoReminder: (cb) => subscribe('todo:reminded', (event, payload) => cb(payload)),
  onEscape: (cb) => subscribe('key:escape', () => cb()),
  onToggleShortcut: (cb) => subscribe('shortcut:toggle-panel', () => cb()),
  getHoverSpaceStatus: () => ipcRenderer.invoke('shortcut:hover-space-status'),
  getAppSettings: () => ipcRenderer.invoke('settings:get'),
  setFeature: (featureId, enabled) => ipcRenderer.invoke('settings:set-feature', { featureId, enabled }),
  setDefaultTab: (tab) => ipcRenderer.invoke('settings:set-default-tab', tab),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('settings:set-auto-launch', enabled === true),
  setPanelShortcut: (accelerator) => ipcRenderer.invoke('settings:set-shortcut', accelerator),
  onAppSettingsChanged: (cb) => subscribe('settings:changed', (event, settings) => cb(settings)),
  onExpandPanel: (cb) => subscribe('app:expand', () => cb()),
  onOpenSettings: (cb) => subscribe('app:open-settings', () => cb()),
  pauseReminders: (choice) => ipcRenderer.invoke('reminders:pause', choice),
  resumeReminders: () => ipcRenderer.invoke('reminders:resume'),
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  loadWorkspaceData: () => ipcRenderer.invoke('workspace:load-data'),
  saveWorkspaceData: (storage) => ipcRenderer.invoke('workspace:save-data', storage),
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  onWorkspaceChanged: (cb) => subscribe('workspace:changed', (event, info) => cb(info)),
  onCollapseRequest: (cb) => subscribe('window:request-collapse', () => cb()),
  getMetrics: () => ipcRenderer.invoke('window:metrics'),
  onMetricsChanged: (cb) =>
    subscribe('window:metrics-changed', (event, metrics) => cb(metrics)),
  writeClipboard: (entry) => ipcRenderer.invoke('clipboard:write', entry),
  readClipboardText: () => ipcRenderer.invoke('clipboard:read-text'),
  pasteClipboard: (entry) => ipcRenderer.invoke('clipboard:paste', entry),
  readClipImage: (imagePath) => ipcRenderer.invoke('clipboard:readImage', imagePath),
  deleteClipImages: (paths) => ipcRenderer.invoke('clipboard:deleteImages', paths),
  onNewClipEntry: (cb) => subscribe('clipboard:new-entry', (evt, entry) => cb(entry)),
  onOpenClip: (cb) => subscribe('app:open-clip', () => cb()),
  onOpenTodo: (cb) => subscribe('app:open-todo', () => cb()),
  // 随手记：面板接收要存的一条；随手记窗口提交、取消、调整高度。
  exportNote: (note) => ipcRenderer.invoke('notes:export', note),
  onCaptureAdd: (cb) => subscribe('capture:add', (event, entry) => cb(entry)),
  setCaptureShortcut: (accelerator) => ipcRenderer.invoke('settings:set-capture-shortcut', accelerator),
  submitCapture: (entry) => ipcRenderer.invoke('capture:submit', entry),
  cancelCapture: (reason) => ipcRenderer.invoke('capture:cancel', reason),
  resizeCapture: (height) => ipcRenderer.send('capture:resize', height),
  onCaptureOpen: (cb) => subscribe('capture:open', (event, payload) => cb(payload)),
  onCaptureHide: (cb) => subscribe('capture:hide', (event, reason) => cb(reason)),
  onCaptureEscape: (cb) => subscribe('capture:escape', () => cb()),
  setNotchStatus: (active) => ipcRenderer.invoke('notch:status', active === true),
  getNeedsYou: () => ipcRenderer.invoke('notch:needs-you:get'),
  onNeedsYou: (cb) => subscribe('notch:needs-you', (event, state) => cb(state)),
  showNotchMenu: (context) => ipcRenderer.invoke('notch:menu', context),
  onNotchMenuAction: (cb) => subscribe('notch:menu-action', (event, payload) => cb(payload)),
  listNotices: () => ipcRenderer.invoke('notices:list'),
  getNoticeSummary: () => ipcRenderer.invoke('notices:summary'),
  readAllNotices: () => ipcRenderer.invoke('notices:read-all'),
  clearNotices: () => ipcRenderer.invoke('notices:clear'),
  actOnNotice: (id, action) => ipcRenderer.invoke('notices:act', { id, action }),
  onNoticesChanged: (cb) => subscribe('notices:changed', (event, summary) => cb(summary)),
  getWorklog: (from, to) => ipcRenderer.invoke('worklog:range', { from, to }),
  clearWorklog: () => ipcRenderer.invoke('worklog:clear'),
  recordTodoDone: (delta) => ipcRenderer.invoke('worklog:todo', delta),
  listFramePhotos: () => ipcRenderer.invoke('frame:list'),
  readFramePhoto: (id, thumb) => ipcRenderer.invoke('frame:read', id, thumb === true),
  addFramePhotos: () => ipcRenderer.invoke('frame:add'),
  deleteFramePhoto: (id) => ipcRenderer.invoke('frame:delete', id),
  onFramePhotosChanged: (cb) => subscribe('frame:changed', (event, payload) => cb(payload)),
  onTaskNotification: (cb) =>
    subscribe('task-notification:show', (event, notification) => cb(notification)),
  onTaskNotificationQueue: (cb) =>
    subscribe('task-notification:queue', (event, count) => cb(count)),
  onTaskNotificationHide: (cb) =>
    subscribe('task-notification:hide', (event, eventId) => cb(eventId)),
  onTaskCompletion: (cb) =>
    subscribe('task-completion:new', (event, notification) => cb(notification)),
  taskNotificationDismissed: (eventId) =>
    ipcRenderer.send('task-notification:dismissed', eventId),
  taskNotificationAction: (eventId, actionId) =>
    ipcRenderer.invoke('task-notification:action', { eventId, actionId }),
  activateTaskNotification: (eventId) =>
    ipcRenderer.invoke('task-notification:activate', eventId),
  taskNotificationHover: (paused) =>
    ipcRenderer.send('task-notification:hover', paused === true),
});

// 在页面脚本运行前把数据文件夹里的工作区写入 LocalStorage（只补缺失的键），
// 并标记本会话已恢复。这样首帧就是完整数据，渲染层的异步恢复只作为兜底。
try {
  if (/\/renderer\/index\.html$/.test(window.location.pathname)
    && window.sessionStorage.getItem('notch-workspace-hydrated') !== '1') {
    const snapshot = ipcRenderer.sendSync('workspace:load-data-sync');
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      Object.entries(snapshot).forEach(([key, value]) => {
        if (typeof value === 'string' && window.localStorage.getItem(key) === null) {
          window.localStorage.setItem(key, value);
        }
      });
      window.sessionStorage.setItem('notch-workspace-hydrated', '1');
    }
  }
} catch (error) {
  // 读取失败时交给渲染层的异步恢复处理。
}
