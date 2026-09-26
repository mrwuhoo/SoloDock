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
        const button = document.createElement('button');
        button.type = 'button';
        button.className = info.installed ? 'onboard-primary' : 'onboard-secondary';
        // Claude Code 由 SoloDock 直接登记（只加自己的一项）；Codex 仍复制接入设置自己粘贴。
        if (id === 'claude') {
          button.dataset.connect = id;
          button.textContent = '一键接入';
        } else {
          button.dataset.setup = id;
          button.textContent = '复制接入设置';
        }
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
      const result = await Promise.resolve(window.NotchAiUsageState?.connectClaude?.()).catch(() => null);
      const note = $('onboard-ai-note');
      note.classList.toggle('done', Boolean(result?.ok));
      note.querySelector('span').textContent = result?.ok
        ? '已接入 Claude Code：新开的会话回复一次后，额度和提醒都会出现在 SoloDock 里。原来的设置都保留，在「设置 → AI 与 API」里可以断开。'
        : result?.error === 'invalid_settings' ? '~/.claude/settings.json 格式有误，没有改动。' : '接入没有成功，请再试一次。';
      await renderAi();
      return;
    }
    const setup = event.target.closest('[data-setup]');
    if (setup) {
      const tool = setup.dataset.setup;
      const result = await Promise.resolve(api().getAiIntegrationSetup?.(tool)).catch(() => null);
      const copied = result?.ok && await Promise.resolve(api().writeClipboard?.({ type: 'text', text: result.snippet })).catch(() => false);
      const note = $('onboard-ai-note');
      const name = TOOLS.find(([id]) => id === tool)[1];
      note.classList.toggle('done', Boolean(copied));
      note.querySelector('span').textContent = copied
        ? `已复制 · 粘贴到 ${result.file} 最前面（任何 [ ] 段落之前），然后重启 ${name}。`
        : '没复制上，请再试一次。';
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
