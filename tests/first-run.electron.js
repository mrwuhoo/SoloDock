const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
// A brand-new install through the real main process: empty data folder, no Claude Code or Codex settings yet.
const profile = process.env.TODO_TEST_USER_DATA;
app.commandLine.appendSwitch('user-data-dir', profile);
if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');
// One-click Codex hookup writes ~/.codex/config.toml: point "home" at a throwaway folder.
const fakeHome = path.join(profile, 'home');
fs.mkdirSync(path.join(fakeHome, '.codex'), { recursive: true });
app.setPath('home', fakeHome);
delete process.env.CODEX_HOME;
setTimeout(() => { console.error('First run timed out'); app.exit(1); }, 40000);

app.on('web-contents-created', (_event, contents) => {
  contents.once('did-finish-load', async () => {
    if (!contents.getURL().endsWith('/renderer/index.html')) return;
    try {
      const js = (code) => contents.executeJavaScript(code);
      // Without a Dock icon, and with the collapsed panel the size of the notch, a new user would think
      // nothing opened: the panel opens by itself once, with the guide on its first step.
      assert.equal((await js('window.notchAPI.getAppSettings()')).onboardingPending, true);
      assert.equal(await js(`document.getElementById('onboard').hidden`), true, 'the guide waits for the panel');
      let state = null;
      const end = Date.now() + 10000;
      while (Date.now() < end) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        state = await js(`({ guide: !document.getElementById('onboard').hidden, step: window.NotchOnboarding.state().step })`);
        if (state.guide) break;
      }
      assert.deepEqual(state, { guide: true, step: 1 });

      // 一键接入 Codex: SoloDock's notify line goes above the first table, everything else stays,
      // the original is backed up once and its permissions are kept.
      const file = path.join(fakeHome, '.codex', 'config.toml');
      const own = 'model = "gpt-5"\n\n[projects."/Users/me/app"]\ntrust_level = "trusted"\n';
      fs.writeFileSync(file, own, { mode: 0o644 });
      fs.chmodSync(file, 0o644);
      assert.equal((await js('window.notchAPI.getAiIntegrationStatus()')).codex.connected, false);
      assert.deepEqual(await js('window.notchAPI.connectCodex()'), { ok: true, changed: true });
      const written = fs.readFileSync(file, 'utf8');
      const notify = written.split('\n').find((line) => line.startsWith('notify = '));
      assert.ok(written.endsWith(own));
      assert.ok(written.indexOf(notify) < written.indexOf('[projects'));
      assert.deepEqual(JSON.parse(notify.slice('notify = '.length)).slice(0, 2), ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1']);
      assert.match(notify, /scripts\/codex-notify\.js"\]$/);
      assert.equal(fs.readFileSync(`${file}.before-solodock`, 'utf8'), own);
      assert.equal(fs.statSync(file).mode & 0o777, 0o644, 'file permissions are kept');
      assert.equal((await js('window.notchAPI.getAiIntegrationStatus()')).codex.connected, true);
      assert.deepEqual(await js('window.notchAPI.connectCodex()'), { ok: true, changed: false }, 'connecting twice changes nothing');
      // The user's own notifier is never replaced.
      const theirs = 'notify = ["terminal-notifier", "-message", "done"]\n';
      fs.writeFileSync(file, theirs);
      assert.deepEqual(await js('window.notchAPI.connectCodex()'), { ok: false, error: 'notify_exists' });
      assert.equal(fs.readFileSync(file, 'utf8'), theirs);

      console.log('First run checks passed');
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
});
require('../main.js');
