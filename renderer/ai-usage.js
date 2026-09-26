// Home "AI 用量" card with up to three subscriptions, plus the subscription list in Settings.
// The Codex column is updated by codex-usage.js; this file renders the Claude and manual
// columns, orders every column and picks the 1 / 2 / 3 column layout.
(function bootstrapAiUsage() {
  'use strict';

  const Ai = window.NotchAiUsage;
  const tile = document.getElementById('home-usage');
  const columns = document.getElementById('usage-columns');
  if (!Ai || !tile || !columns) return;

  const KEY = 'notch-ai-subscriptions-v1';
  const CLAUDE_POLL_MS = 30000;
  const codexColumn = columns.querySelector('[data-provider="codex"]');
  const meta = document.getElementById('usage-meta');
  const list = document.getElementById('ai-sub-list');
  const addForm = document.getElementById('ai-sub-add');
  const addName = document.getElementById('ai-sub-name');
  const addPlan = document.getElementById('ai-sub-plan');
  const addDay = document.getElementById('ai-sub-day');
  const get = (id) => document.getElementById(id);

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  };
  let subscriptions = Ai.normalizeSubscriptions(readJson(KEY, null));
  let claudeSnapshot = null;
  let lastClaudeRead = 0;
  // ~/.claude/settings.json 里有没有 SoloDock 的状态栏 / 提醒登记（主进程只读判断，内容不传过来）。
  let claudeLink = { installed: false, usage: false, reminders: false };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(subscriptions)); } catch (error) { /* keep session state */ }
    render();
    renderSettings();
    document.dispatchEvent(new CustomEvent('notch:ai-subscriptions-changed'));
  }

  function toast(message) {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message);
  }

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function columnHead(subscription) {
    const head = node('div', 'usage-col-head');
    const mark = node('span', 'usage-mark', subscription.mark);
    mark.dataset.kind = subscription.kind;
    const name = node('b', '', subscription.name);
    head.append(mark, name);
    if (subscription.plan) head.append(node('span', 'usage-plan', subscription.plan));
    return head;
  }

  function value(numberText, suffix, label) {
    const box = node('div', 'usage-widget-value');
    const strong = node('strong', '', numberText);
    if (suffix) strong.append(node('span', 'usage-percent-sign', suffix));
    box.append(strong, node('span', '', label));
    return box;
  }

  function bar(fraction, striped) {
    const track = node('div', `usage-bar${striped ? ' cycle' : ''}`);
    const fill = node('i');
    fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    track.append(fill);
    return track;
  }

  function renewalText(subscription) {
    const renewal = Ai.renewalInfo(subscription.renewalDay);
    if (!renewal) return '';
    return renewal.daysLeft === 0 ? '今天续费' : `续费 ${renewal.label}`;
  }

  function openSettings() {
    get('tab-button-settings')?.click();
    setTimeout(() => { if (!window.NotchSettings?.reveal?.('settings-ai-card')) get('settings-ai-card')?.scrollIntoView({ block: 'nearest' }); }, 220);
  }

  function claudeColumn(subscription) {
    const column = node('div', 'usage-col usage-col-extra');
    column.dataset.provider = 'claude';
    column.dataset.subscription = subscription.id;
    const body = node('div', 'usage-widget-body');
    const footer = node('div', 'usage-widget-footer');
    const summary = Ai.claudeSummary(claudeSnapshot);
    if (summary.state === 'ready') {
      const { primary, secondary } = summary;
      column.dataset.level = Ai.level(primary.remaining);
      body.append(
        value(String(Math.round(primary.remaining)), '%', `${primary.label}剩余`),
        bar(primary.remaining / 100, false),
        node('p', 'usage-note', primary.resetsAt ? `${Ai.clock(primary.resetsAt)} 恢复 · ${Ai.until(primary.resetsAt)}` : '恢复时间未提供'),
      );
      footer.append(node('span', '', secondary ? `${secondary.label}剩 ${Math.round(secondary.remaining)}%` : 'Claude Code 上报'));
    } else {
      column.dataset.level = 'unknown';
      const waiting = summary.state === 'disconnected' && claudeLink.usage;
      body.append(value('—', '', summary.state === 'stale' ? '额度已重置' : waiting ? '已接入' : '未接入'));
      body.append(node('p', 'usage-note', summary.state === 'stale'
        ? '等 Claude Code 刷新'
        : waiting ? '在终端用 claude 回复一次后显示' : '一键接入，自动显示额度'));
      if (summary.state === 'disconnected' && !claudeLink.usage) {
        const connect = node('button', 'workspace-button compact', '一键接入');
        connect.type = 'button';
        connect.addEventListener('click', (event) => { event.stopPropagation(); connectClaude(); });
        body.append(connect);
      }
    }
    const renewal = renewalText(subscription);
    if (renewal) footer.append(node('span', 'usage-renewal', renewal));
    column.append(columnHead(subscription), body, footer);
    return column;
  }

  function manualColumn(subscription) {
    const column = node('div', 'usage-col usage-col-extra');
    column.dataset.provider = 'manual';
    column.dataset.subscription = subscription.id;
    column.dataset.level = 'cycle';
    const body = node('div', 'usage-widget-body');
    const renewal = Ai.renewalInfo(subscription.renewalDay);
    if (renewal) {
      body.append(
        value(renewal.daysLeft === 0 ? '今天' : String(renewal.daysLeft), '', renewal.daysLeft === 0 ? '续费' : '天后续费'),
        bar(renewal.progress, true),
        node('p', 'usage-note', `${renewal.label} 续费`),
      );
    } else {
      body.append(value('—', '', '未设置续费日'));
      const set = node('button', 'workspace-button compact', '设置续费日');
      set.type = 'button';
      set.addEventListener('click', openSettings);
      body.append(set);
    }
    const footer = node('div', 'usage-widget-footer');
    footer.append(node('span', '', '额度无法读取 · 手动'));
    column.append(columnHead(subscription), body, footer);
    return column;
  }

  function onHome() {
    return Ai.homeSubscriptions(subscriptions);
  }

  // Small or compact cards only have room for one subscription.
  function render() {
    const variant = tile.dataset.layoutVariant || '';
    const available = onHome();
    const shown = ['mini', 'compact'].includes(variant) ? available.slice(0, 1) : available;
    tile.dataset.count = String(Math.max(1, shown.length));
    tile.dataset.stack = variant === 'tall' ? 'rows' : 'columns';
    columns.querySelectorAll('.usage-col-extra, .usage-col-empty').forEach((element) => element.remove());

    const codexIndex = shown.findIndex((item) => item.id === 'codex');
    codexColumn.hidden = codexIndex === -1;
    codexColumn.style.order = String(Math.max(0, codexIndex));
    const codex = subscriptions.find((item) => item.id === 'codex');
    const codexPlan = columns.querySelector('[data-plan-for="codex"]');
    if (codexPlan) {
      codexPlan.textContent = codex?.plan || '';
      codexPlan.hidden = !codex?.plan;
    }
    const codexRenewal = columns.querySelector('[data-renewal-for="codex"]');
    if (codexRenewal) {
      codexRenewal.textContent = codex ? renewalText(codex) : '';
      codexRenewal.hidden = !codexRenewal.textContent;
    }

    shown.forEach((subscription, index) => {
      if (subscription.id === 'codex') return;
      const column = subscription.kind === 'claude' ? claudeColumn(subscription) : manualColumn(subscription);
      column.style.order = String(index);
      columns.append(column);
    });
    if (!shown.length) {
      const empty = node('div', 'usage-col usage-col-empty');
      empty.append(node('p', 'usage-note', '在设置里选择要显示的 AI 订阅'));
      const open = node('button', 'workspace-button compact', '打开设置');
      open.type = 'button';
      open.addEventListener('click', openSettings);
      empty.append(open);
      columns.append(empty);
    }
    if (meta) meta.textContent = shown.length > 1 ? `${shown.length} 个订阅` : '';
  }

  function cardVisible() {
    return document.visibilityState !== 'hidden'
      && get('app')?.classList.contains('expanded')
      && ((get('tab-home')?.classList.contains('active') && !tile.hidden)
        || get('tab-settings')?.classList.contains('active'));
  }

  async function refreshClaude(force = false) {
    const claude = subscriptions.find((item) => item.id === 'claude');
    const settingsOpen = get('tab-settings')?.classList.contains('active');
    if (!window.notchAPI?.getClaudeUsage || (!claude?.enabled && !settingsOpen)) return;
    if (!force && (!cardVisible() || Date.now() - lastClaudeRead < CLAUDE_POLL_MS)) return;
    lastClaudeRead = Date.now();
    const result = await window.notchAPI.getClaudeUsage().catch(() => null);
    claudeSnapshot = result && result.ok ? result : null;
    render();
    renderSettings();
    document.dispatchEvent(new CustomEvent('notch:ai-usage-updated', { detail: { provider: 'claude' } }));
  }

  // ---------------- 一键接入 Claude Code ----------------
  // Claude 没有 Codex 那样的额度读取接口，只能从状态栏拿数据；点一下由主进程写好 ~/.claude/settings.json，
  // 只加 SoloDock 自己的一项，原来的状态栏与钩子都保留，随时可以断开还原。
  async function refreshClaudeLink() {
    const status = await Promise.resolve(window.notchAPI?.getAiIntegrationStatus?.()).catch(() => null);
    if (status?.claude) claudeLink = { installed: Boolean(status.claude.installed), usage: Boolean(status.claude.usage), reminders: Boolean(status.claude.reminders) };
    render();
    renderSettings();
    return claudeLink;
  }

  function linkChanged(status) {
    if (status) claudeLink = { ...claudeLink, usage: Boolean(status.usage), reminders: Boolean(status.reminders) };
    render();
    renderSettings();
    document.dispatchEvent(new CustomEvent('notch:ai-usage-updated', { detail: { provider: 'claude' } }));
  }

  async function connectClaude() {
    const result = await Promise.resolve(window.notchAPI?.connectClaude?.()).catch(() => null);
    if (result?.error === 'not_installed') {
      // 从安装盘直接运行时登记进去的路径会失效：先移到「应用程序」。
      if (typeof window.showStatusToast === 'function') {
        window.showStatusToast('先把 SoloDock 移到「应用程序」再接入', { actionLabel: '移过去', onAction: () => window.notchAPI?.moveToApplications?.(), duration: 8000 });
      }
      return result;
    }
    if (!result?.ok) {
      toast(result?.error === 'invalid_settings' ? '~/.claude/settings.json 格式有误，没有改动；可以用「手动配置」' : '接入没有成功，请再试一次');
      return result;
    }
    const claude = subscriptions.find((item) => item.id === 'claude');
    if (claude && !claude.enabled) { claude.enabled = true; save(); }
    linkChanged(result.status);
    if (typeof window.showStatusToast === 'function') {
      window.showStatusToast('已接入 · 在终端用 claude 回复一次后显示额度', { actionLabel: '撤销', onAction: () => disconnectClaude(), duration: 6000 });
    }
    return result;
  }

  async function disconnectClaude() {
    const result = await Promise.resolve(window.notchAPI?.disconnectClaude?.()).catch(() => null);
    if (!result?.ok) {
      toast(result?.error === 'invalid_settings' ? '~/.claude/settings.json 格式有误，没有改动' : '断开没有成功，请再试一次');
      return result;
    }
    linkChanged(result.status);
    toast('已断开 Claude Code，原来的设置都还在');
    return result;
  }

  // ---------------- Settings ----------------
  function dayOptions(select, selected) {
    select.replaceChildren();
    const none = node('option', '', '续费日');
    none.value = '';
    select.append(none);
    for (let day = 1; day <= 31; day += 1) {
      const option = node('option', '', `每月 ${day} 日`);
      option.value = String(day);
      if (day === selected) option.selected = true;
      select.append(option);
    }
  }

  function sourceText(subscription, homeIds) {
    const onHomeText = subscription.enabled && !homeIds.includes(subscription.id) ? ' · 不在首页（只显示前 3 个）' : '';
    if (subscription.kind === 'codex') return `自动读取本机 Codex 账号${onHomeText}`;
    if (subscription.kind === 'claude') {
      if (!claudeSnapshot) return claudeLink.usage ? `已接入 · 终端里的 claude 回复后上报（桌面 App 的 Code 页不上报）${onHomeText}` : `通过 Claude Code 状态栏 · 未接入${onHomeText}`;
      const minutes = Math.max(0, Math.round((Date.now() - claudeSnapshot.receivedAt) / 60000));
      return `通过 Claude Code 状态栏 · ${minutes ? `${minutes} 分钟前更新` : '刚刚更新'}${onHomeText}`;
    }
    return `手动 · 只显示续费倒计时${onHomeText}`;
  }

  function renderSettings() {
    if (!list) return;
    const homeIds = onHome().map((item) => item.id);
    const focusedId = document.activeElement?.closest?.('.ai-sub-row')?.dataset.id;
    const focusedClass = document.activeElement?.classList?.[0];
    list.replaceChildren();
    subscriptions.forEach((subscription, index) => {
      const row = node('div', 'ai-sub-row');
      row.dataset.id = subscription.id;
      const top = node('div', 'ai-sub-top');
      const mark = node('span', 'usage-mark', subscription.mark);
      mark.dataset.kind = subscription.kind;
      const info = node('div', 'ai-sub-info');
      info.append(node('b', '', subscription.name), node('small', '', sourceText(subscription, homeIds)));
      const toggle = node('label', 'ai-sub-toggle');
      const input = node('input');
      input.type = 'checkbox';
      input.checked = subscription.enabled;
      input.dataset.action = 'toggle';
      input.setAttribute('aria-label', `在首页显示 ${subscription.name}`);
      toggle.append(input, node('i'));
      top.append(mark, info, toggle);

      const controls = node('div', 'ai-sub-controls');
      const plan = node('input', 'ai-sub-plan-input');
      plan.value = subscription.plan;
      plan.maxLength = 16;
      plan.placeholder = '套餐';
      plan.dataset.action = 'plan';
      plan.setAttribute('aria-label', `${subscription.name} 套餐`);
      const day = node('select', 'ai-sub-day-select');
      dayOptions(day, subscription.renewalDay);
      day.dataset.action = 'day';
      day.setAttribute('aria-label', `${subscription.name} 每月续费日`);
      const up = node('button', 'icon-button ai-sub-move', '↑');
      up.type = 'button';
      up.dataset.action = 'up';
      up.disabled = index === 0;
      up.setAttribute('aria-label', `${subscription.name} 上移`);
      const down = node('button', 'icon-button ai-sub-move', '↓');
      down.type = 'button';
      down.dataset.action = 'down';
      down.disabled = index === subscriptions.length - 1;
      down.setAttribute('aria-label', `${subscription.name} 下移`);
      controls.append(plan, day, up, down);
      if (subscription.kind === 'claude') {
        const link = node('button', `workspace-button compact${claudeLink.usage ? '' : ' primary'}`, claudeLink.usage ? '断开' : '一键接入');
        link.type = 'button';
        link.dataset.action = claudeLink.usage ? 'claude-disconnect' : 'claude-connect';
        const manual = node('button', 'usage-text-button ai-sub-manual', '手动配置');
        manual.type = 'button';
        manual.dataset.action = 'claude-setup';
        manual.title = '复制状态栏设置，自己粘贴到 ~/.claude/settings.json';
        controls.append(link, manual);
      }
      if (subscription.kind === 'manual') {
        const remove = node('button', 'icon-button danger ai-sub-remove', '×');
        remove.type = 'button';
        remove.dataset.action = 'remove';
        remove.setAttribute('aria-label', `删除 ${subscription.name}`);
        controls.append(remove);
      }
      row.append(top, controls);
      list.append(row);
    });
    if (focusedId && focusedClass) {
      list.querySelector(`.ai-sub-row[data-id="${CSS.escape(focusedId)}"] .${CSS.escape(focusedClass)}`)?.focus({ preventScroll: true });
    }
  }

  function update(id, patch) {
    subscriptions = Ai.normalizeSubscriptions(subscriptions.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    save();
  }

  list?.addEventListener('change', (event) => {
    const row = event.target.closest('.ai-sub-row');
    const action = event.target.dataset.action;
    if (!row || !action) return;
    if (action === 'toggle') update(row.dataset.id, { enabled: event.target.checked });
    if (action === 'day') update(row.dataset.id, { renewalDay: event.target.value ? Number(event.target.value) : null });
    if (action === 'plan') update(row.dataset.id, { plan: event.target.value });
  });
  list?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    const row = event.target.closest('.ai-sub-row');
    if (!button || !row) return;
    const index = subscriptions.findIndex((item) => item.id === row.dataset.id);
    const action = button.dataset.action;
    if ((action === 'up' || action === 'down') && index > -1) {
      const target = action === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= subscriptions.length) return;
      const next = [...subscriptions];
      [next[index], next[target]] = [next[target], next[index]];
      subscriptions = next;
      save();
      list.querySelector(`.ai-sub-row[data-id="${CSS.escape(row.dataset.id)}"] [data-action="${action}"]`)?.focus();
    }
    if (action === 'remove') {
      subscriptions = subscriptions.filter((item) => item.id !== row.dataset.id);
      save();
    }
    if (action === 'claude-connect') connectClaude();
    if (action === 'claude-disconnect') disconnectClaude();
    if (action === 'claude-setup') {
      const setup = await window.notchAPI?.getClaudeStatuslineSetup?.().catch(() => null);
      const copied = setup && await window.notchAPI?.writeClipboard?.({ type: 'text', text: setup.snippet }).catch(() => false);
      toast(copied ? '已复制状态栏设置 · 粘贴到 ~/.claude/settings.json 后重启 Claude Code' : '复制失败');
    }
  });
  addForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = addName.value.trim();
    if (!name) {
      addName.focus();
      return;
    }
    if (subscriptions.filter((item) => item.kind === 'manual').length >= Ai.MAX_MANUAL) {
      toast(`最多添加 ${Ai.MAX_MANUAL} 个手动订阅`);
      return;
    }
    const id = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    subscriptions = Ai.normalizeSubscriptions([
      ...subscriptions,
      { id, name, plan: addPlan.value, renewalDay: addDay.value ? Number(addDay.value) : null, enabled: true },
    ]);
    addName.value = '';
    addPlan.value = '';
    addDay.value = '';
    save();
  });
  if (addDay) dayOptions(addDay, null);

  new MutationObserver(render).observe(tile, { attributes: true, attributeFilter: ['data-layout-variant'] });
  for (const eventName of ['notch:tabchange', 'notch:modechange', 'notch:home-modules-changed', 'visibilitychange']) {
    document.addEventListener(eventName, () => refreshClaude());
  }
  const timer = setInterval(() => refreshClaude(), CLAUDE_POLL_MS);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });

  render();
  renderSettings();
  refreshClaude(true);
  refreshClaudeLink();
  document.addEventListener('notch:tabchange', (event) => {
    if (['home', 'settings'].includes(event.detail?.tab)) refreshClaudeLink();
  });

  window.NotchAiUsageState = {
    isOnHome: (id) => onHome().some((item) => item.id === id),
    subscriptions: () => subscriptions.map((item) => ({ ...item })),
    refreshClaude: () => refreshClaude(true),
    claude: () => claudeSnapshot,
    claudeLink: () => ({ ...claudeLink }),
    connectClaude,
    disconnectClaude,
    openSettings,
    // 刘海下沿用：Claude 开着且数据不超过 6 小时时，返回最紧额度窗口的剩余百分比。
    claudeRemaining() {
      if (!subscriptions.some((item) => item.id === 'claude' && item.enabled)) return null;
      const summary = Ai.claudeSummary(claudeSnapshot);
      if (summary.state !== 'ready' || (summary.receivedAt && Date.now() - summary.receivedAt > 6 * 3600000)) return null;
      return summary.primary.remaining;
    },
  };
})();
