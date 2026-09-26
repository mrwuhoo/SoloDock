// AI 用量详情：点首页「AI 用量」卡片，从卡片位置展开一张宽 460 的玻璃浮层。
// 一眼看清还剩多少、什么时候恢复、什么时候续费、还有几张重置卡；只读，不替你做任何操作。
// 数据来自 codex-usage.js（本机 Codex app-server）与 ai-usage.js（Claude Code 状态栏），都只在内存里。
(function bootstrapUsageDetail() {
  'use strict';

  const Ai = window.NotchAiUsage;
  const get = (id) => document.getElementById(id);
  const tile = get('home-usage');
  const root = get('usage-pop');
  const card = get('usage-pop-card');
  if (!Ai || !tile || !root || !card) return;

  const ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>',
    sync: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12a7 7 0 0 1-12 4.9M5 12a7 7 0 0 1 12-4.9"/><path d="M17 3.5v3.6h-3.6M7 20.5v-3.6h3.6"/></svg>',
    plug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.5v4M15 3.5v4M7 7.5h10v3a5 5 0 0 1-10 0Z"/><path d="M12 15.5v5"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>',
  };
  let selected = '';

  const state = () => window.NotchAiUsageState;
  const codex = () => window.NotchCodexUsage?.state?.() || {};
  const subscriptions = () => (state()?.subscriptions?.() || []).filter((item) => item.enabled);
  const current = () => subscriptions().find((item) => item.id === selected) || subscriptions()[0] || null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick, html) {
    const node = el('button', className, text);
    node.type = 'button';
    if (html) node.innerHTML = html + (text || '');
    node.addEventListener('click', onClick);
    return node;
  }

  function lastSync(subscription) {
    if (subscription.kind === 'codex') return codex().lastUpdated || 0;
    if (subscription.kind === 'claude') return state()?.claude?.()?.receivedAt || 0;
    return 0;
  }

  function syncLabel(time) {
    if (!time) return '还没有同步';
    const minutes = Math.round((Date.now() - time) / 60000);
    return minutes < 1 ? '刚刚同步' : minutes < 60 ? `${minutes} 分钟前同步` : `同步于 ${Ai.momentLabel(time)}`;
  }

  function emptyState(icon, title, text, action) {
    const box = el('div', 'usage-pop-empty');
    const mark = el('span', 'usage-pop-empty-icon');
    mark.innerHTML = icon;
    box.append(mark, el('b', '', title), el('p', '', text));
    if (action) box.append(action);
    return box;
  }

  function windowBlock(item) {
    const block = el('div', 'usage-win');
    block.dataset.level = item.level;
    const top = el('div', 'usage-win-top');
    top.append(el('span', '', item.label));
    if (item.level === 'low' || item.level === 'critical') top.append(el('em', '', '即将用完'));
    top.append(el('strong', '', item.remaining === null ? '—' : `${Math.round(item.remaining)}%`));
    const track = el('div', 'usage-win-bar');
    const fill = el('i');
    fill.style.width = `${item.remaining === null ? 0 : Math.round(item.remaining)}%`;
    track.append(fill);
    const reset = el('p', 'usage-win-reset', item.expired
      ? '已到重置时间 · 等下一次同步'
      : item.resetsAt ? `${Ai.momentLabel(item.resetsAt)} 重置 · ${Ai.until(item.resetsAt)}` : '重置时间未提供');
    if (item.resetsAt) reset.title = new Date(item.resetsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
    block.append(top, track, reset);
    if (item.estimate.state === 'runs-out') block.append(el('p', 'usage-win-eta', `按当前速度，约${Ai.momentLabel(item.estimate.at)} 用完`));
    else if (item.estimate.state === 'enough') block.append(el('p', 'usage-win-eta calm', '按当前速度，撑得到重置'));
    return block;
  }

  function renewalRow(subscription) {
    const row = el('div', 'usage-pop-renewal');
    const renewal = Ai.renewalInfo(subscription.renewalDay);
    row.append(el('span', '', '续费'));
    if (renewal) {
      row.append(el('b', '', renewal.daysLeft === 0 ? `今天续费` : `${renewal.label} · 还有 ${renewal.daysLeft} 天`), el('small', '', '由你设置'));
      row.append(button('usage-pop-link', '修改', openSettings));
    } else {
      row.append(el('b', 'muted', '没有可读取的续费日'));
      row.append(button('usage-pop-link', '设置续费日', openSettings));
    }
    return row;
  }

  function openSettings() {
    close();
    state()?.openSettings?.();
  }

  function creditsBox(count) {
    const box = el('div', 'usage-pop-credits');
    box.append(el('strong', '', Number.isInteger(count) ? String(count) : '—'));
    const text = el('span');
    text.append(el('b', '', '张重置卡'), el('small', '', Number.isInteger(count) ? '来自当前 Codex 账号；要用的话在 Codex 里操作' : '账号没有返回重置卡数量'));
    box.append(text, button('usage-pop-link', '重置资讯 ›', () => {
      close();
      get('usage-news')?.click();
    }));
    return box;
  }

  function body(subscription) {
    const box = el('div', 'usage-pop-body');
    if (subscription.kind === 'codex') {
      const info = codex();
      if (!info.snapshot) {
        const action = button('usage-pop-primary', info.busy ? '正在读取…' : info.hasConnected ? '重试' : '连接并读取', () => window.NotchCodexUsage?.sync?.());
        action.disabled = Boolean(info.busy);
        box.append(info.error
          ? emptyState(ICON.info, '暂时读不到额度', `${info.error}为避免显示过期数字，旧额度已隐藏。${info.lastUpdated ? `上次成功同步：${Ai.momentLabel(info.lastUpdated)}` : ''}`, action)
          : emptyState(ICON.plug, '还没连接 Codex', '读取本机 Codex 当前登录账号的额度与重置卡，不需要填写密码。', action));
        box.append(renewalRow(subscription));
        return box;
      }
      const windows = Ai.detailWindows('codex', info.snapshot);
      if (!windows.length) box.append(el('p', 'usage-pop-note', '服务没有返回额度窗口。'));
      windows.forEach((item) => box.append(windowBlock(item)));
      box.append(creditsBox(info.snapshot.resetCredits), renewalRow(subscription));
      return box;
    }
    if (subscription.kind === 'claude') {
      const snapshot = state()?.claude?.();
      if (!snapshot) {
        const linked = state()?.claudeLink?.()?.usage;
        box.append(linked
          ? emptyState(ICON.info, '已接入，等第一次上报', 'Claude Code 回复一次后这里就会显示 5 小时与每周额度；已经开着的会话要重开一下。只有 Pro / Max 订阅会提供额度数据。')
          : emptyState(ICON.plug, '还没接入 Claude Code', '点一下，SoloDock 会在 Claude Code 的设置里登记状态栏：只加这一项，原来的设置都保留，随时可以断开。', button('usage-pop-primary', '一键接入', () => state()?.connectClaude?.())));
        box.append(renewalRow(subscription));
        return box;
      }
      Ai.detailWindows('claude', snapshot).forEach((item) => box.append(windowBlock(item)));
      box.append(renewalRow(subscription));
      return box;
    }
    box.append(el('p', 'usage-pop-note', `${subscription.name} 没有可读取的额度接口，这里只显示套餐和续费，不显示猜测的额度。`));
    box.append(renewalRow(subscription));
    return box;
  }

  function render() {
    const subscription = current();
    card.replaceChildren();
    const head = el('header', 'usage-pop-head');
    const tabs = el('div', 'usage-pop-tabs');
    tabs.setAttribute('role', 'tablist');
    subscriptions().forEach((item) => {
      const tab = button('', item.name, () => { selected = item.id; render(); });
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(subscription && item.id === subscription.id));
      const mark = el('span', 'usage-mark', item.mark);
      mark.dataset.kind = item.kind;
      tab.prepend(mark);
      tabs.append(tab);
    });
    head.append(tabs, button('usage-pop-close', '', close, ICON.close));
    head.lastChild.setAttribute('aria-label', '关闭');
    card.append(head);
    if (!subscription) {
      card.append(emptyState(ICON.info, '还没有要显示的订阅', '在设置里打开 Codex、Claude，或者添加其他订阅。', button('usage-pop-primary', '打开设置', openSettings)));
      return;
    }
    const meta = el('div', 'usage-pop-meta');
    meta.append(el('span', '', subscription.plan ? `${subscription.name} ${subscription.plan}` : subscription.name));
    if (subscription.kind !== 'manual') {
      meta.append(el('small', '', syncLabel(lastSync(subscription))));
      const busy = subscription.kind === 'codex' && codex().busy;
      const sync = button('usage-pop-sync', busy ? '同步中…' : '立即同步', () => {
        if (subscription.kind === 'codex') window.NotchCodexUsage?.sync?.();
        else state()?.refreshClaude?.();
        render();
      }, ICON.sync);
      sync.disabled = busy;
      meta.append(sync);
    }
    card.append(meta, body(subscription));
  }

  // 从卡片位置展开：左边对齐卡片，放不下时往上长，整张留在面板里。
  function place() {
    const container = root.offsetParent || root.parentElement;
    const box = container.getBoundingClientRect();
    const anchor = tile.getBoundingClientRect();
    const width = card.offsetWidth || 460;
    const height = card.offsetHeight || 360;
    card.style.left = `${Math.round(Math.max(12, Math.min(anchor.left - box.left, box.width - width - 12)))}px`;
    card.style.top = `${Math.round(Math.max(12, Math.min(anchor.top - box.top, box.height - height - 12)))}px`;
  }

  function open(subscriptionId) {
    if (subscriptionId) selected = subscriptionId;
    render();
    root.hidden = false;
    place();
    card.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  }

  function close() {
    if (root.hidden) return false;
    root.hidden = true;
    return true;
  }

  tile.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest('button, a, input, select, [data-widget-size-cycle]')) return;
    open(target.closest('[data-subscription]')?.dataset.subscription || '');
  });
  document.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!root.hidden && target && !card.contains(target) && !tile.contains(target)) close();
  }, true);
  document.addEventListener('notch:ai-usage-updated', () => { if (!root.hidden) { render(); place(); } });
  document.addEventListener('notch:tabchange', close);
  document.addEventListener('notch:modechange', (event) => { if (!event.detail?.expanded) close(); });

  window.NotchUsageDetail = { open, close, state: () => ({ open: !root.hidden, selected: current()?.id || '' }) };
})();
