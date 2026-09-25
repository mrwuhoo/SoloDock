// 设置 › 身体与作息：久坐、护眼、收工三个提醒的开关与时间。设置保存在主进程（app-settings.json 的 body）。
(function bootstrapBodySettings() {
  'use strict';

  const get = (id) => document.getElementById(id);
  const card = get('settings-body-card');
  if (!card) return;
  const els = {
    sit: get('settings-body-sit'),
    sitMinutes: get('settings-body-sit-minutes'),
    sitHint: get('settings-body-sit-hint'),
    eye: get('settings-body-eye'),
    offwork: get('settings-body-offwork'),
    offworkTime: get('settings-body-offwork-time'),
    offworkHint: get('settings-body-offwork-hint'),
    worklog: get('settings-body-worklog'),
    worklogClear: get('settings-body-worklog-clear'),
  };
  const toast = (message) => {
    if (typeof window.showStatusToast === 'function') window.showStatusToast(message);
  };
  let body = null;

  function render() {
    if (!body) return;
    els.sit.checked = body.sit.enabled;
    els.sitMinutes.value = String(body.sit.minutes);
    els.sitMinutes.disabled = !body.sit.enabled;
    els.sitHint.textContent = `连续用电脑 ${els.sitMinutes.selectedOptions[0]?.textContent || `${body.sit.minutes} 分钟`}，提醒起来活动`;
    els.eye.checked = body.eye.enabled;
    els.offwork.checked = body.offwork.enabled;
    els.offworkTime.value = body.offwork.time;
    els.offworkTime.disabled = !body.offwork.enabled;
    els.offworkHint.textContent = `${body.offwork.time} 还在用电脑时，提醒把剩下的挪到明天`;
    if (els.worklog) els.worklog.checked = body.worklog?.enabled !== false;
  }

  async function load() {
    const settings = await window.notchAPI?.getAppSettings?.().catch(() => null);
    if (settings?.body) {
      body = settings.body;
      render();
    }
  }

  async function save(patch, message) {
    const result = await window.notchAPI?.setBodySettings?.(patch).catch(() => null);
    if (!result?.ok) {
      toast('保存失败，请稍后再试');
      render();
      return;
    }
    body = result.body;
    render();
    if (message) toast(message);
  }

  els.sit.addEventListener('change', () => save({ sit: { enabled: els.sit.checked } }, els.sit.checked ? '久坐提醒已开启' : '久坐提醒已关闭'));
  els.sitMinutes.addEventListener('change', () => save({ sit: { minutes: Number(els.sitMinutes.value) } }));
  els.eye.addEventListener('change', () => save({ eye: { enabled: els.eye.checked } }, els.eye.checked ? '护眼提醒已开启' : '护眼提醒已关闭'));
  els.offwork.addEventListener('change', () => save({ offwork: { enabled: els.offwork.checked } }, els.offwork.checked ? '收工提醒已开启' : '收工提醒已关闭'));
  els.offworkTime.addEventListener('change', () => {
    if (/^\d{2}:\d{2}$/.test(els.offworkTime.value)) save({ offwork: { time: els.offworkTime.value } }, `收工时间改为 ${els.offworkTime.value}`);
  });

  els.worklog?.addEventListener('change', () => save({ worklog: { enabled: els.worklog.checked } }, els.worklog.checked ? '已开始记录工作时间' : '已停止记录工作时间'));
  // 清除要点两次：第一次变成「确认清除」，3 秒内再点才清。
  els.worklogClear?.addEventListener('click', async () => {
    const button = els.worklogClear;
    if (button.dataset.confirm !== 'true') {
      button.dataset.confirm = 'true';
      button.textContent = '确认清除';
      setTimeout(() => { delete button.dataset.confirm; button.textContent = '清除记录'; }, 3000);
      return;
    }
    delete button.dataset.confirm;
    button.textContent = '清除记录';
    const cleared = await window.notchAPI?.clearWorklog?.().catch(() => false);
    toast(cleared ? '工作时间记录已清除' : '清除失败，请稍后再试');
    window.NotchTimePage?.load?.();
  });

  document.addEventListener('notch:tabchange', (event) => {
    if (event.detail?.tab === 'settings') load();
  });
  load();

  window.NotchBodySettings = { load, state: () => (body ? JSON.parse(JSON.stringify(body)) : null) };
})();
