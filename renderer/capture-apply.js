// 随手记落地：随手记窗口经主进程把一条内容交给面板，由面板写进待办、笔记、链接或生活。
// 数据只由面板这一个窗口写，避免两个窗口各自拿着旧的 LocalStorage 互相覆盖。
(function setupCaptureApply() {
  'use strict';

  const Capture = window.NotchCapture;
  if (!Capture || !window.notchAPI?.onCaptureAdd) return;

  function habits() {
    try {
      return window.NotchLifePage?.state?.().habits
        || window.NotchLife.normalizeLife(JSON.parse(localStorage.getItem('notch-life-v1') || 'null') || {}).habits;
    } catch (error) {
      return [];
    }
  }

  function save(result, at) {
    if (result.type === 'todo') {
      const id = window.NotchTodos?.add?.(result.category, result.text, result.deadline);
      return id ? { tab: 'todo', open: () => window.NotchTodos.focus(id) } : null;
    }
    if (result.type === 'link') {
      const outcome = window.NotchLinks?.add?.(result.url, result.title);
      if (outcome === 'duplicate') return { tab: 'links', message: '这个链接已经收藏过了', open: () => setActiveTab('links') };
      return outcome === 'saved' ? { tab: 'links', open: () => setActiveTab('links') } : null;
    }
    if (result.type === 'life') {
      if (!window.NotchLifePage?.addRecord) return null;
      window.NotchLifePage.addRecord({ habitId: result.habitId, at: result.at, item: result.item, minutes: result.minutes, note: result.note });
      return { tab: 'life', open: () => setActiveTab('life') };
    }
    const id = window.NotchNotes?.appendCapture?.(result.text, at);
    return id ? { tab: 'notes', open: () => window.NotchNotes.open(id) } : null;
  }

  async function apply(entry) {
    const at = Number(entry?.at) || Date.now();
    const lifeHabits = habits();
    const categoryIds = (window.NotchTodos?.categories?.() || []).map((category) => category.id);
    const result = Capture.parseCapture(entry?.text, {
      now: at,
      type: entry?.type,
      category: entry?.category || Capture.lastUsedCategory(window.NotchTodos?.items?.(), categoryIds),
      categories: categoryIds,
      habits: lifeHabits,
      habitId: entry?.habitId,
    });
    if (!result.valid) return null;
    const saved = save(result, at);
    const message = saved ? (saved.message || Capture.confirmation(result, { now: at, habits: lifeHabits })) : '没存上，请在面板里再试一次';
    const expanded = document.getElementById('app')?.classList.contains('expanded');
    if (entry.open && saved) {
      if (!expanded) await setMode(true);
      await saved.open();
      showStatusToast(message);
    } else if (expanded) {
      showStatusToast(message);
    } else {
      window.NotchNotchStatus?.flash?.(message, saved ? saved.tab : '');
    }
    return saved;
  }

  window.notchAPI.onCaptureAdd((entry) => {
    apply(entry).catch(() => {});
  });

  // 首页「记一笔」走同一条路：{ text, at } → 待办 / 链接 / 生活 / 随手记笔记。
  window.NotchCaptureApply = { apply: (entry) => apply(entry || {}).catch(() => null) };
})();
