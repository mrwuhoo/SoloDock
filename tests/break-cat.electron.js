const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
app.setPath('userData', process.env.TODO_TEST_USER_DATA);
const deadline = setTimeout(() => { console.error('Break cat renderer timed out'); app.exit(1); }, 60000);

// A MacBook Air 13" screen in points, with its 37pt menu bar.
const SCREEN = { width: 1470, height: 956, menuBar: 37 };

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SCREEN.width,
    height: SCREEN.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    enableLargerThanScreen: true,
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'break-cat-preload.js'), contextIsolation: false, sandbox: false, backgroundThrottling: false },
  });
  const errors = [];
  win.webContents.on('console-message', (details) => { if (details.level === 'error') errors.push(details.message); });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'break-cat.html'));
  const run = (code) => win.webContents.executeJavaScript(`(async () => {
    const $ = (id) => document.getElementById(id);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (check, ms = 5000) => { const end = Date.now() + ms; while (!check() && Date.now() < end) await wait(30); return check(); };
    const box = (id) => { const r = $(id).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    ${code}
  })()`);

  // Hidden until a break starts.
  assert.equal(await run(`return $('break-cat').hidden;`), true);

  const shown = await run(`
    window.NotchBreakCat.show({ endsAt: Date.now() + 5 * 60 * 1000, menuBar: ${SCREEN.menuBar} });
    await wait(1500);
    const arrive = $('break-cat-arrive');
    const sleep = $('break-cat-sleep');
    await until(() => arrive.readyState >= 1 && sleep.readyState >= 1);
    return {
      hidden: $('break-cat').hidden,
      time: $('break-cat-time').textContent,
      active: [arrive.dataset.active, sleep.dataset.active],
      pillVisible: $('break-cat').classList.contains('is-pill-visible'),
      stage: box('break-cat-stage'),
      pill: box('break-cat-pill'),
      screen: { width: window.innerWidth, height: window.innerHeight },
      arrive: { width: arrive.videoWidth, height: arrive.videoHeight, duration: arrive.duration },
      sleep: { width: sleep.videoWidth, duration: sleep.duration, loop: sleep.loop, muted: sleep.muted && arrive.muted },
    };
  `);
  assert.equal(shown.hidden, false);
  assert.match(shown.time, /^(5:00|4:59)$/);
  assert.deepEqual(shown.active, ['true', 'false'], 'the cat walks in first');
  assert.equal(shown.pillVisible, true);
  assert.deepEqual([shown.arrive.width, shown.arrive.height, shown.sleep.width], [1280, 720, 1280]);
  assert.ok(shown.arrive.duration > 13 && shown.arrive.duration < 15, `arrive lasts ${shown.arrive.duration}s`);
  assert.ok(shown.sleep.duration > 2 && shown.sleep.duration < 3, `sleep loop lasts ${shown.sleep.duration}s`);
  assert.equal(shown.sleep.loop, true);
  assert.equal(shown.sleep.muted, true);

  // Layout: the video starts under the menu bar and reaches the right screen edge (the cat walks in
  // from off screen); the sleeping cat is centred at about 70% of the width with the countdown under it.
  // (The test display may be smaller than the requested window, so measure against the real viewport.)
  const { stage, pill, screen } = shown;
  const sleepLeft = stage.left + 0.183 * stage.width;
  const sleepRight = stage.left + 0.845 * stage.width;
  assert.equal(Math.round(stage.top), SCREEN.menuBar);
  assert.ok(stage.right >= screen.width - 1, `video right edge ${stage.right} of ${screen.width}`);
  assert.ok(Math.abs((sleepLeft + sleepRight) / 2 - screen.width / 2) < 2, 'the sleeping cat is centred');
  assert.ok((sleepRight - sleepLeft) / screen.width > 0.55 && (sleepRight - sleepLeft) / screen.width <= 0.71, `cat share ${(sleepRight - sleepLeft) / screen.width}`);
  assert.ok(Math.abs((pill.left + pill.right) / 2 - screen.width / 2) < 2, 'the countdown is centred under the cat');
  assert.ok(pill.top >= stage.top + 0.9 * stage.height, 'the countdown sits below the sleeping cat');
  assert.ok(pill.bottom <= screen.height - 20, `countdown bottom ${pill.bottom} of ${screen.height}`);

  // Only the cat itself takes the pointer: its body is opaque in the video, the floor around it is not.
  const pointer = await run(`
    const arrive = $('break-cat-arrive');
    arrive.pause();
    arrive.currentTime = 6;
    await until(() => arrive.readyState >= 2 && !arrive.seeking);
    await wait(200);
    const stage = box('break-cat-stage');
    // Hover is probed on the next animation frame, which a hidden test window runs slowly.
    const interactive = () => window.__calls.filter((call) => call[0] === 'interactive').at(-1)?.[1] ?? false;
    const moveTo = async (x, y, expected) => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
      await until(() => interactive() === expected, 2000);
      return interactive();
    };
    // At 6s the cat stands looking at you, its belly around the middle of the frame.
    const onCat = await moveTo(stage.left + 0.52 * stage.width, stage.top + 0.55 * stage.height, true);
    const hovering = $('break-cat').classList.contains('is-hovering-cat');
    const offCat = await moveTo(stage.left + 0.05 * stage.width, stage.top + 0.1 * stage.height, false);
    const pillRect = box('break-cat-pill');
    const onPill = await moveTo(pillRect.left + 10, pillRect.top + 10, true);
    // Patting the cat: a little squish and two hearts.
    const pat = { clientX: stage.left + 0.52 * stage.width, clientY: stage.top + 0.55 * stage.height, bubbles: true };
    document.elementFromPoint(pat.clientX, pat.clientY).dispatchEvent(new MouseEvent('click', pat));
    const hearts = document.querySelectorAll('.break-cat-heart').length;
    const patted = $('break-cat-stage').classList.contains('is-patted');
    return { onCat, hovering, offCat, onPill, hearts, patted };
  `);
  assert.deepEqual(pointer, { onCat: true, hovering: true, offCat: false, onPill: true, hearts: 2, patted: true });

  // When the walk-in ends it settles into the sleeping loop and breathes.
  const settled = await run(`
    const arrive = $('break-cat-arrive');
    arrive.dispatchEvent(new Event('ended'));
    const ok = await until(() => $('break-cat-sleep').dataset.active === 'true');
    return { ok, arrive: arrive.dataset.active, sleeping: $('break-cat').classList.contains('is-sleeping'), breathing: getComputedStyle($('break-cat-sleep')).animationName };
  `);
  assert.deepEqual(settled, { ok: true, arrive: 'false', sleeping: true, breathing: 'break-cat-breathe' });

  // The countdown follows +5 minutes from the home card; 「让它走」 only asks the main process.
  const updated = await run(`
    window.NotchBreakCat.update({ endsAt: Date.now() + 61 * 1000 + 300 });
    const time = $('break-cat-time').textContent;
    $('break-cat-leave').click();
    return { time, calls: window.__calls.filter((call) => call[0] === 'dismiss').length };
  `);
  assert.deepEqual(updated, { time: '1:02', calls: 1 });
  assert.equal(await run(`return window.NotchBreakCat.formatRemaining(0) + ' ' + window.NotchBreakCat.formatRemaining(299001);`), '0:00 5:00');

  if (process.env.SOLODOCK_BREAK_CAT_SCREENSHOT_DIR) {
    await run(`$('break-cat-sleep').currentTime = 0; await wait(400);`);
    fs.writeFileSync(path.join(process.env.SOLODOCK_BREAK_CAT_SCREENSHOT_DIR, 'break-cat.png'), (await win.webContents.capturePage()).toPNG());
  }

  // Leaving: the cat fades out, then the page reports it is gone so the window can close.
  const left = await run(`
    window.__calls.length = 0;
    window.NotchBreakCat.hide();
    const leaving = $('break-cat').classList.contains('is-leaving');
    await until(() => window.__calls.some((call) => call[0] === 'left'), 3000);
    return { leaving, hidden: $('break-cat').hidden, calls: window.__calls, paused: $('break-cat-sleep').paused };
  `);
  assert.deepEqual(left, { leaving: true, hidden: true, calls: [['interactive', false], ['left']], paused: true });

  // With reduced motion the cat is simply there, asleep and still.
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const still = await run(`
    window.NotchBreakCat.show({ endsAt: Date.now() + 60 * 1000, menuBar: ${SCREEN.menuBar} });
    await wait(300);
    return { active: [$('break-cat-arrive').dataset.active, $('break-cat-sleep').dataset.active], playing: !$('break-cat-sleep').paused || !$('break-cat-arrive').paused, pill: $('break-cat').classList.contains('is-pill-visible'), breathing: getComputedStyle($('break-cat-sleep')).animationName };
  `);
  assert.deepEqual(still, { active: ['false', 'true'], playing: false, pill: true, breathing: 'none' });
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  win.webContents.debugger.detach();

  // A short, wide screen still fits the countdown under the cat.
  win.setContentSize(1600, 700);
  const short = await run(`
    await until(() => window.innerHeight !== ${shown.screen.height}, 2000);
    window.NotchBreakCat.layout();
    return { stage: box('break-cat-stage'), pill: box('break-cat-pill'), width: window.innerWidth, height: window.innerHeight };
  `);
  assert.ok(short.height < shown.screen.height, `resized to ${short.width}×${short.height}`);
  assert.ok(short.pill.bottom <= short.height - 20, `countdown bottom ${short.pill.bottom} of ${short.height}`);

  // With the Dock at the bottom, the countdown sits above it.
  const docked = await run(`
    window.NotchBreakCat.show({ endsAt: Date.now() + 60 * 1000, menuBar: ${SCREEN.menuBar}, bottom: 70 });
    await wait(50);
    return { pill: box('break-cat-pill'), height: window.innerHeight };
  `);
  assert.ok(docked.pill.bottom <= docked.height - 70 - 20, `countdown bottom ${docked.pill.bottom} above a 70px Dock in ${docked.height}`);
  assert.ok(short.stage.right >= short.width - 1, 'the cat still walks in from the screen edge');

  assert.deepEqual(errors, []);
  console.log('Break cat checks passed');
  clearTimeout(deadline);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
