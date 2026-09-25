const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Recordings page renderer timed out'); app.exit(1); }, 50000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1240,
    height: 616,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'panel-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await win.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    const now = Date.now();
    localStorage.setItem('notch-recordings', JSON.stringify([
      { id: 'r1', createdAt: now - 60000, durationMs: 1000, transcript: '王总：合同第 4 条的交付时间，我们这边希望改到 11 月 20 日。我：可以。王总：报价单麻烦今天发一版给财务。天气不错', audioPath: 'recordings/r1.wav', mimeType: 'audio/wav', title: '客户电话 · 王总', category: '客户' },
      { id: 'r2', createdAt: now - 2 * 86400000, durationMs: 185000, transcript: '今天聊一下一人公司如何用 AI 工具', audioPath: 'recordings/r2.webm', mimeType: 'audio/webm', title: '课程口播草稿', category: '课程' },
      { id: 'r3', createdAt: now - 3 * 86400000, durationMs: 48000, transcript: '', audioPath: '', mimeType: 'audio/webm', title: '灵感', category: '未分类' },
    ]));
    return true;
  })()`);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

  const shotDir = process.env.SOLODOCK_RECORDINGS_SCREENSHOT_DIR;
  if (shotDir) await win.webContents.executeJavaScript('window.__wantShot = true; true');
  const running = win.webContents.executeJavaScript(`(async () => {
    const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));
    const waitFor = async (predicate, label, timeout = 3000) => {
      const started = Date.now();
      while (!predicate()) {
        if (Date.now() - started > timeout) throw new Error('timeout: ' + label);
        await settle(20);
      }
    };
    const $ = (id) => document.getElementById(id);
    // A one-second 8 kHz WAV whose loudness rises, so the waveform has a real shape.
    function wav() {
      const rate = 8000, samples = rate, buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer);
      const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
      text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE'); text(12, 'fmt ');
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true);
      view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
      for (let index = 0; index < samples; index += 1) view.setInt16(44 + index * 2, Math.sin(index / 6) * 30000 * (index / samples), true);
      return new Uint8Array(buffer);
    }
    const deleted = [];
    window.notchAPI.readRecording = async (audioPath) => (audioPath === 'recordings/r1.wav' ? { bytes: wav(), mimeType: 'audio/wav' } : null);
    window.notchAPI.deleteRecording = async (audioPath) => { deleted.push(audioPath); return true; };
    await setMode(true);
    await setActiveTab('recordings');
    await settle(200);
    const out = {};

    // List: title with a category chip, a readable time and length, a one-line excerpt.
    out.count = $('recording-count').textContent;
    out.rows = [...document.querySelectorAll('.recording-item')].map((row) => [row.querySelector('strong').textContent, row.querySelector('.rec-chip')?.textContent || '', row.querySelector('.rec-row-meta').textContent.replace(/\\d\\d:\\d\\d/, 'HH:MM'), row.querySelector('.rec-row-excerpt').textContent.slice(0, 6)]);

    // The player decodes the audio into a 72-bar waveform.
    const detail = $('recording-detail');
    document.querySelector('.recording-item[data-id="r1"] .recording-item-main').click();
    await waitFor(() => detail.querySelector('.rec-player')?.dataset.state === 'ready' && detail.querySelector('.rec-wave')?.dataset.real === 'true', 'waveform');
    const bars = [...detail.querySelectorAll('.rec-wave i')].map((bar) => parseFloat(bar.style.height));
    out.wave = [bars.length, bars[0] < bars[bars.length - 1]];
    out.head = [detail.querySelector('.recording-title-input').value, detail.querySelector('.rec-category').value];
    const audio = detail.querySelector('.rec-player audio');
    await waitFor(() => audio.readyState >= 1, 'metadata');
    out.time = detail.querySelector('.rec-time').textContent;

    // Speed cycles 1× → 1.5× → 2× → 1×.
    const speed = detail.querySelector('.rec-speed');
    const speeds = [];
    for (let index = 0; index < 3; index += 1) { speed.click(); speeds.push([speed.textContent, audio.playbackRate]); }
    out.speeds = speeds;

    // Clicking the waveform seeks; Space plays and pauses without folding the panel; → skips 5 seconds.
    const wave = detail.querySelector('.rec-wave');
    const rect = wave.getBoundingClientRect();
    wave.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + 5 }));
    out.seek = Math.round(audio.currentTime * 10) / 10;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    await settle(150);
    out.space = [audio.paused, document.getElementById('app').classList.contains('expanded')];
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
    await settle(80);
    out.spaceAgain = audio.paused;
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    out.skip = Math.round(audio.currentTime * 10) / 10;

    // Transcript actions: copy, save as a note, pick todos (only sentences with a time or an action).
    detail.querySelector('[data-action="copy-recording"]').click();
    await settle();
    out.copied = window.__calls.some((call) => call[0] === 'write-clipboard' && call[1].text.startsWith('王总：合同'));
    detail.querySelector('[data-action="save-note"]').click();
    await settle();
    out.note = [window.NotchNotes.list().some((note) => note.title === '客户电话 · 王总' && note.content.includes('11 月 20 日')), $('status-toast-message').textContent];
    detail.querySelector('[data-action="extract-todos"]').click();
    await settle();
    const picker = detail.querySelector('.rec-todos');
    out.candidates = [...picker.querySelectorAll('.rec-todos-item span')].map((node) => node.textContent);
    out.addDisabled = picker.querySelector('.rec-primary').disabled;
    picker.querySelectorAll('input')[1].click();
    await settle();
    picker.querySelector('.rec-primary').click();
    await settle();
    out.todos = [window.NotchTodos.list().some((todo) => todo.text === '报价单麻烦今天发一版给财务'), $('status-toast-message').textContent.startsWith('已加 1 条待办')];

    // Title and category edit in place.
    const title = detail.querySelector('.recording-title-input');
    title.value = '王总报价电话';
    title.dispatchEvent(new Event('change', { bubbles: true }));
    const category = detail.querySelector('.rec-category');
    category.value = '客户 A';
    category.dispatchEvent(new Event('change', { bubbles: true }));
    const saved = JSON.parse(localStorage.getItem('notch-recordings')).find((item) => item.id === 'r1');
    out.edited = [saved.title, saved.category, document.querySelector('.recording-item[data-id="r1"] strong').textContent];

    // No audio: the player says so; no transcript and no service: a way to configure.
    document.querySelector('.recording-item[data-id="r3"] .recording-item-main').click();
    await settle(150);
    out.missing = [detail.querySelector('.rec-player').dataset.state, detail.querySelector('.rec-time').textContent, Boolean(detail.querySelector('.rec-empty-hint [data-action="configure-transcription"]'))];

    // Delete takes the row away at once but keeps the file until the undo time is over.
    document.querySelector('.recording-item[data-id="r2"] .recording-item-delete').click();
    await settle();
    out.deleteNow = [document.querySelectorAll('.recording-item').length, deleted.length, $('status-toast-message').textContent];
    $('status-toast-action').click();
    await settle();
    out.undo = document.querySelectorAll('.recording-item').length;
    document.querySelector('.recording-item[data-id="r2"] .recording-item-delete').click();
    await settle(5800);
    out.fileDeleted = deleted;

    // Recording live: big red timer, a waveform, pause and end.
    const originalRecorder = window.MediaRecorder;
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
    const track = { readyState: 'live', addEventListener() {}, stop() {} };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    class FakeMediaRecorder {
      static isTypeSupported() { return true; }
      constructor() { this.mimeType = 'audio/webm'; }
      start() {}
      pause() {}
      resume() {}
      stop() { queueMicrotask(() => this.onstop?.()); }
    }
    window.MediaRecorder = FakeMediaRecorder;
    navigator.mediaDevices.getUserMedia = async () => stream;
    window.notchAPI.ensureMicrophone = async () => true;
    try {
      $('recording-new').click();
      await waitFor(() => document.querySelector('.recording-item.is-live') && detail.querySelector('.rec-live-card'), 'live view');
      await settle(300);
      window.__liveReady = true;
      if (window.__wantShot) await waitFor(() => window.__shotDone, 'screenshot', 8000);
      out.live = {
        row: document.querySelector('.recording-item.is-live strong').textContent,
        time: detail.querySelector('.rec-live-time').textContent,
        bars: detail.querySelectorAll('.rec-live-wave i').length,
        pause: detail.querySelector('.recording-live-pause').textContent,
        stop: detail.querySelector('.recording-live-stop').textContent,
        button: $('recording-new').dataset.state,
        meta: detail.querySelector('[data-recording-live-state]').textContent,
      };
      detail.querySelector('.recording-live-pause').click();
      await settle(150);
      out.paused = [detail.querySelector('.recording-live-pause').textContent, document.querySelector('.recording-item.is-live strong').textContent];
      detail.querySelector('.recording-live-stop').click();
      await waitFor(() => !window.NotchWorkspace.isRecordingActive(), 'stopped');
    } finally {
      window.MediaRecorder = originalRecorder;
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
    }
    out.afterStop = [document.querySelectorAll('.recording-item.is-live').length, $('recording-new').dataset.state || ''];
    return out;
  })()`);

  if (shotDir) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await win.webContents.executeJavaScript('Boolean(window.__liveReady)')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    fs.writeFileSync(path.join(shotDir, 'recordings-live.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript('window.__shotDone = true; true');
  }
  const result = await running;
  assert.equal(result.count, '3 条');
  assert.deepEqual(result.rows, [
    ['客户电话 · 王总', '客户', '今天 HH:MM · 00:01', '王总：合同第'],
    ['课程口播草稿', '课程', result.rows[1][2], '今天聊一下一'],
    ['灵感', '', result.rows[2][2], '仅音频 · '],
  ]);
  assert.match(result.rows[1][2], /^\d+\/\d+ HH:MM · 03:05$/);
  assert.deepEqual(result.wave, [72, true], 'the louder end draws taller bars');
  assert.deepEqual(result.head, ['客户电话 · 王总', '客户']);
  assert.equal(result.time, '0:00 / 0:01');
  assert.deepEqual(result.speeds, [['1.5×', 1.5], ['2×', 2], ['1×', 1]]);
  assert.ok(result.seek > 0.3 && result.seek < 0.7, `seek to the middle (${result.seek})`);
  assert.deepEqual(result.space, [false, true], 'Space plays and the panel stays open');
  assert.equal(result.spaceAgain, true);
  assert.equal(result.skip, 1, 'skipping stops at the end');
  assert.equal(result.copied, true);
  assert.deepEqual(result.note, [true, '已存为笔记']);
  assert.deepEqual(result.candidates, ['合同第 4 条的交付时间，我们这边希望改到 11 月 20 日', '报价单麻烦今天发一版给财务']);
  assert.equal(result.addDisabled, true, 'nothing is added until the user ticks');
  assert.deepEqual(result.todos, [true, true]);
  assert.deepEqual(result.edited, ['王总报价电话', '客户 A', '王总报价电话']);
  assert.deepEqual(result.missing, ['missing', '音频文件不可用', true]);
  assert.deepEqual(result.deleteNow, [2, 0, '已删除「课程口播草稿」']);
  assert.equal(result.undo, 3);
  assert.deepEqual(result.fileDeleted, ['recordings/r2.webm']);
  assert.equal(result.live.row, '正在录音…');
  assert.match(result.live.time, /^00:0\d$/);
  assert.deepEqual([result.live.bars, result.live.pause, result.live.stop, result.live.button, result.live.meta], [13, '暂停', '结束并保存', 'recording', '正在录音']);
  assert.deepEqual(result.paused, ['继续', '已暂停']);
  assert.deepEqual(result.afterStop, [0, '']);

  if (process.env.SOLODOCK_RECORDINGS_SCREENSHOT_DIR) {
    fs.writeFileSync(path.join(process.env.SOLODOCK_RECORDINGS_SCREENSHOT_DIR, 'recordings-page.png'), (await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors, []);
  console.log('Recordings page checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
