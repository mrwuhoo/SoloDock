// 设置页：左侧分组导航，右侧一组一页。卡片本身由各自的模块渲染，这里只负责切换分组、标题和「跳到某张卡片」。
(function bootstrapSettingsNav() {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const nav = $('settings-nav');
  const body = $('settings-pane-body');
  const title = $('settings-pane-title');
  const desc = $('settings-pane-desc');
  if (!nav || !body) return;

  const KEY = 'notch-settings-group-v1';
  const GROUPS = {
    general: ['常规', '唤出方式、快捷键和每次打开时显示的页面。'],
    home: ['首页', '首页显示哪些组件，以及相框里的照片。'],
    body: ['身体与作息', '按你是否真的在用电脑来提醒；离开 5 分钟以上会重新计时。'],
    feat: ['功能', '顶栏显示哪些页面；首页和设置始终显示。'],
    ai: ['AI 与 API', '转写与智能命名的密钥，以及 AI 订阅的用量。'],
    privacy: ['隐私与安全', '密钥锁，以及哪些数据会离开这台电脑。'],
    data: ['数据', '所有数据都保存在本机的数据文件夹里。'],
    about: ['关于', '版本、项目主页与致谢。'],
  };

  let current = '';
  function select(group, { remember = true } = {}) {
    const next = GROUPS[group] ? group : 'general';
    current = next;
    nav.querySelectorAll('[data-settings-group]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.settingsGroup === next)));
    body.querySelectorAll(':scope > [data-settings-group]').forEach((card) => card.classList.toggle('is-other-group', card.dataset.settingsGroup !== next));
    if (title) title.textContent = GROUPS[next][0];
    if (desc) desc.textContent = GROUPS[next][1];
    body.scrollTop = 0;
    if (remember) {
      try { localStorage.setItem(KEY, next); } catch (error) {}
    }
  }

  // 其他模块要把某张卡片带到眼前时调用：先切到它所在的分组，再滚过去。
  function reveal(cardId, options = {}) {
    const card = $(cardId);
    const group = card?.closest('[data-settings-group]')?.dataset.settingsGroup;
    if (!card || !group) return false;
    if (group !== current) select(group);
    requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: options.behavior || 'smooth' }));
    return true;
  }

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-group]');
    if (button) select(button.dataset.settingsGroup);
  });
  body.addEventListener('click', (event) => {
    const link = event.target.closest('[data-settings-link]');
    if (link) window.notchAPI?.openExternal?.(link.dataset.settingsLink)?.catch?.(() => {});
  });

  async function loadVersion() {
    const settings = await Promise.resolve(window.notchAPI?.getAppSettings?.()).catch(() => null);
    const version = $('settings-about-version');
    if (version && settings?.version) version.textContent = `版本 ${settings.version}`;
  }

  let stored = '';
  try { stored = localStorage.getItem(KEY) || ''; } catch (error) {}
  select(stored, { remember: false });
  loadVersion();

  window.NotchSettings = { select, reveal, current: () => current };
})();
