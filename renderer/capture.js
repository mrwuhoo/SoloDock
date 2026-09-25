// 随手记窗口：输入一条，实时显示会存成什么、存到哪里。
// ↩ 存入 · ⌘↩ 存入并打开 · ⇧↩ 换行 · ⇥ 换类型 · ⌘1–6 换分类 / 习惯 · esc 取消。
// 这里只读 LocalStorage 做预览（分类名、习惯、最近的分类），从不写；要存的内容交给主进程转给面板。
(function bootstrapCapture() {
  'use strict';

  const Capture = window.NotchCapture;
  const Life = window.NotchLife;
  const api = window.notchAPI || {};
  const $ = (id) => document.getElementById(id);
  const root = $('capture-root');
  const card = $('capture-card');
  const input = $('capture-input');
  const typesEl = $('capture-types');
  const target = $('capture-target');
  const targetText = $('capture-target-text');
  const save = $('capture-save');
  if (!Capture || !root || !input) return;

  const LINE = 24;
  const SHADOW_SPACE = 40;
  const DRAFT_TTL_MS = 10 * 60 * 1000;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let context = { categories: [], names: {}, habits: [], category: 'P3' };
  let picked = { type: '', category: '', habitId: '' };
  let result = null;
  let composing = false;
  let compositionEndedAt = 0;
  let busy = false;
  let hiddenAt = 0;
  let reportedHeight = 0;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function loadContext() {
    const categories = window.NotchTodo
      ? window.NotchTodo.normalizeCategories(readJson('notch-todo-categories-v1', null), readJson('notch-todo-category-names-v1', {}))
      : [];
    const ids = categories.map((category) => category.id);
    let habits = [];
    try { habits = Life ? Life.normalizeLife(readJson('notch-life-v1', {}) || {}).habits : []; } catch (error) {}
    context = {
      categories,
      names: Object.fromEntries(categories.map((category) => [category.id, category.name])),
      habits,
      category: Capture.lastUsedCategory(readJson('notch-todo-data', {}), ids),
    };
  }

  const categoryIds = () => context.categories.map((category) => category.id);
  const categoryColor = (id) => context.categories.find((category) => category.id === id)?.color || '';

  function habitOf(id) {
    return context.habits.find((item) => item.id === id) || null;
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight || LINE, LINE * 6)}px`;
    const height = Math.ceil(root.getBoundingClientRect().height) + SHADOW_SPACE;
    if (height !== reportedHeight) {
      reportedHeight = height;
      api.resizeCapture?.(height);
    }
  }

  function update() {
    const text = input.value;
    const empty = !text.trim();
    result = Capture.parseCapture(text, {
      type: picked.type,
      category: picked.category || context.category,
      categories: categoryIds(),
      habits: context.habits,
      habitId: picked.habitId,
    });
    const habit = result.type === 'life' ? habitOf(result.habitId) : null;
    card.dataset.type = result.type;
    card.dataset.icon = habit ? habit.icon : 'leaf';
    const color = empty ? '' : result.type === 'todo' ? categoryColor(result.category) : habit ? habit.color : '';
    if (color) card.dataset.color = color;
    else delete card.dataset.color;

    typesEl.querySelectorAll('button').forEach((button) => {
      const type = button.dataset.type;
      button.dataset.unavailable = String(!result.types.includes(type));
      button.setAttribute('aria-selected', String(type === result.type));
    });

    const pickable = !empty && (result.type === 'todo' || (result.type === 'life' && context.habits.length > 1));
    target.dataset.pickable = String(pickable);
    if (empty) {
      target.dataset.state = 'hint';
      targetText.textContent = '⇥ 换类型 · ⌘↩ 存入并打开';
    } else {
      target.dataset.state = result.valid ? '' : 'invalid';
      targetText.textContent = Capture.describe(result, { now: Date.now(), categoryNames: context.names, habits: context.habits });
    }
    target.title = pickable ? (result.type === 'todo' ? `换分类（⌘1–${context.categories.length}）` : `换习惯（⌘1–${Math.min(6, context.habits.length)}）`) : '';
    save.disabled = empty;
    autosize();
  }

  function cycleType(direction) {
    if (!input.value.trim()) return;
    picked.type = Capture.nextType(result.type, result.types, direction);
    update();
  }

  function pickIndex(index) {
    if (result.type === 'todo' && categoryIds()[index]) picked.category = categoryIds()[index];
    else if (result.type === 'life' && context.habits[index]) picked.habitId = context.habits[index].id;
    else return;
    update();
  }

  function cyclePick() {
    if (result.type === 'todo') {
      const ids = categoryIds();
      picked.category = ids[(ids.indexOf(result.category) + 1) % ids.length];
    } else if (result.type === 'life' && context.habits.length > 1) {
      const index = context.habits.findIndex((habit) => habit.id === result.habitId);
      picked.habitId = context.habits[(index + 1) % context.habits.length].id;
    } else {
      return;
    }
    update();
    input.focus();
  }

  function shake() {
    card.classList.remove('is-shaking');
    void card.offsetWidth;
    card.classList.add('is-shaking');
  }

  function reset() {
    input.value = '';
    picked = { type: '', category: '', habitId: '' };
    update();
  }

  async function submit(openAfter) {
    if (busy) return;
    update();
    if (!input.value.trim()) return;
    if (!result.valid) {
      shake();
      return;
    }
    busy = true;
    const entry = {
      text: input.value,
      type: result.type,
      category: result.type === 'todo' ? result.category : '',
      habitId: result.type === 'life' ? result.habitId : '',
      open: Boolean(openAfter),
    };
    root.classList.remove('is-open');
    root.classList.add('is-sent');
    await wait(reduceMotion() ? 60 : 170);
    const response = await Promise.resolve(api.submitCapture?.(entry)).catch(() => null);
    if (response?.ok) {
      reset();
      return;
    }
    busy = false;
    root.classList.remove('is-sent');
    root.classList.add('is-open');
    shake();
  }

  async function cancel() {
    if (busy || !root.classList.contains('is-open')) return;
    busy = true;
    root.classList.remove('is-open');
    root.classList.add('is-closing');
    await wait(reduceMotion() ? 40 : 120);
    reset();
    await Promise.resolve(api.cancelCapture?.('escape')).catch(() => {});
  }

  input.addEventListener('input', update);
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    compositionEndedAt = Date.now();
  });
  input.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab') {
      event.preventDefault();
      cycleType(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      submit(event.metaKey || event.ctrlKey);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    } else if ((event.metaKey || event.ctrlKey) && /^[1-6]$/.test(event.key)) {
      event.preventDefault();
      pickIndex(Number(event.key) - 1);
    }
  });

  typesEl.addEventListener('mousedown', (event) => event.preventDefault());
  typesEl.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-type]');
    if (!button || !input.value.trim()) return;
    picked.type = button.dataset.type;
    update();
  });
  target.addEventListener('mousedown', (event) => event.preventDefault());
  target.addEventListener('click', cyclePick);
  save.addEventListener('mousedown', (event) => event.preventDefault());
  card.addEventListener('submit', (event) => {
    event.preventDefault();
    submit(false);
  });

  // Esc 由主进程转发：输入法正在选字（或刚选完）时 Esc 属于输入法。
  api.onCaptureEscape?.(() => {
    if (composing || Date.now() - compositionEndedAt < 120) return;
    cancel();
  });

  api.onCaptureOpen?.(() => {
    loadContext();
    if (hiddenAt && Date.now() - hiddenAt > DRAFT_TTL_MS) {
      input.value = '';
      picked = { type: '', category: '', habitId: '' };
    }
    busy = false;
    root.classList.add('no-motion');
    root.classList.remove('is-open', 'is-sent', 'is-closing');
    update();
    void root.offsetWidth;
    root.classList.remove('no-motion');
    requestAnimationFrame(() => {
      root.classList.add('is-open');
      input.focus({ preventScroll: true });
      input.select();
    });
  });

  api.onCaptureHide?.((reason) => {
    hiddenAt = Date.now();
    busy = false;
    root.classList.add('no-motion');
    root.classList.remove('is-open', 'is-sent', 'is-closing');
    if (reason !== 'blur' && reason !== 'toggle') reset();
  });

  window.NotchCaptureWindow = { update, submit, cancel, state: () => ({ result, picked: { ...picked }, context }) };
  update();
})();
