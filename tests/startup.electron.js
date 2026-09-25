const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
// The production bootstrap may inspect encrypted legacy settings on this Mac.
// Use Chromium's test keychain so a regression test never prompts for user keys.
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
fs.writeFileSync(path.join(profile, 'workspace.json'), JSON.stringify({version:1, localStorage:{
  'notch-home-note':'Recovered workspace note',
  'notch-recordings':JSON.stringify([{id:'startup-recording',createdAt:1788709776699,durationMs:1558,transcript:'',audioPath:'recordings/retained.webm',mimeType:'audio/webm',title:'Saved recording',category:'未分类'}]),
}}));
const errors = [];
let indexLoads = 0;
let firstLoadAt = 0;
setTimeout(() => { console.error('Production startup timed out', errors); app.exit(1); }, 25000);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(`${details.message} (${details.sourceId}:${details.lineNumber})`);
  });
  contents.on('did-finish-load', () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    indexLoads += 1;
    if (!firstLoadAt) firstLoadAt = Date.now();
  });
  contents.once('did-finish-load', async () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    // Recovery imports workspace.json asynchronously and then reloads the page.
    // Poll across that reload instead of assuming it finishes within a fixed delay.
    const expected = {home:true,workspace:true,note:'Recovered workspace note',recordings:1};
    const deadline = Date.now() + 20000;
    let state = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (contents.isDestroyed()) break;
      try {
        state = await contents.executeJavaScript(`({home:!!window.NotchHome,workspace:!!window.NotchWorkspace,note:document.getElementById('home-note')?.value ?? '',recordings:document.querySelectorAll('.recording-item').length})`);
      } catch (error) { continue; }
      if (JSON.stringify(state) === JSON.stringify(expected)) break;
    }
    try {
      // Give the recovered page a moment so late console errors are still caught.
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.deepEqual(errors, []);
      assert.deepEqual(state, expected);
      // The preload hydrates the workspace before page scripts run, so recovery must not reload the page.
      assert.equal(indexLoads, 1, `workspace recovery reloaded the page (${indexLoads} loads)`);
      console.log(`Workspace visible ${Date.now() - firstLoadAt}ms after first load`);
      console.log('Production workspace recovery checks passed');
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../main.js');
