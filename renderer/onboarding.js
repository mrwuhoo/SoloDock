// 首次引导：怎么唤出 · 常用功能 · 接入 AI（可跳过）。不在引导里索要任何系统权限。
// 是否该出现由主进程决定（只对新装用户，见 main.js markOnboardingIfFreshInstall）：第一次展开面板时出现一次，
// 看完或跳过后由主进程清掉；「设置 → 关于」里可以重看。
(function bootstrapOnboarding() {
  'use strict';

  const FEATURES = [
    ['todo', '待办'], ['notes', '笔记'], ['links', '链接'], ['credentials', '密钥'],
    ['clip', '剪贴板'], ['recordings', '录制'], ['time', '时间'], ['life', '生活'],
  ];
  const TOOLS = [['claude', 'Claude Code', 'C'], ['codex', 'Codex', 'X']];

  const $ = (id) => document.getElementById(id);
  const root = $('onboard');
  if (!root) return;
  const api = () => window.notchAPI || {};
  const card = root.querySelector('.onboard-card');
  const steps = [...root.querySelectorAll('.onboard-step')];
  const bars = [...root.querySelectorAll('.onboard-progress i')];
  const prev = root.querySelector('[data-onboard="prev"]');
  const next = root.querySelector('[data-onboard="next"]');
  let step = 1;
  let features = {};
  let picked = {};

  // 剪贴板历史必须明确开启：没有设置过也算关闭。
  const enabled = (id) => (id === 'clip' ? features.clip === true : features[id] !== false);

  function shortcutLabel(accelerator) {
    return window.NotchCapture?.shortcutLabel?.(accelerator) || accelerator;
  }

  function renderKeys(settings) {
    const shortcut = settings?.shortcut || 'Space';
    if (shortcut === 'Space') {
      $('onboard-summon-key').textContent = '悬停刘海 + 空格';
      $('onboard-summon-text').textContent = '鼠标移到刘海处按空格，或直接点一下刘海；移开就收起。';
    } else {
      $('onboard-summon-key').textContent = `${shortcutLabel(shortcut)} 展开面板`;
      $('onboard-summon-text').textContent = '在任何应用里按下就展开，也可以直接点一下刘海。快捷键可在设置里改。';
    }
    // 首次运行时默认开机自动打开，系统会提示添加了后台项目：在这里说一声是什么、去哪关。
    $('onboard-launch-note').hidden = settings?.autoLaunch !== true;
    const capture = settings?.captureShortcut ?? 'Alt+Shift+N';
    if (capture) {
      $('onboard-capture-key').textContent = `${shortcutLabel(capture)} 随手记`;
      $('onboard-capture-text').textContent = '在任何应用里记一条：带时间的变成待办，网址变成链接。';
    } else {
      $('onboard-capture-key').textContent = '⌘K 搜索';
      $('onboard-capture-text').textContent = '面板里一处搜遍待办、笔记、链接、剪贴板和密钥名称。';
    }
  }

  function renderPicks() {
    const box = $('onboard-picks');
    box.replaceChildren(...FEATURES.map(([id, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.feature = id;
      button.setAttribute('aria-pressed', String(picked[id]));
      // 图标直接借用页签上的，和面板里看到的一致。
      const icon = document.querySelector(`#tab-button-${id} svg`)?.cloneNode(true);
      if (icon) button.append(icon);
      const text = document.createElement('span');
      text.textContent = label;
      button.append(text);
      return button;
    }));
  }

  async function renderAi() {
    const box = $('onboard-ai');
    const status = await Promise.resolve(api().getAiIntegrationStatus?.()).catch(() => null) || {};
    box.replaceChildren(...TOOLS.map(([id, name, letter]) => {
      const info = status[id] || {};
      const row = document.createElement('div');
      row.className = 'onboard-ai-row';
      row.dataset.tool = id;
      const avatar = document.createElement('i');
      avatar.textContent = letter;
      const text = document.createElement('span');
      const title = document.createElement('b');
      title.textContent = name;
      const state = document.createElement('small');
      state.dataset.state = info.connected ? 'connected' : info.installed ? 'installed' : 'missing';
      state.textContent = info.connected ? '已接入' : info.installed ? '已检测到' : '没有检测到，装好后可以在这里接入';
      text.append(title, state);
      row.append(avatar, text);
      if (!info.connected) {
        // 提醒由 SoloDock 直接登记（只加自己的一项）；额度会自动读取，不用接入。
        const button = document.createElement('button');
        button.type = 'button';
        button.className = info.installed ? 'onboard-primary' : 'onboard-secondary';
        button.dataset.connect = id;
        button.textContent = '接入提醒';
        row.append(button);
      }
      return row;
    }));
  }

  function show(nextStep) {
    step = nextStep;
    steps.forEach((node) => { node.hidden = Number(node.dataset.step) !== step; });
    bars.forEach((bar, index) => bar.classList.toggle('on', index < step));
    card.setAttribute('aria-labelledby', `onboard-title-${step}`);
    prev.disabled = step === 1;
    next.textContent = step === 3 ? '完成' : '下一步';
    if (step === 3) renderAi();
    requestAnimationFrame(() => next.focus({ preventScroll: true }));
  }

  async function open() {
    const settings = await Promise.resolve(api().getAppSettings?.()).catch(() => null);
    features = { ...(settings?.features || {}) };
    picked = Object.fromEntries(FEATURES.map(([id]) => [id, enabled(id)]));
    renderKeys(settings);
    renderPicks();
    root.hidden = false;
    show(1);
  }

  // 第 2 步的选择只在离开这一步时写入，来回切换不会反复改设置。
  async function applyPicks() {
    const changes = FEATURES.filter(([id]) => enabled(id) !== picked[id]);
    for (const [id] of changes) {
      const result = await Promise.resolve(api().setFeature?.(id, picked[id])).catch(() => null);
      if (result?.ok) features[id] = picked[id];
    }
  }

  async function copySetup(tool) {
    const result = await Promise.resolve(api().getAiIntegrationSetup?.(tool)).catch(() => null);
    return Boolean(result?.ok && await Promise.resolve(api().writeClipboard?.({ type: 'text', text: result.snippet })).catch(() => false));
  }

  function close() {
    if (root.hidden) return false;
    root.hidden = true;
    Promise.resolve(api().finishOnboarding?.()).catch(() => {});
    return true;
  }

  async function finish() {
    close();
    await window.setActiveTab?.('home');
  }

  root.addEventListener('click', async (event) => {
    const pick = event.target.closest('[data-feature]');
    if (pick) {
      picked[pick.dataset.feature] = pick.getAttribute('aria-pressed') !== 'true';
      pick.setAttribute('aria-pressed', String(picked[pick.dataset.feature]));
      return;
    }
    const connect = event.target.closest('[data-connect]');
    if (connect) {
      connect.disabled = true;
      const tool = connect.dataset.connect;
      const result = tool === 'claude'
        ? await Promise.resolve(window.NotchAiUsageState?.connectClaude?.()).catch(() => null)
        : await Promise.resolve(api().connectCodex?.()).catch(() => null);
      let message = result?.error === 'not_installed' ? '先把 SoloDock 移到「应用程序」文件夹再接入（现在是从安装盘里运行的）。' : '接入没有成功，请再试一次。';
      if (result?.ok) {
        message = tool === 'claude'
          ? '已接入 Claude Code 提醒：任务完成与「需要你确认」会从刘海提醒你。额度由 SoloDock 自动读取，不用额外设置。原来的设置都保留，在「设置 → AI 与 API」里可以断开。'
          : '已接入 Codex 提醒：重启 Codex 后，任务完成会从刘海提醒你。原来的设置都保留，改动前的备份在 ~/.codex/config.toml.before-solodock。';
      } else if (result?.error === 'invalid_settings') {
        message = '~/.claude/settings.json 格式有误，没有改动。';
      } else if (result?.error === 'notify_exists') {
        // 用户已有自己的 notify：不覆盖，把接入设置复制下来，由用户自己合并。
        const copied = await copySetup('codex');
        message = copied
          ? '~/.codex/config.toml 里已经有一条 notify，为了不覆盖它没有改动。接入设置已复制，可以自己合并进去。'
          : '~/.codex/config.toml 里已经有一条 notify，为了不覆盖它没有改动。';
      }
      const note = $('onboard-ai-note');
      note.classList.toggle('done', Boolean(result?.ok));
      note.querySelector('span').textContent = message;
      await renderAi();
      return;
    }
    const action = event.target.closest('[data-onboard]')?.dataset.onboard;
    if (action === 'skip') finish();
    else if (action === 'prev' && step > 1) show(step - 1);
    else if (action === 'next') {
      if (step === 2) await applyPicks();
      if (step < 3) show(step + 1);
      else finish();
    }
  });

  document.addEventListener('notch:modechange', async (event) => {
    if (!event.detail?.expanded || !root.hidden) return;
    const settings = await Promise.resolve(api().getAppSettings?.()).catch(() => null);
    if (settings?.onboardingPending === true && root.hidden) open();
  });
  document.getElementById('settings-onboarding')?.addEventListener('click', () => open());

  window.NotchOnboarding = { open, escape: close, state: () => ({ step, open: !root.hidden }) };
})();
