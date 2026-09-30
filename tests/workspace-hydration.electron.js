const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);

// The preload hydrates LocalStorage from the portable workspace before page
// scripts run. This runs in a hidden window so it does not depend on an
// unlocked screen (the production window only shows after its first paint).
const snapshot = {
  'notch-focus-minutes-v1': '45',
  'notch-recordings': JSON.stringify([{id:'hydrated-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/h.webm',mimeType:'audio/webm',title:'Hydrated recording',category:'未分类'}]),
};

async function main() {
  await app.whenReady();
  let syncReads = 0;
  ipcMain.on('workspace:load-data-sync', (event) => { syncReads += 1; event.returnValue = snapshot; });
  ipcMain.handle('workspace:load-data', () => snapshot);
  ipcMain.handle('workspace:save-data', () => true);
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  let loads = 0;
  window.webContents.on('did-finish-load', () => { loads += 1; });
  try {
    await window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    const state = await window.webContents.executeJavaScript(`({
      focus: document.getElementById('now-duration-readout').textContent,
      recordings: document.querySelectorAll('.recording-item').length,
      hydrated: sessionStorage.getItem('notch-workspace-hydrated'),
    })`);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepEqual(state, { focus: '45:00', recordings: 1, hydrated: '1' });
    assert.equal(loads, 1, 'hydration must not trigger a recovery reload');
    assert.equal(syncReads, 1, 'the preload reads the workspace exactly once per session');

    // Existing local values win over the snapshot, and a reload in the same session does not re-read.
    await window.webContents.executeJavaScript(`document.querySelector('#now-duration [data-minutes="60"]').click()`);
    await window.webContents.reload();
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    const afterReload = await window.webContents.executeJavaScript(`document.getElementById('now-duration-readout').textContent`);
    assert.equal(afterReload, '60:00');
    assert.equal(syncReads, 1);
    console.log('Workspace hydration checks passed');
  } finally { window.destroy(); }
}
main().then(() => app.quit(), (error) => { console.error(error); app.exit(1); });
