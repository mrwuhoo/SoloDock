(() => {
  const tile = document.getElementById('home-usage');
  if (!tile) return;
  const get = (id) => document.getElementById(id);
  const refresh = get('codex-usage-refresh');
  const connect = get('usage-connect');
  const status = get('codex-usage-status');
  const updated = get('codex-usage-updated');
  const sync = get('usage-sync');
  const details = get('usage-details');
  const errors = {
    not_installed: '未找到 Codex 客户端，请先安装 Codex 桌面端或 CLI。',
    login_required: '请先在本机 Codex 中登录，再重试。',
    unsupported: '请更新 Codex 客户端后重试。',
    timeout: '读取超时，请检查网络后重试。',
    read_failed: '读取失败，请检查 Codex 登录状态与网络。',
    invalid_response: '暂时无法识别返回数据，请更新客户端后重试。',
  };
  const preferenceKey = 'notch-codex-usage-interval-v1';
  let firstConnection = true;
  let busy = false;
  let lastAttempt = null;
  let lastUpdated = null;
  let snapshot = null;
  let hasConnected = false;
  try {
    const saved = localStorage.getItem(preferenceKey);
    const legacy = localStorage.getItem('notch-codex-usage-auto-v1');
    sync.value = ['0', '1', '5', '15'].includes(saved) ? saved : legacy === 'true' ? '5' : '0';
    firstConnection = saved === null && legacy === null;
  } catch { sync.value = '0'; }

  const icon = document.querySelector('#tab-button-settings svg');
  if (icon) tile.querySelector('.usage-configure').append(icon.cloneNode(true));
  tile.querySelector('.usage-configure').addEventListener('click', () => {
    get('tab-button-settings').click();
    setTimeout(() => {
      get('settings-usage-card').scrollIntoView({ block: 'nearest', behavior: 'instant' });
      refresh.focus({ preventScroll: true });
    }, 220);
  });
  get('usage-news').addEventListener('click', () => {
    const button = get('tab-button-resets');
    if (button?.hidden) {
      get('tab-button-settings').click();
      get('settings-feature-list').scrollIntoView({ block: 'nearest' });
      return;
    }
    button?.click();
  });
  get('usage-source').addEventListener('click', () => window.notchAPI?.openExternal?.('https://aihot.news/codex-reset').catch(() => {}));

  function savePreference() {
    try { localStorage.setItem(preferenceKey, sync.value); } catch {}
  }
  function visible() {
    return document.visibilityState !== 'hidden'
      && get('app')?.classList.contains('expanded')
      && ((get('tab-home')?.classList.contains('active') && !tile.hidden)
        || get('tab-settings')?.classList.contains('active'));
  }
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function period(minutes) {
    if (minutes === 10080) return '本周剩余';
    if (!Number.isFinite(minutes) || minutes <= 0) return '剩余额度';
    if (minutes % 1440 === 0) return `${minutes / 1440} 天剩余`;
    if (minutes % 60 === 0) return `${minutes / 60} 小时剩余`;
    return `${minutes} 分钟剩余`;
  }
  const date = (time) => new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  function until(time) {
    const minutes = Math.ceil((time - Date.now()) / 60000);
    if (minutes <= 0) return '等待重新同步';
    if (minutes < 60) return `${minutes} 分钟后`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}后`;
    return `${Math.floor(minutes / 1440)} 天${Math.floor(minutes % 1440 / 60) ? ` ${Math.floor(minutes % 1440 / 60)} 小时` : ''}后`;
  }
  function currentRemaining(item) {
    if (!item || (item.resetsAt !== null && item.resetsAt <= Date.now())) return null;
    return Number.isFinite(item.remainingPercent) ? Math.max(0, Math.min(100, item.remainingPercent)) : null;
  }
  const percent = (value) => value === null ? '—' : `${Math.round(value * 10) / 10}%`;
  function clearWidget(message) {
    get('usage-remaining').textContent = '—';
    get('usage-period').textContent = '剩余额度';
    get('usage-meter').hidden = true;
    get('usage-reset').textContent = message;
    get('usage-reset').removeAttribute('title');
    get('usage-credits').textContent = '重置卡 —';
    get('usage-secondary').hidden = true;
    get('usage-empty').hidden = false;
    tile.dataset.state = 'empty';
    delete tile.dataset.level;
    details.replaceChildren();
  }
  function render(result) {
    const bucket = result.buckets.find((item) => item.id === 'codex') || result.buckets[0];
    const windows = bucket?.windows || [];
    const primary = windows.find((item) => item.durationMinutes === 10080) || windows[0];
    const remaining = currentRemaining(primary);
    get('usage-remaining').textContent = percent(remaining);
    if (remaining !== null) {
      get('usage-remaining').replaceChildren(document.createTextNode(String(Math.round(remaining * 10) / 10)), node('span', '%', 'usage-percent-sign'));
    }
    get('usage-period').textContent = period(primary?.durationMinutes);
    tile.dataset.level = remaining !== null && remaining <= 5 ? 'critical' : remaining !== null && remaining <= 20 ? 'low' : 'normal';
    tile.dataset.state = 'ready';
    get('usage-meter').hidden = remaining === null;
    get('usage-meter').value = remaining ?? 0;
    get('usage-meter').setAttribute('aria-label', `Codex ${period(primary?.durationMinutes)} ${percent(remaining)}`);
    const expired = primary?.resetsAt && primary.resetsAt <= Date.now();
    get('usage-reset').textContent = expired ? '已到重置时间 · 等待同步'
      : primary?.resetsAt ? `${primary.durationMinutes === 10080 ? '周额度' : '额度'}重置 · ${until(primary.resetsAt)}`
        : '重置时间未提供';
    get('usage-reset').title = primary?.resetsAt ? `${date(primary.resetsAt)} · 本机时区` : '';
    get('usage-empty').hidden = true;
    get('usage-credits').textContent = Number.isInteger(result.resetCredits) ? `重置卡 ${result.resetCredits} 张` : '重置卡 —';
    get('usage-credits').title = Number.isInteger(result.resetCredits) ? '来自当前 Codex 账号' : '账号未返回重置卡数量';
    const secondary = windows.find((item) => item !== primary);
    get('usage-secondary').hidden = !secondary || currentRemaining(secondary) === null;
    if (secondary) get('usage-secondary').textContent = `${period(secondary.durationMinutes)} ${percent(currentRemaining(secondary))}`;
    get('usage-account').textContent = 'Codex · 已连接';
    get('usage-account').dataset.connected = 'true';
    details.replaceChildren();
    for (const item of result.buckets) {
      for (const window of item.windows) {
        const row = node('div', undefined, 'usage-detail-row');
        row.append(node('span', `${item.name === 'codex' ? 'Codex' : item.name || '额度'} · ${period(window.durationMinutes)}`));
        row.append(node('strong', percent(currentRemaining(window))));
        row.append(node('small', window.resetsAt ? `${date(window.resetsAt)} 重置（本机时区）` : '重置时间未提供'));
        details.append(row);
      }
    }
    status.textContent = !windows.length ? '服务未返回额度窗口。' : expired ? '已到重置时间，请刷新。' : '已连接本机 Codex 当前登录账号。';
    updated.textContent = `更新于 ${date(result.updatedAt)} · 本机时区`;
    tile.title = updated.textContent;
  }
  async function read() {
    if (busy) return;
    busy = true;
    lastAttempt = Date.now();
    refresh.disabled = connect.disabled = true;
    status.textContent = '正在读取 Codex 额度…';
    status.dataset.state = 'loading';
    connect.textContent = '连接中…';
    try {
      const result = await window.notchAPI?.getCodexUsage?.();
      if (!result?.ok) throw new Error(result?.error || 'unavailable');
      snapshot = result;
      hasConnected = true;
      lastUpdated = result.updatedAt;
      render(result);
      status.dataset.state = 'ready';
    } catch (error) {
      snapshot = null;
      const message = errors[error.message] || '暂时无法连接 Codex，请稍后重试。';
      clearWidget(hasConnected ? '同步失败 · 当前额度未知' : '尚未连接 Codex');
      tile.title = message;
      status.dataset.state = 'error';
      status.textContent = message;
      get('usage-account').textContent = 'Codex · 连接待检查';
      delete get('usage-account').dataset.connected;
      updated.textContent = lastUpdated ? `上次成功 ${date(lastUpdated)} · 当前额度未知` : '';
    } finally {
      busy = false;
      refresh.disabled = connect.disabled = false;
      refresh.textContent = hasConnected ? '刷新额度' : '连接并读取';
      connect.textContent = '重新连接';
    }
  }
  function maybeRefresh() {
    if (!visible()) return;
    const interval = Number(sync.value) * 60000;
    if (interval > 0 && (lastAttempt === null || Date.now() - lastAttempt >= interval)) read();
    else if (snapshot && !busy) render(snapshot);
  }
  const manualRead = () => {
    if (firstConnection) { sync.value = '5'; firstConnection = false; savePreference(); }
    read();
  };
  refresh.addEventListener('click', manualRead);
  connect.addEventListener('click', manualRead);
  sync.addEventListener('change', () => { firstConnection = false; savePreference(); maybeRefresh(); });
  for (const event of ['notch:tabchange', 'notch:modechange', 'notch:home-modules-changed', 'visibilitychange']) document.addEventListener(event, maybeRefresh);
  const timer = setInterval(maybeRefresh, 30000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  maybeRefresh();
})();
