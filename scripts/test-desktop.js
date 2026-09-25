const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.join(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
function run(executable, args) {
  console.log(`Checking ${args.join(' ')}`);
  const result = spawnSync(executable, args, { cwd: root, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) console.error(result.error);
  if (result.status !== 0) {
    if (env.TODO_TEST_LOG && fs.existsSync(env.TODO_TEST_LOG)) console.error(fs.readFileSync(env.TODO_TEST_LOG, 'utf8'));
    process.exit(result.status || 1);
  }
}
run(process.execPath, ['--test', ...fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.js')).map((name) => `tests/${name}`)]);
env.TODO_TEST_LOG = path.join(root, 'dist.noindex', 'windows-smoke', 'renderer-test.log');
fs.mkdirSync(path.dirname(env.TODO_TEST_LOG), { recursive: true });
fs.writeFileSync(env.TODO_TEST_LOG, '');
for (const file of ['notch-focus', 'codex-usage', 'reset-news', 'retained-workspace', 'workspace-hydration', 'prompts', 'ai-usage', 'today-strip', 'photo-frame', 'frame-store', 'vault', 'credentials', 'notification', 'body-settings', 'notch-status', 'notice-center', 'time-page', 'life-page', 'command-palette', 'capture', 'todo-page', 'notes-page', 'links-page', 'recordings-page', 'settings-page', 'onboarding', 'startup']) {
  const testProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-renderer-test-'));
  env.TODO_TEST_USER_DATA = testProfile;
  run(require('electron'), [`tests/${file}.electron.js`]);
  fs.rmSync(testProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
for (const file of ['main.js', 'main-services.js', 'frame-store.js', 'codex-usage.js', 'reset-news.js', 'renderer/codex-usage.js', 'renderer/reset-news.js', 'renderer/prompts.js', 'renderer/prompts-domain.js', 'renderer/ai-usage.js', 'renderer/ai-usage-domain.js', 'renderer/timeline-domain.js', 'renderer/today-strip.js', 'renderer/frame-domain.js', 'renderer/photo-frame.js', 'renderer/vault.js', 'renderer/credentials-page.js', 'vault-lock.js', 'renderer/body-settings.js', 'reminder-rules.js', 'renderer/notch-status-domain.js', 'renderer/notch-status.js', 'notice-store.js', 'renderer/notice-center.js', 'worklog-store.js', 'renderer/worklog-domain.js', 'renderer/time-page.js', 'renderer/life-domain.js', 'renderer/life-page.js', 'renderer/search-domain.js', 'renderer/command-palette.js', 'renderer/capture-domain.js', 'renderer/capture.js', 'renderer/capture-apply.js', 'renderer/todo-domain.js', 'renderer/todo-page.js', 'renderer/notes-domain.js', 'renderer/notes-page.js', 'renderer/links-domain.js', 'renderer/links-page.js', 'renderer/settings-nav.js', 'renderer/onboarding.js', 'platform.js', 'preload.js', 'renderer/domain.js', 'renderer/effects.js', 'renderer/app.js', 'renderer/workspace.js', 'renderer/icon-motion.js', 'renderer/notification.js', 'build/afterPack.js', 'scripts/codex-notify.js', 'scripts/claude-notify.js', 'scripts/claude-statusline.js', 'scripts/smoke-app.js']) {
  run(process.execPath, ['--check', file]);
}
