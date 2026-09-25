const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const workspaceJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'workspace.js'), 'utf8');
const effectsJs = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'effects.js'), 'utf8');
const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('clipboard rows define both favorite icons before rendering entries', () => {
  assert.match(appJs, /const starOutlineSvg\s*=/);
  assert.match(appJs, /const starFilledSvg\s*=/);
});

test('notes have a dedicated top-level tab and management panel', () => {
  assert.match(html, /data-tab="notes"/);
  assert.match(html, /id="tab-notes"/);
  assert.match(html, /id="notes-search"/);
  assert.match(html, /id="notes-list"/);
  assert.match(html, /id="notes-detail"/);
});

test('home scratch note keeps only the save action', () => {
  const homeNote = html.match(/<section class="tile home-note"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(homeNote, /id="note-save-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library-btn"/);
  assert.doesNotMatch(homeNote, /id="note-library"/);
});

test('recordings expose in-page API settings and create a live draft while recording', () => {
  assert.match(html, /id="recording-configure"/);
  assert.match(workspaceJs, /function beginRecordingDraft\(\)/);
  assert.match(workspaceJs, /recordingLiveTranscript/);
  assert.match(workspaceJs, /configure-transcription/);
});

test('a live recording can be paused, resumed, and stopped from the recordings tab', () => {
  assert.match(workspaceJs, /recording-live-pause/);
  assert.match(workspaceJs, /recording-live-stop/);
  assert.match(workspaceJs, /togglePauseRecording/);
  assert.match(workspaceJs, /stopRecording/);
});

test('homepage visibility has one storage key, exact validation, and lifecycle events', () => {
  assert.match(appJs, /notch-home-hidden-modules-v1/);
  assert.match(appJs, /validateHomeWidgetLayout/);
  assert.match(appJs, /window\.NotchHome\s*=/);
  assert.match(appJs, /notch:home-modules-changed/);
  assert.match(appJs, /notch:home-layout-error/);
  assert.match(appJs, /new Set\(homeTiles\.map\(\(tile\) => tile\.dataset\.homeModule\)\)/);
});

test('settings exposes exactly one switch for every homepage widget', () => {
  const switches = [...html.matchAll(/data-settings-home-module="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(switches, [
    'note', 'today', 'pomodoro', 'usage', 'mirror', 'recorder', 'windows',
  ]);
  assert.match(workspaceJs, /isRecordingActive/);
  assert.match(workspaceJs, /recording_active/);
  assert.match(workspaceJs, /at_least_one_required/);
});

test('settings exposes every panel tab as a possible default opening page', () => {
  const select = html.match(/<select id="settings-default-tab"[\s\S]*?<\/select>/)?.[0] || '';
  const options = [...select.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(options, [
    'home', 'todo', 'notes', 'links', 'clip', 'credentials', 'time', 'recordings', 'resets', 'settings',
  ]);
  assert.match(workspaceJs, /setDefaultTab/);
});

test('usage belongs to home widgets while reset news is an independent feature', () => {
  const featureList = html.match(/id="settings-feature-list"[\s\S]*?<\/div>/)?.[0] || '';
  const homeList = html.match(/id="settings-home-module-list"[\s\S]*?<\/div>/)?.[0] || '';
  assert.doesNotMatch(featureList, /data-settings-home-module="usage"/);
  assert.match(homeList, /data-settings-home-module="usage"/);
  assert.match(featureList, /data-settings-feature="resets"/);
  assert.match(html, /id="tab-resets"/);
});

test('hidden widgets stop background work and no WebGL effect remains', () => {
  // The Soda Music widget and its WebGL shader were removed in v0.2.
  assert.doesNotMatch(effectsJs, /getContext\(['"]webgl/);
  assert.doesNotMatch(html, /home-music|music-color-bends/);
  assert.match(workspaceJs, /NotchHome\?\.isVisible/);
});

test('the photo frame shows a chosen picture and never opens the camera', () => {
  const frame = html.match(/<section class="tile home-mirror"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(frame, /class="mirror-photo frame-layer/);
  assert.doesNotMatch(frame, /<video|mirror-water-canvas/);
  assert.doesNotMatch(appJs, /getUserMedia\(\s*\{\s*video/);
});

test('startup never asks for system permissions; they are requested in context', () => {
  // A launch-time dialog sent people to a Screen Recording list where SoloDock was not yet
  // registered. Permissions are requested only from the current-windows card.
  assert.doesNotMatch(mainJs, /promptForMissingPermissions/);
  assert.match(mainJs, /ipcMain\.handle\('media:screen-recording'/);
  assert.match(workspaceJs, /requestScreenRecording/);
});

test('tabs sit in two groups on either side of the notch, ordered by weight', () => {
  const primary = html.match(/<div class="tab-group tab-group-primary">[\s\S]*?<\/div>/)?.[0] || '';
  const secondary = html.match(/<div class="tab-group tab-group-secondary">[\s\S]*?<\/div>/)?.[0] || '';
  const ids = (block) => [...block.matchAll(/data-tab="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids(primary), ['home', 'todo', 'notes', 'links', 'clip', 'credentials']);
  assert.deepEqual(ids(secondary), ['time', 'recordings', 'resets', 'settings']);
  assert.doesNotMatch(appJs, /is-split|tab-split-start/);
});

test('Electron 44 clipboard reads are awaited and vault copies are marked concealed', () => {
  // clipboard.readText() returns a Promise in Electron 44; wrapping it in String() yielded "[object Promise]".
  assert.doesNotMatch(mainJs, /String\(clipboard\.readText\(\)/);
  assert.match(mainJs, /if \(field === 'password'\) await writeSecretToClipboard\(item\.password\)/);
  assert.match(mainJs, /else if \(field === 'env'\) await writeSecretToClipboard\(`\$\{credentialEnvName\(item\)\}=\$\{item\.password\}`\)/, 'KEY=value is concealed too');
  assert.match(mainJs, /secretClipboard\.matches\(text\)\) return;/, 'the history poller skips a just-copied password');
  assert.match(mainJs, /getVaultLock\(\)\.lock\(eventName\);\s+void clearSecretFromClipboard\(\);/, 'screen lock and sleep lock the vault and clear a copied password');
});
