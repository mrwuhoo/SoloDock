const test = require('node:test');
const assert = require('node:assert/strict');

const domain = require('../renderer/domain');
const {
  normalizeHttpUrl,
  createCommand,
  createRecording,
  removeRecordingState,
  calculateRecordingDuration,
  completionMatchesWindow,
  deriveWindowDisplayName,
  normalizeHiddenHomeModules,
  updateHomeModuleVisibility,
  calculateAudioLevel,
  resampleFloat32ToPcm16,
  shouldTogglePanelForSpace,
  updateRangeSelection,
  preferredLinkGroupId,
  moveLinkToGroup,
  moveLinkToPosition,
  filterCredentials,
  credentialRowAction,
  visiblePanelTabs,
  resolveDefaultPanelTab,
  settingsSummary,
  normalizeNoteArchive,
  filterNotes,
  updateNoteInArchive,
  updateNoteTitle,
  applyGeneratedNoteTitle,
  apiCredentialStatuses,
  prependClipboardHistory,
  createExclusiveAsyncTask,
} = domain;

const HOME_MODULES = ['now', 'energy', 'usage', 'mirror'];

test('an exclusive async task coalesces repeated starts until the first attempt settles', async () => {
  let release;
  let attempts = 0;
  const pendingStates = [];
  const task = createExclusiveAsyncTask((pending) => pendingStates.push(pending));
  const work = () => {
    attempts += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = task.run(work);
  const second = task.run(work);

  assert.equal(task.isPending(), true);
  assert.strictEqual(second, first);
  assert.equal(attempts, 1);
  assert.deepEqual(pendingStates, [true]);

  release('started');
  assert.equal(await first, 'started');
  assert.equal(task.isPending(), false);
  assert.deepEqual(pendingStates, [true, false]);

  assert.equal(await task.run(async () => {
    attempts += 1;
    return 'started-again';
  }), 'started-again');
  assert.equal(attempts, 2);
});

function assertExactHomeCover(layout, expectedIds) {
  assert.ok(layout);
  assert.equal(validateHomeWidgetLayout(layout, expectedIds, 12, 4), true);
  assert.deepEqual(Object.keys(layout.placements).sort(), [...expectedIds].sort());
  const cells = Array(48).fill(0);
  Object.entries(layout.placements).forEach(([id, item]) => {
    assert.ok(Number.isInteger(item.column) && item.column >= 0, `${id} has an invalid column`);
    assert.ok(Number.isInteger(item.row) && item.row >= 0, `${id} has an invalid row`);
    assert.ok(Number.isInteger(item.width) && item.width > 0, `${id} has an invalid width`);
    assert.ok(Number.isInteger(item.height) && item.height > 0, `${id} has an invalid height`);
    assert.ok(item.column + item.width <= 12, `${id} exceeds the grid width`);
    assert.ok(item.row + item.height <= 4, `${id} exceeds the grid height`);
    for (let row = item.row; row < item.row + item.height; row += 1) {
      for (let column = item.column; column < item.column + item.width; column += 1) {
        cells[row * 12 + column] += 1;
      }
    }
  });
  assert.deepEqual(cells, Array(48).fill(1));
}

test('clipboard history preserves repeated copies of identical text', () => {
  const previous = [{ id: 'first', type: 'text', text: '同一段内容', timestamp: 100 }];
  const next = { id: 'second', type: 'text', text: '同一段内容', timestamp: 200 };
  const result = prependClipboardHistory(previous, next, 100);

  assert.deepEqual(result.history.map((entry) => entry.id), ['second', 'first']);
  assert.deepEqual(result.evicted, []);
});

test('clipboard history evicts only entries beyond its capacity', () => {
  const previous = [
    { id: 'first', type: 'text', text: 'A', timestamp: 100 },
    { id: 'older-image', type: 'image', imagePath: '/tmp/old.png', timestamp: 50 },
  ];
  const result = prependClipboardHistory(
    previous,
    { id: 'new', type: 'text', text: 'A', timestamp: 200 },
    2
  );

  assert.deepEqual(result.history.map((entry) => entry.id), ['new', 'first']);
  assert.deepEqual(result.evicted.map((entry) => entry.id), ['older-image']);
});

test('normalizeHttpUrl adds https and removes URL credentials', () => {
  assert.equal(normalizeHttpUrl(' example.com/docs '), 'https://example.com/docs');
  assert.equal(normalizeHttpUrl('https://user:secret@example.com/a'), 'https://example.com/a');
});

test('normalizeHttpUrl rejects non-web and local URLs', () => {
  assert.equal(normalizeHttpUrl('javascript:alert(1)'), null);
  assert.equal(normalizeHttpUrl('file:///tmp/a'), null);
  assert.equal(normalizeHttpUrl('http://localhost:3000'), null);
  assert.equal(normalizeHttpUrl('http://127.0.0.1/private'), null);
});

test('same-site links reuse an existing group', () => {
  const groups = [
    { id: 'product', name: 'Lollipop', links: [{ id: 'home', url: 'https://lollipop.plus/' }] },
    { id: 'work', name: '工作', links: [{ id: 'docs', url: 'https://docs.example.com/' }] },
  ];
  assert.equal(preferredLinkGroupId(groups, 'https://docs.lollipop.plus/guide'), 'product');
  assert.equal(preferredLinkGroupId(groups, 'https://news.example.com/'), 'work');
  assert.equal(preferredLinkGroupId(groups, 'https://openai.com/'), '');
});

test('same-site grouping respects common multi-part and hosted public suffixes', () => {
  const groups = [
    { id: 'uk', name: '英国站', links: [{ id: 'uk-docs', url: 'https://docs.example.co.uk/' }] },
    { id: 'alice', name: 'Alice', links: [{ id: 'alice-home', url: 'https://alice.github.io/' }] },
  ];
  assert.equal(preferredLinkGroupId(groups, 'https://news.example.co.uk/'), 'uk');
  assert.equal(preferredLinkGroupId(groups, 'https://bob.github.io/'), '');
});

test('moving a link changes only its group and keeps an emptied source group available', () => {
  const groups = [
    { id: 'source', name: '来源', collapsed: false, links: [{ id: 'move-me', url: 'https://example.com/' }] },
    { id: 'target', name: '目标', collapsed: true, links: [{ id: 'stay', url: 'https://openai.com/' }] },
  ];
  const moved = moveLinkToGroup(groups, 'move-me', 'target');
  assert.deepEqual(moved.map((group) => [group.id, group.links.map((link) => link.id)]), [
    ['source', []],
    ['target', ['stay', 'move-me']],
  ]);
  assert.equal(groups[0].links.length, 1);
});

test('moveLinkToPosition reorders links inside one group in both directions', () => {
  const groups = [{ id: 'g1', name: '开发', collapsed: false, links: [
    { id: 'a', url: 'https://a.example.com/' },
    { id: 'b', url: 'https://b.example.com/' },
    { id: 'c', url: 'https://c.example.com/' },
  ] }];
  const order = (result) => result[0].links.map((link) => link.id);

  // 落点下标按「移动前」的行序算：拖 a 到 c 之后 = 目标下标 3。
  // 同组要先摘后插，若不把下标减一就会多跳一格，这里正是那个边界。
  assert.deepEqual(order(moveLinkToPosition(groups, 'a', 'g1', 3)), ['b', 'c', 'a']);
  // 往上拖不需要修正下标。
  assert.deepEqual(order(moveLinkToPosition(groups, 'c', 'g1', 0)), ['c', 'a', 'b']);
  // 拖到 c 之前 = 下标 2，修正后落在 b 与 c 之间。
  assert.deepEqual(order(moveLinkToPosition(groups, 'a', 'g1', 2)), ['b', 'a', 'c']);
  // 拖回原位视为无变化。
  assert.deepEqual(order(moveLinkToPosition(groups, 'b', 'g1', 1)), ['a', 'b', 'c']);
  // 原数组不能被改动，渲染层靠这一点判断顺序有没有真的变。
  assert.deepEqual(order(groups), ['a', 'b', 'c']);
});

test('moveLinkToPosition inserts at an exact slot when crossing groups', () => {
  const groups = [
    { id: 'source', name: '来源', collapsed: false, links: [{ id: 'x', url: 'https://x.example.com/' }] },
    { id: 'target', name: '目标', collapsed: false, links: [
      { id: 'p', url: 'https://p.example.com/' },
      { id: 'q', url: 'https://q.example.com/' },
    ] },
  ];
  const layout = (result) => result.map((group) => [group.id, group.links.map((link) => link.id)]);

  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', 1)),
    [['source', []], ['target', ['p', 'x', 'q']]]);
  // 落在分组空白或折叠标题上时没有具体行，index 为 null 表示追加到末尾。
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', null)),
    [['source', []], ['target', ['p', 'q', 'x']]]);
  // 越界下标要被夹住，不能凭空造出空洞。
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'target', 99)),
    [['source', []], ['target', ['p', 'q', 'x']]]);
  // 未知链接或未知分组一律原样返回。
  assert.deepEqual(layout(moveLinkToPosition(groups, 'nope', 'target', 0)), layout(groups));
  assert.deepEqual(layout(moveLinkToPosition(groups, 'x', 'nope', 0)), layout(groups));
});

test('createCommand and createRecording normalize user-authored metadata', () => {
  assert.deepEqual(createCommand('  npm test  ', 'c1', 100), {
    id: 'c1',
    text: 'npm test',
    createdAt: 100,
  });
  assert.equal(createCommand('   ', 'c2', 100), null);
  const recording = createRecording({
    id: 'r1',
    createdAt: 200,
    durationMs: 1234.8,
    transcript: '  第一段录音  ',
    audioPath: '/tmp/r1.webm',
    mimeType: 'audio/webm',
  });
  assert.equal(recording.id, 'r1');
  assert.equal(recording.transcript, '第一段录音');
  assert.notEqual(recording.title, recording.transcript);
  assert.equal(recording.category, '未分类');
});

test('single recording deletion removes only its row and keeps a valid active recording', () => {
  const recordings = [
    { id: 'first', title: '第一条' },
    { id: 'second', title: '第二条' },
    { id: 'third', title: '第三条' },
  ];
  assert.deepEqual(removeRecordingState(recordings, 'second', ['first', 'second'], 'second'), {
    recordings: [recordings[0], recordings[2]],
    selection: ['first'],
    selectedId: 'third',
  });
  assert.deepEqual(removeRecordingState(recordings, 'third', [], 'first'), {
    recordings: [recordings[0], recordings[1]],
    selection: [],
    selectedId: 'first',
  });
});

test('completionMatchesWindow distinguishes projects across VS Code windows', () => {
  const completion = { project: '灵动岛', title: '链接页已完成' };
  assert.equal(completionMatchesWindow(completion, {
    appName: 'Visual Studio Code',
    title: '灵动岛 — main.js — Visual Studio Code',
  }), true);
  assert.equal(completionMatchesWindow(completion, {
    appName: 'Visual Studio Code',
    title: 'website — page.tsx — Visual Studio Code',
  }), false);
});

test('calculateRecordingDuration does not double subtract an active pause', () => {
  assert.equal(calculateRecordingDuration({
    startedAt: 1000,
    status: 'recording',
    pausedAt: 0,
    pausedTotalMs: 2000,
    now: 11000,
  }), 8000);
  assert.equal(calculateRecordingDuration({
    startedAt: 1000,
    status: 'paused',
    pausedAt: 6000,
    pausedTotalMs: 0,
    now: 8000,
  }), 5000);
});

test('window display names use the workspace from editor titles', () => {
  assert.equal(deriveWindowDisplayName({ appName: 'Cursor', title: 'README.md — CourseKit — Cursor' }), 'CourseKit');
});

test('credential search matches service or account without exposing passwords', () => {
  const rows = [
    { id: 'github', service: 'GitHub', account: 'hello@example.com', passwordMask: '********' },
    { id: 'feishu', service: '飞书', account: '13800000000', passwordMask: '********' },
  ];
  assert.deepEqual(filterCredentials(rows, 'GITHUB').map((row) => row.id), ['github']);
  assert.deepEqual(filterCredentials(rows, 'example').map((row) => row.id), ['github']);
  assert.deepEqual(filterCredentials(rows, '').map((row) => row.id), ['github', 'feishu']);
});

test('credential row routes its trailing action to delete while its body still opens editing', () => {
  assert.equal(typeof credentialRowAction, 'function', 'credentialRowAction must exist');
  assert.deepEqual(credentialRowAction({ requestedAction: 'delete' }), {
    type: 'delete',
    label: '删除',
    ariaLabel: '删除密钥',
  });
  assert.deepEqual(credentialRowAction({ copyField: 'account' }), { type: 'copy', field: 'account' });
  assert.deepEqual(credentialRowAction({ rowBody: true }), { type: 'edit' });
  assert.deepEqual(credentialRowAction({ rowBody: true, shiftKey: true }), { type: 'select' });
  assert.deepEqual(credentialRowAction({ rowBody: true, selected: true }), { type: 'select' });
});

test('settings stays at the far right when optional tabs are hidden', () => {
  assert.equal(typeof visiblePanelTabs, 'function', 'visiblePanelTabs must exist');
  const tabs = ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings'];
  assert.deepEqual(visiblePanelTabs(tabs, { todo: false, clip: true }), [
    'home', 'notes', 'links', 'recordings', 'credentials', 'clip', 'settings',
  ]);
  assert.deepEqual(visiblePanelTabs(tabs, {
    todo: false,
    notes: false,
    links: false,
    recordings: false,
    credentials: false,
    clip: false,
    settings: false,
  }), ['home', 'settings']);
});

test('default panel tab uses the preference only while that tab is visible', () => {
  assert.equal(resolveDefaultPanelTab('todo', ['home', 'todo', 'settings']), 'todo');
  assert.equal(resolveDefaultPanelTab('todo', ['home', 'settings']), 'home');
  assert.equal(resolveDefaultPanelTab('unknown', ['home', 'settings']), 'home');
});

test('settings summary combines safe API status with local device settings', () => {
  assert.equal(typeof settingsSummary, 'function', 'settingsSummary must exist');
  assert.deepEqual(settingsSummary({
    appSettings: { shortcut: 'Command+Shift+P', autoLaunch: true },
    workspace: { path: '/Users/test/Panel', portable: true },
    transcription: { configured: true, llmConfigured: false },
  }), {
    shortcut: 'Command+Shift+P',
    defaultTab: 'home',
    autoLaunch: true,
    workspacePath: '/Users/test/Panel',
    workspaceLabel: '自定义文件夹',
    transcription: { label: '已安全保存', state: 'saved' },
    llm: { label: '未配置', state: 'empty' },
  });
  assert.doesNotMatch(JSON.stringify(settingsSummary({
    transcription: { configured: true, apiKey: 'api-secret' },
  })), /api-secret/);
});

test('saved notes preserve cleared content and keep recently updated notes first', () => {
  const notes = normalizeNoteArchive([
    { id: 'older', title: '产品复盘', titleSource: 'model', content: '  # 旧笔记\n正文  ', createdAt: 100, updatedAt: 200 },
    { id: 'newer', content: '新笔记', createdAt: 300, updatedAt: 400 },
    { id: 'empty', content: '', createdAt: 500, updatedAt: 500 },
    null,
  ]);
  assert.deepEqual(notes.map((note) => note.id), ['empty', 'newer', 'older']);
  assert.equal(notes[0].content, '');
  assert.equal(notes[2].content, '  # 旧笔记\n正文  ');
  assert.equal(notes[2].title, '产品复盘');
  assert.equal(notes[2].titleSource, 'model');
  assert.equal(notes[2].updatedAt, 200);
});

test('editing a saved note updates content and timestamp without losing its identity', () => {
  const notes = normalizeNoteArchive([
    { id: 'selected', content: '旧内容', createdAt: 100, updatedAt: 200 },
    { id: 'other', content: '其他笔记', createdAt: 150, updatedAt: 300 },
  ]);
  const updated = updateNoteInArchive(notes, 'selected', '新内容\n第二行', 400);
  assert.deepEqual(updated.map((note) => note.id), ['selected', 'other']);
  assert.deepEqual(updated[0], {
    id: 'selected',
    title: '',
    titleSource: '',
    content: '新内容\n第二行',
    createdAt: 100,
    updatedAt: 400,
  });

  const cleared = updateNoteInArchive(updated, 'selected', '', 500);
  assert.equal(cleared[0].content, '');
  assert.equal(normalizeNoteArchive(JSON.parse(JSON.stringify(cleared)))[0].id, 'selected');
});

test('note search matches titles and full content without changing archive order', () => {
  const notes = normalizeNoteArchive([
    { id: 'one', title: 'TO-DO Panel 设计', titleSource: 'model', content: '正文没有产品英文名', createdAt: 100, updatedAt: 300 },
    { id: 'two', content: '会议备忘\n下周交付录制功能', createdAt: 200, updatedAt: 200 },
  ]);
  assert.deepEqual(filterNotes(notes, 'to-do').map((note) => note.id), ['one']);
  assert.deepEqual(filterNotes(notes, '录制').map((note) => note.id), ['two']);
  assert.deepEqual(filterNotes(notes, '').map((note) => note.id), ['one', 'two']);
});

test('users can rename a note without changing its content', () => {
  const notes = normalizeNoteArchive([
    { id: 'note-1', title: '模型标题', titleSource: 'model', content: '正文', createdAt: 100, updatedAt: 200 },
  ]);
  const renamed = updateNoteTitle(notes, 'note-1', '  用户自己的标题  ', 300);
  assert.deepEqual(renamed[0], {
    id: 'note-1',
    title: '用户自己的标题',
    titleSource: 'user',
    content: '正文',
    createdAt: 100,
    updatedAt: 300,
  });
});

test('generated note titles never overwrite user titles or stale content', () => {
  const base = normalizeNoteArchive([
    { id: 'note-1', content: '最初正文', createdAt: 100, updatedAt: 200 },
  ]);
  const generated = applyGeneratedNoteTitle(base, 'note-1', '模型概括标题', '最初正文');
  assert.equal(generated[0].title, '模型概括标题');
  assert.equal(generated[0].titleSource, 'model');

  const userRenamed = updateNoteTitle(generated, 'note-1', '我的标题', 300);
  assert.equal(applyGeneratedNoteTitle(userRenamed, 'note-1', '迟到的模型标题', '最初正文')[0].title, '我的标题');

  const edited = updateNoteInArchive(base, 'note-1', '已经变化的正文', 400);
  assert.equal(applyGeneratedNoteTitle(edited, 'note-1', '过期标题', '最初正文')[0].title, '');
});

test('API credential statuses distinguish saved, missing, and legacy keys that need re-entry', () => {
  assert.deepEqual(apiCredentialStatuses({
    configured: true,
    llmConfigured: false,
    llmNeedsReentry: true,
  }), {
    transcription: { label: '已安全保存', state: 'saved' },
    llm: { label: '需重新输入', state: 'warning' },
  });
  assert.deepEqual(apiCredentialStatuses({}), {
    transcription: { label: '未配置', state: 'empty' },
    llm: { label: '未配置', state: 'empty' },
  });
});

test('hidden homepage modules are deduplicated and normalized to module order', () => {
  assert.deepEqual(
    normalizeHiddenHomeModules(['mirror', 'unknown', 'mirror', 'energy'], HOME_MODULES),
    ['energy', 'mirror']
  );
  assert.deepEqual(normalizeHiddenHomeModules('mirror', HOME_MODULES), []);
  assert.deepEqual(normalizeHiddenHomeModules([...HOME_MODULES], HOME_MODULES), []);
});

test('homepage visibility refuses to hide the final visible module', () => {
  const threeHidden = HOME_MODULES.slice(0, 3);
  assert.deepEqual(
    updateHomeModuleVisibility(threeHidden, HOME_MODULES, 'mirror', false),
    { ok: false, error: 'at_least_one_required', hiddenIds: threeHidden }
  );
  assert.deepEqual(
    updateHomeModuleVisibility(['mirror'], HOME_MODULES, 'mirror', true),
    { ok: true, hiddenIds: [] }
  );
  assert.deepEqual(
    updateHomeModuleVisibility([], HOME_MODULES, 'unknown', false),
    { ok: false, error: 'invalid_module', hiddenIds: [] }
  );
});

test('audio level returns stable RMS volume for recording strands', () => {
  assert.equal(calculateAudioLevel(new Float32Array([0, 0, 0])), 0);
  assert.equal(calculateAudioLevel(new Float32Array([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.equal(calculateAudioLevel(new Float32Array([2, -2])), 1);
});

test('resampleFloat32ToPcm16 downsamples and clamps audio', () => {
  const pcm = resampleFloat32ToPcm16(new Float32Array([1.5, 1, -1.5, -1]), 32000, 16000);
  assert.deepEqual(Array.from(pcm), [32767, -32768]);
});

test('shouldTogglePanelForSpace toggles plain Space but never steals typing input', () => {
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: false }), true);
  assert.equal(shouldTogglePanelForSpace({ key: 'Spacebar', repeat: false, editable: false }), true);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: true, editable: false }), false);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: true }), false);
  assert.equal(shouldTogglePanelForSpace({ key: ' ', repeat: false, editable: false, metaKey: true }), false);
});

test('mirror pinch zooms only a live camera and stays within safe bounds', () => {
  assert.equal(domain.shouldHandleMirrorPinch?.({ live: false, ctrlKey: true }), false);
  assert.equal(domain.shouldHandleMirrorPinch?.({ live: true, ctrlKey: false }), false);
  assert.equal(domain.shouldHandleMirrorPinch?.({ live: true, ctrlKey: true }), true);
  assert.equal(domain.adjustMirrorZoom?.(1, -100), 1.2);
  assert.equal(domain.adjustMirrorZoom?.(1, 100), 1);
  assert.equal(domain.adjustMirrorZoom?.(2.55, -100), 2.6);
});

test('Shift range selection selects contiguous rows while plain selection resets the range', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(updateRangeSelection(ids, [], 'b', null, false), {
    selected: ['b'],
    anchor: 'b',
  });
  assert.deepEqual(updateRangeSelection(ids, ['b'], 'd', 'b', true), {
    selected: ['b', 'c', 'd'],
    anchor: 'b',
  });
  assert.deepEqual(updateRangeSelection(ids, ['b', 'c', 'd'], 'c', 'b', false), {
    selected: ['c'],
    anchor: 'c',
  });
  assert.deepEqual(updateRangeSelection(ids, ['a'], 'missing', 'a', true), {
    selected: ['a'],
    anchor: 'a',
  });
});

test('credential selection can toggle its only selected row off', () => {
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(updateRangeSelection(ids, ['b'], 'b', 'b', false, true), {
    selected: [],
    anchor: null,
  });
});

test('today card lists overdue first, then today by deadline, and ignores later or done items', () => {
  const { todayTodoItems, todoDueLabel } = require('../renderer/domain');
  const now = new Date(2026, 8, 24, 14, 26).getTime();
  const at = (day, hour, minute = 0) => new Date(2026, 8, day, hour, minute).toISOString();
  const data = {
    P0: [{ id: 'a', text: '课程录制', deadline: at(24, 20) }, { id: 'done', text: '已完成', deadline: at(24, 15), done: true }],
    P1: [{ id: 'b', text: '周报复盘', deadline: at(24, 12) }, { id: 'c', text: '封面', deadline: at(24, 15, 0) }],
    P2: [{ id: 'later', text: '明天', deadline: at(25, 9) }],
    P3: [{ id: 'old', text: '上周', deadline: at(20, 9) }, { id: 'nodate', text: '没有日期' }],
  };
  const items = todayTodoItems(data, now);
  assert.deepEqual(items.map((item) => item.id), ['old', 'b', 'c', 'a']);
  assert.equal(items[0].label.text, '逾期 4 天');
  assert.equal(items[1].label.text, '逾期 2 小时');
  assert.deepEqual(items[2].label, { text: '还剩 34 分钟', tone: 'soon' });
  assert.deepEqual(items[3].label, { text: '20:00', tone: '' });
  assert.equal(todoDueLabel('', now).text, '');
});
