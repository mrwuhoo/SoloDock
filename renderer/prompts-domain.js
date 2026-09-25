// Prompt library: pure data helpers shared by the renderer and Node tests.
// Prompts are stored locally and only copied by the user; SoloDock never runs them.
(function exposePromptDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.NotchPrompts = api;
})(typeof window !== 'undefined' ? window : globalThis, function createPromptDomain() {
  const MAX_PROMPTS = 500;
  const MAX_TEXT = 20000;
  // Variables filled automatically at copy time instead of through the form.
  const BUILTIN_VARIABLES = ['剪贴板', '日期'];
  const VARIABLE_PATTERN = /\{([^{}\n]{1,24})\}/g;

  const clean = (value, limit) => Array.from(String(value == null ? '' : value).replace(/\s+/g, ' ').trim())
    .slice(0, limit).join('');

  function titleFromText(text) {
    const firstLine = String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
    return clean(firstLine.replace(/\{([^{}]+)\}/g, '$1'), 24) || '未命名提示词';
  }

  function normalizePrompt(item) {
    if (!item || typeof item !== 'object') return null;
    const id = clean(item.id, 80);
    if (!id) return null;
    const text = String(item.text == null ? '' : item.text).slice(0, MAX_TEXT);
    const createdAt = Math.max(0, Number(item.createdAt) || 0);
    return {
      id,
      title: clean(item.title, 40) || titleFromText(text),
      text,
      group: clean(item.group, 12),
      starred: item.starred === true,
      uses: Math.max(0, Math.floor(Number(item.uses) || 0)),
      lastUsedAt: Math.max(0, Number(item.lastUsedAt) || 0),
      createdAt,
      updatedAt: Math.max(createdAt, Number(item.updatedAt) || createdAt),
    };
  }

  function normalizePrompts(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.map(normalizePrompt).filter((prompt) => {
      if (!prompt || seen.has(prompt.id)) return false;
      seen.add(prompt.id);
      return true;
    }).slice(0, MAX_PROMPTS);
  }

  // Former home "常用指令" entries become ungrouped prompts, keeping their order.
  function migrateCommands(commands) {
    if (!Array.isArray(commands)) return [];
    return normalizePrompts(commands.map((command) => {
      const text = String(command && command.text || '').trim();
      if (!text) return null;
      return {
        id: command.id,
        text,
        title: titleFromText(text),
        createdAt: command.createdAt,
        updatedAt: command.createdAt,
      };
    }).filter(Boolean));
  }

  function extractVariables(text) {
    const names = [];
    for (const match of String(text || '').matchAll(VARIABLE_PATTERN)) {
      const name = match[1].trim();
      if (name && !names.includes(name)) names.push(name);
    }
    return names;
  }

  function editableVariables(text) {
    return extractVariables(text).filter((name) => !BUILTIN_VARIABLES.includes(name));
  }

  function formatDate(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  }

  // Unfilled variables stay as written so the user can see what is missing.
  function fillTemplate(text, values = {}, context = {}) {
    const builtins = {
      剪贴板: typeof context.clipboard === 'string' ? context.clipboard : null,
      日期: formatDate(Number.isFinite(context.now) ? context.now : Date.now()),
    };
    return String(text || '').replace(VARIABLE_PATTERN, (whole, rawName) => {
      const name = rawName.trim();
      if (Object.prototype.hasOwnProperty.call(builtins, name) && builtins[name] !== null) return builtins[name];
      const value = values && typeof values[name] === 'string' ? values[name] : '';
      return value.trim() ? value : whole;
    });
  }

  function promptGroups(prompts) {
    const groups = [];
    normalizePrompts(prompts).forEach((prompt) => {
      if (prompt.group && !groups.includes(prompt.group)) groups.push(prompt.group);
    });
    return groups;
  }

  // group: '' = all, '★' = starred only, otherwise an exact group name.
  function filterPrompts(prompts, query = '', group = '') {
    const needle = String(query || '').trim().toLowerCase();
    return normalizePrompts(prompts)
      .filter((prompt) => (group === '★' ? prompt.starred : !group || prompt.group === group))
      .filter((prompt) => !needle
        || prompt.title.toLowerCase().includes(needle)
        || prompt.text.toLowerCase().includes(needle)
        || prompt.group.toLowerCase().includes(needle))
      // Editing must not reorder the list under the cursor, so updatedAt is not a sort key.
      .sort((left, right) => (right.lastUsedAt - left.lastUsedAt) || (right.createdAt - left.createdAt));
  }

  function recordUse(prompts, id, now = Date.now()) {
    return normalizePrompts(prompts).map((prompt) => (
      prompt.id === id ? { ...prompt, uses: prompt.uses + 1, lastUsedAt: now } : prompt
    ));
  }

  return {
    MAX_PROMPTS,
    BUILTIN_VARIABLES,
    titleFromText,
    normalizePrompts,
    migrateCommands,
    extractVariables,
    editableVariables,
    fillTemplate,
    promptGroups,
    filterPrompts,
    recordUse,
  };
});
