(function initWorkspace() {
  const Domain = window.NotchDomain;
  if (!Domain) return;

  const RECORDINGS_KEY = 'notch-recordings';

  const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>';
  const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12"/></svg>';
  const ADD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10zM13.8 6.7l3.5 3.5"/></svg>';
  const OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8"/><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';

  function uid(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function loadJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed == null ? fallback : parsed;
    } catch (error) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatShortDate(timestamp) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  }

  // 链接页在 links-page.js（window.NotchLinks）。

  function createIconButton(action, label, icon, danger = false) {
    const button = document.createElement('button');
    button.className = `icon-button${danger ? ' danger' : ''}`;
    button.type = 'button';
    button.dataset.action = action;
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;
    return button;
  }

  // ============ 录音与转写 ============
  const recordingStrands = document.getElementById('recording-strands');
  const recordingNew = document.getElementById('recording-new');
  const recordingConfigure = document.getElementById('recording-configure');
  const recordingList = document.getElementById('recording-list');
  const recordingDetail = document.getElementById('recording-detail');
  const recordingCount = document.getElementById('recording-count');
  const recordingBulkDelete = document.getElementById('recording-bulk-delete');
  const transcriptionSettingsBackdrop = document.getElementById('transcription-settings-backdrop');
  const transcriptionSettingsClose = document.getElementById('transcription-settings-close');
  const transcriptionSettingsCancel = document.getElementById('transcription-settings-cancel');
  const transcriptionSettingsSave = document.getElementById('transcription-settings-save');
  const transcriptionApiKey = document.getElementById('transcription-api-key');
  const transcriptionApiStatus = document.getElementById('transcription-api-status');
  const transcriptionApiHelp = document.getElementById('transcription-api-help');
  const transcriptionRegion = document.getElementById('transcription-region');
  const transcriptionWorkspace = document.getElementById('transcription-workspace');
  const llmApiKey = document.getElementById('llm-api-key');
  const llmApiStatus = document.getElementById('llm-api-status');
  const llmApiHelp = document.getElementById('llm-api-help');
  const llmBaseUrl = document.getElementById('llm-base-url');
  const llmModel = document.getElementById('llm-model');
  const transcriptionSettingsNote = document.getElementById('transcription-settings-note');
  const settingsApiConfigure = document.getElementById('settings-api-configure');
  const settingsTranscriptionStatus = document.getElementById('settings-transcription-status');
  const settingsLlmStatus = document.getElementById('settings-llm-status');
  const settingsFeatureList = document.getElementById('settings-feature-list');
  const settingsHomeModuleList = document.getElementById('settings-home-module-list');
  const settingsShortcutValue = document.getElementById('settings-shortcut-value');
  const settingsShortcutChange = document.getElementById('settings-shortcut-change');
  const settingsCaptureValue = document.getElementById('settings-capture-value');
  const settingsCaptureChange = document.getElementById('settings-capture-change');
  const settingsDefaultTab = document.getElementById('settings-default-tab');
  const settingsWorkspaceKind = document.getElementById('settings-workspace-kind');
  const settingsWorkspacePath = document.getElementById('settings-workspace-path');
  const settingsWorkspaceOpen = document.getElementById('settings-workspace-open');
  const settingsWorkspaceChoose = document.getElementById('settings-workspace-choose');
  const settingsAutoLaunch = document.getElementById('settings-auto-launch');
  const settingsInlineNote = document.getElementById('settings-inline-note');

  let recordings = loadJson(RECORDINGS_KEY, []).map(Domain.createRecording).filter(Boolean);
  let selectedRecordingId = recordings[0] && recordings[0].id;
  let recordingSelection = new Set();
  let recordingSelectionAnchor = selectedRecordingId || null;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let speechRecognition = null;
  let speechRecognitionBlocked = false;
  let speechRecognitionError = '';
  let recordingStatus = 'idle';
  let recordingStartedAt = 0;
  let pausedAt = 0;
  let pausedTotalMs = 0;
  let recordingTranscript = '';
  let interimTranscript = '';
  let recordingTimer = null;
  let recordingStopDurationMs = 0;
  let recordingCaptureIssue = '';
  let recordingDraftId = '';
  let currentAudioUrl = '';
  let transcriptionConfig = {
    configured: false,
    asrNeedsReentry: false,
    region: 'beijing',
    workspaceId: '',
    llmConfigured: false,
    llmNeedsReentry: false,
    llmBaseUrl: 'https://api.deepseek.com',
    llmModel: 'deepseek-v4-flash',
  };
  let settingsAppSettings = null;
  let settingsWorkspace = null;
  let transcriptionStatus = 'idle';
  let transcriptionAudioGap = false;
  let transcriptionStartPromise = null;
  let transcriptionAudioContext = null;
  let transcriptionAudioSource = null;
  let transcriptionAudioProcessor = null;
  let transcriptionAudioMute = null;
  let transcriptionFinishPromise = null;
  let strandsAudioContext = null;
  let strandsAudioSource = null;
  let strandsAnalyser = null;
  let strandsFrame = null;
  let strandsSamples = null;
  let strandsLevel = 0;
  const recordingStartTask = Domain.createExclusiveAsyncTask(() => updateRecordingUi());

  function isRecordingActive() {
    return ['recording', 'paused', 'saving'].includes(recordingStatus);
  }

  function isRecordingBusy() {
    return recordingStartTask.isPending() || isRecordingActive();
  }

  function stopRecordingStrands() {
    if (strandsFrame) cancelAnimationFrame(strandsFrame);
    strandsFrame = null;
    try { strandsAudioSource?.disconnect(); } catch (error) {}
    if (strandsAudioContext) strandsAudioContext.close().catch(() => {});
    strandsAudioContext = null;
    strandsAudioSource = null;
    strandsAnalyser = null;
    strandsSamples = null;
    strandsLevel = 0;
    const context = recordingStrands?.getContext('2d');
    context?.clearRect(0, 0, recordingStrands.width, recordingStrands.height);
  }

  function drawRecordingStrands(now) {
    if (!recordingStrands || !strandsAnalyser || !strandsSamples) {
      strandsFrame = null;
      return;
    }
    const bounds = recordingStrands.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    if (recordingStrands.width !== width || recordingStrands.height !== height) {
      recordingStrands.width = width;
      recordingStrands.height = height;
    }
    strandsAnalyser.getFloatTimeDomainData(strandsSamples);
    const measured = recordingStatus === 'recording' ? Domain.calculateAudioLevel(strandsSamples) : 0;
    strandsLevel += (measured - strandsLevel) * (measured > strandsLevel ? 0.34 : 0.08);
    const context = recordingStrands.getContext('2d');
    context.clearRect(0, 0, width, height);
    context.save();
    context.scale(dpr, dpr);
    context.globalCompositeOperation = 'lighter';
    const cssWidth = bounds.width;
    const cssHeight = bounds.height;
    const activeLevel = Math.min(1, strandsLevel * 6);
    const centerY = cssHeight * 0.55;
    const phase = now * 0.00115;
    const colors = [
      ['rgba(82, 224, 255, 0)', `rgba(82, 224, 255, ${0.2 + activeLevel * 0.44})`, 'rgba(82, 224, 255, 0)'],
      ['rgba(111, 128, 255, 0)', `rgba(111, 128, 255, ${0.22 + activeLevel * 0.5})`, 'rgba(111, 128, 255, 0)'],
      ['rgba(209, 96, 255, 0)', `rgba(209, 96, 255, ${0.19 + activeLevel * 0.46})`, 'rgba(209, 96, 255, 0)'],
      ['rgba(255, 102, 184, 0)', `rgba(255, 102, 184, ${0.17 + activeLevel * 0.4})`, 'rgba(255, 102, 184, 0)'],
      ['rgba(255, 210, 91, 0)', `rgba(255, 210, 91, ${0.14 + activeLevel * 0.34})`, 'rgba(255, 210, 91, 0)'],
    ];
    context.filter = `blur(${8 + activeLevel * 10}px)`;
    colors.forEach((palette, layer) => {
      const gradient = context.createLinearGradient(cssWidth * 0.08, 0, cssWidth * 0.92, 0);
      gradient.addColorStop(0, palette[0]);
      gradient.addColorStop(0.36 + layer * 0.025, palette[1]);
      gradient.addColorStop(0.72 - layer * 0.02, palette[1]);
      gradient.addColorStop(1, palette[2]);
      const heightScale = cssHeight * (0.06 + layer * 0.012 + activeLevel * (0.18 + layer * 0.014));
      const drift = Math.sin(phase + layer * 0.92) * cssHeight * 0.025;
      context.beginPath();
      context.moveTo(cssWidth * 0.04, centerY);
      for (let x = cssWidth * 0.04; x <= cssWidth * 0.96; x += 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.sin(progress * Math.PI * (2.2 + layer * 0.18) + phase + layer) * heightScale * 0.16;
        context.lineTo(x, centerY - envelope * heightScale - ripple + drift);
      }
      for (let x = cssWidth * 0.96; x >= cssWidth * 0.04; x -= 5) {
        const progress = (x - cssWidth * 0.04) / (cssWidth * 0.92);
        const envelope = Math.sin(Math.PI * progress) ** (1.45 + layer * 0.08);
        const ripple = Math.cos(progress * Math.PI * (2 + layer * 0.14) - phase - layer) * heightScale * 0.14;
        context.lineTo(x, centerY + envelope * heightScale + ripple + drift);
      }
      context.closePath();
      context.fillStyle = gradient;
      context.globalAlpha = 0.58 - layer * 0.055;
      context.fill();
    });
    context.filter = 'blur(2px)';
    const core = context.createLinearGradient(cssWidth * 0.16, 0, cssWidth * 0.84, 0);
    core.addColorStop(0, 'rgba(66, 191, 255, 0)');
    core.addColorStop(0.34, `rgba(172, 238, 255, ${0.3 + activeLevel * 0.55})`);
    core.addColorStop(0.58, `rgba(255, 209, 255, ${0.38 + activeLevel * 0.58})`);
    core.addColorStop(0.78, `rgba(255, 213, 117, ${0.24 + activeLevel * 0.5})`);
    core.addColorStop(1, 'rgba(255, 130, 196, 0)');
    context.globalAlpha = 1;
    context.fillStyle = core;
    context.fillRect(cssWidth * 0.08, centerY - 1.3 - activeLevel, cssWidth * 0.84, 2.6 + activeLevel * 2);
    context.restore();
    recordingDetail?.style.setProperty('--recording-level', Math.min(1, strandsLevel * 6).toFixed(3));
    strandsFrame = requestAnimationFrame(drawRecordingStrands);
  }

  function startRecordingStrands(stream) {
    stopRecordingStrands();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream || !recordingStrands) return;
    try {
      strandsAudioContext = new AudioContext();
      strandsAudioSource = strandsAudioContext.createMediaStreamSource(stream);
      strandsAnalyser = strandsAudioContext.createAnalyser();
      strandsAnalyser.fftSize = 512;
      strandsAnalyser.smoothingTimeConstant = 0.72;
      strandsSamples = new Float32Array(strandsAnalyser.fftSize);
      strandsAudioSource.connect(strandsAnalyser);
      strandsFrame = requestAnimationFrame(drawRecordingStrands);
    } catch (error) {
      stopRecordingStrands();
    }
  }

  function updateTranscriptionConfigUi() {
    const statuses = Domain.apiCredentialStatuses(transcriptionConfig);
    if (transcriptionApiStatus) {
      transcriptionApiStatus.textContent = statuses.transcription.label;
      transcriptionApiStatus.dataset.state = statuses.transcription.state;
    }
    if (llmApiStatus) {
      llmApiStatus.textContent = statuses.llm.label;
      llmApiStatus.dataset.state = statuses.llm.state;
    }
    if (transcriptionRegion) transcriptionRegion.value = transcriptionConfig.region || 'beijing';
    if (transcriptionWorkspace) transcriptionWorkspace.value = transcriptionConfig.workspaceId || '';
    if (llmBaseUrl) llmBaseUrl.value = transcriptionConfig.llmBaseUrl || 'https://api.deepseek.com';
    if (llmModel) llmModel.value = transcriptionConfig.llmModel || 'deepseek-v4-flash';
  }

  function setSettingsNote(message, error = false) {
    if (!settingsInlineNote) return;
    settingsInlineNote.textContent = message || '';
    settingsInlineNote.classList.toggle('error', error);
  }

  function renderSettingsPanel() {
    const summary = Domain.settingsSummary({
      appSettings: settingsAppSettings,
      workspace: settingsWorkspace,
      transcription: transcriptionConfig,
    });
    if (settingsTranscriptionStatus) {
      settingsTranscriptionStatus.textContent = summary.transcription.label;
      settingsTranscriptionStatus.dataset.state = summary.transcription.state;
    }
    if (settingsLlmStatus) {
      settingsLlmStatus.textContent = summary.llm.label;
      settingsLlmStatus.dataset.state = summary.llm.state;
    }
    if (settingsShortcutValue) settingsShortcutValue.textContent = summary.shortcut;
    if (settingsCaptureValue && settingsAppSettings) {
      const accelerator = settingsAppSettings.captureShortcut;
      const label = window.NotchCapture?.shortcutLabel?.(accelerator) || accelerator;
      const taken = Boolean(accelerator) && settingsAppSettings.captureShortcutRegistered === false;
      settingsCaptureValue.textContent = !accelerator ? '已关闭' : taken ? `${label} 被其他应用占用，换一个` : `${label} · 在任何应用里记一条`;
      settingsCaptureValue.dataset.state = taken ? 'warning' : '';
    }
    if (settingsDefaultTab) {
      const visibleTabs = new Set(Domain.visiblePanelTabs(
        ['home', 'todo', 'notes', 'links', 'recordings', 'credentials', 'clip', 'resets', 'time', 'life', 'settings'],
        settingsAppSettings?.features
      ));
      Array.from(settingsDefaultTab.options).forEach((option) => {
        const visible = visibleTabs.has(option.value);
        option.hidden = !visible;
        option.disabled = !visible;
      });
      settingsDefaultTab.value = visibleTabs.has(summary.defaultTab) ? summary.defaultTab : 'home';
    }
    if (settingsWorkspaceKind) settingsWorkspaceKind.textContent = summary.workspaceLabel;
    if (settingsWorkspacePath) {
      settingsWorkspacePath.textContent = summary.workspacePath || '默认数据目录';
      settingsWorkspacePath.title = summary.workspacePath || '';
    }
    if (settingsAutoLaunch) settingsAutoLaunch.checked = summary.autoLaunch;
    settingsFeatureList?.querySelectorAll('input[data-settings-feature]').forEach((input) => {
      input.checked = settingsAppSettings?.features?.[input.dataset.settingsFeature] !== false;
    });
    renderHomeModuleSettings();
  }

  function renderHomeModuleSettings() {
    const state = window.NotchHome?.getVisibility?.();
    const hidden = new Set(state?.hiddenIds || []);
    document.querySelectorAll('input[data-settings-home-module]').forEach((input) => {
      input.checked = !hidden.has(input.dataset.settingsHomeModule);
      input.disabled = false;
    });
    const status = document.getElementById('settings-home-module-status');
    if (status) {
      status.textContent = state?.persisted === false ? '仅当前会话 · 未能保存' : '隐藏后自动填充 · 至少保留一个';
      status.dataset.state = state?.persisted === false ? 'warning' : 'saved';
    }
  }

  async function refreshSettingsPanel() {
    if (!window.notchAPI) return;
    const [appSettings, workspace, config] = await Promise.all([
      window.notchAPI.getAppSettings?.().catch(() => null),
      window.notchAPI.getWorkspace?.().catch(() => null),
      window.notchAPI.getTranscriptionConfig?.().catch(() => null),
    ]);
    if (appSettings) settingsAppSettings = appSettings;
    if (workspace) settingsWorkspace = workspace;
    if (config) {
      transcriptionConfig = config;
      updateTranscriptionConfigUi();
      updateRecordingUi();
    }
    renderSettingsPanel();
  }

  async function loadTranscriptionConfig() {
    if (!window.notchAPI || typeof window.notchAPI.getTranscriptionConfig !== 'function') return;
    try {
      const config = await window.notchAPI.getTranscriptionConfig();
      if (config) transcriptionConfig = config;
    } catch (error) {}
    updateTranscriptionConfigUi();
    updateRecordingUi();
    renderSettingsPanel();
  }

  function openTranscriptionSettings() {
    if (!transcriptionSettingsBackdrop) return;
    transcriptionSettingsBackdrop.hidden = false;
    transcriptionSettingsNote.classList.remove('error', 'success');
    transcriptionSettingsNote.textContent = transcriptionConfig.asrNeedsReentry || transcriptionConfig.llmNeedsReentry
      ? '检测到旧版加密密钥，但升级后无法解密。请重新输入通义百炼与 DeepSeek 两把 API Key。'
      : transcriptionConfig.configured || transcriptionConfig.llmConfigured
        ? '已配置的 API Key 可留空；新输入的密钥会覆盖对应旧值。'
        : '请分别配置通义百炼实时转写与 DeepSeek 两把 API Key。';
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    setTimeout(() => transcriptionApiKey?.focus(), 0);
  }

  function closeTranscriptionSettings() {
    if (transcriptionSettingsBackdrop) transcriptionSettingsBackdrop.hidden = true;
  }

  async function saveTranscriptionSettings() {
    if (!window.notchAPI || !transcriptionSettingsSave) return;
    if (
      !transcriptionConfig.configured
      && !transcriptionApiKey.value.trim()
      && !transcriptionConfig.llmConfigured
      && !llmApiKey.value.trim()
    ) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = '请至少配置一个 API Key。';
      return;
    }
    transcriptionSettingsSave.disabled = true;
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.textContent = '正在安全保存…';
    let result;
    try {
      result = await window.notchAPI.setTranscriptionConfig({
        apiKey: transcriptionApiKey.value,
        region: transcriptionRegion.value,
        workspaceId: transcriptionWorkspace.value,
        llmApiKey: llmApiKey.value,
        llmBaseUrl: llmBaseUrl.value,
        llmModel: llmModel.value,
      });
    } catch (error) {
      result = { ok: false, error: 'save_failed' };
    }
    transcriptionSettingsSave.disabled = false;
    if (!result || !result.ok) {
      transcriptionSettingsNote.classList.add('error');
      transcriptionSettingsNote.textContent = result && result.error === 'invalid_workspace'
        ? 'Workspace ID 格式不正确。'
        : result && result.error === 'invalid_llm_url'
          ? '大语言模型 Base URL 必须是有效的 HTTPS 地址。'
        : result && result.error === 'secure_storage_unavailable'
          ? '当前系统安全存储不可用，可改用 DASHSCOPE_API_KEY 环境变量。'
          : '配置保存失败，请重试。';
      return;
    }
    transcriptionConfig = result;
    if (transcriptionApiKey) transcriptionApiKey.value = '';
    if (llmApiKey) llmApiKey.value = '';
    updateTranscriptionConfigUi();
    transcriptionSettingsNote.classList.remove('error');
    transcriptionSettingsNote.classList.add('success');
    transcriptionSettingsNote.textContent = '已安全保存。为保护密钥，输入框不会回显明文；上方状态可确认是否已配置。';
    transcriptionSettingsSave.textContent = '已保存';
    setTimeout(() => {
      if (transcriptionSettingsSave) transcriptionSettingsSave.textContent = '保存';
    }, 1200);
    if (
      transcriptionConfig.configured
      && ['recording', 'paused'].includes(recordingStatus)
      && !transcriptionStartPromise
    ) {
      stopSpeechRecognition();
      transcriptionStatus = 'idle';
      transcriptionStartPromise = startCloudTranscription();
    }
    updateRecordingUi();
    renderSettingsPanel();
  }

  function persistRecordings() {
    saveJson(RECORDINGS_KEY, recordings.filter((recording) => !recording.isDraft));
  }

  function currentDuration() {
    return Domain.calculateRecordingDuration({
      startedAt: recordingStartedAt,
      status: recordingStatus,
      pausedAt,
      pausedTotalMs,
      now: Date.now(),
    });
  }

  function activeRecordingDraft() {
    return recordingDraftId && recordings.find((recording) => recording.id === recordingDraftId) || null;
  }

  function currentRecordingText() {
    return `${recordingTranscript} ${interimTranscript}`.trim();
  }

  function currentRecordingFeedback() {
    if (recordingStartTask.isPending()) return '等待确认麦克风权限…';
    if (recordingCaptureIssue) return recordingCaptureIssue;
    if (recordingStatus === 'saving') return '正在保存录音…';
    if (transcriptionConfig.asrNeedsReentry) return '转写密钥已失效 · 请重新配置 API Key';
    if (transcriptionStatus === 'browser-error') return '未配置转写 API · 音频仍在录制';
    if (transcriptionStatus === 'error') return '转写连接失败 · 音频仍在录制';
    if (transcriptionStatus === 'reconnecting') return '转写中断，正在自动重连 · 音频仍在录制';
    if (transcriptionStatus === 'connecting') return '正在连接转写服务';
    if (transcriptionAudioGap) return '断线期间部分转写可能缺失 · 完整音频仍在本机录制';
    if (recordingStatus === 'paused') return '录音已暂停';
    if (!transcriptionConfig.configured && !currentRecordingText()) return '未配置转写 API · 音频仍会保存在本机';
    return '正在录音';
  }

  function beginRecordingDraft() {
    recordingDraftId = uid('recording');
    const draft = {
      ...Domain.createRecording({
        id: recordingDraftId,
        createdAt: recordingStartedAt,
        durationMs: 0,
        transcript: '',
      }),
      isDraft: true,
    };
    recordings.unshift(draft);
    selectedRecordingId = draft.id;
    recordingSelectionAnchor = draft.id;
    renderRecordings();
  }

  function discardRecordingDraft() {
    if (!recordingDraftId) return;
    recordings = recordings.filter((recording) => recording.id !== recordingDraftId);
    recordingSelection.delete(recordingDraftId);
    selectedRecordingId = recordings[0]?.id || '';
    recordingSelectionAnchor = selectedRecordingId || null;
    recordingDraftId = '';
    renderRecordings();
  }

  function syncRecordingDraftUi() {
    const draft = activeRecordingDraft();
    if (!draft) return;
    const durationMs = recordingStopDurationMs || currentDuration();
    const text = currentRecordingText();
    draft.durationMs = durationMs;
    draft.transcript = recordingTranscript;
    const row = recordingList?.querySelector(`.recording-item[data-id="${CSS.escape(draft.id)}"]`);
    const preview = row?.querySelector('[data-recording-preview]');
    const meta = row?.querySelector('[data-recording-meta]');
    if (preview) preview.textContent = text || currentRecordingFeedback();
    if (meta) meta.textContent = formatClock(durationMs);
    const rowTitle = row?.querySelector('.rec-row-top strong');
    if (rowTitle) rowTitle.textContent = recordingStatus === 'saving' ? '正在保存…' : recordingStatus === 'paused' ? '已暂停' : '正在录音…';
    if (selectedRecordingId !== draft.id) return;
    const detailState = recordingDetail?.querySelector('[data-recording-live-state]');
    const detailDot = recordingDetail?.querySelector('[data-recording-live-dot]');
    const detailTime = recordingDetail?.querySelector('[data-recording-live-time]');
    const detailTranscript = recordingDetail?.querySelector('[data-recording-live-transcript]');
    const detailFeedback = recordingDetail?.querySelector('[data-recording-live-feedback]');
    const detailConfigure = recordingDetail?.querySelector('[data-action="configure-transcription"]');
    const detailPause = recordingDetail?.querySelector('.recording-live-pause');
    const detailStop = recordingDetail?.querySelector('.recording-live-stop');
    if (detailState) detailState.textContent = recordingStatus === 'saving' ? '正在保存' : recordingStatus === 'paused' ? '已暂停' : '正在录音';
    if (detailDot) detailDot.dataset.state = recordingStatus;
    if (detailTime) detailTime.textContent = formatClock(durationMs);
    if (detailTranscript) {
      if (typeof detailTranscript.value === 'string') { if (detailTranscript.value !== text) detailTranscript.value = text; }
      else if (detailTranscript.textContent !== text) detailTranscript.textContent = text;
    }
    const detailTranscription = recordingDetail?.querySelector('[data-recording-live-transcription]');
    if (detailTranscription) {
      detailTranscription.textContent = !transcriptionConfig.configured || transcriptionConfig.asrNeedsReentry ? '未配置实时转写，音频仍会保存'
        : transcriptionStatus === 'reconnecting' ? '实时转写 · 重连中'
          : transcriptionStatus === 'connecting' ? '实时转写 · 连接中'
            : transcriptionStatus === 'error' || transcriptionStatus === 'browser-error' ? '实时转写 · 连接失败'
              : '实时转写 · 已连接';
    }
    if (detailFeedback) detailFeedback.textContent = currentRecordingFeedback();
    if (detailConfigure) detailConfigure.hidden = transcriptionConfig.configured && !transcriptionConfig.asrNeedsReentry;
    if (detailPause) {
      detailPause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      detailPause.disabled = recordingStatus === 'saving';
    }
    if (detailStop) detailStop.disabled = recordingStatus === 'saving';
  }

  function stopTranscriptionAudioPipeline() {
    if (transcriptionAudioProcessor) {
      transcriptionAudioProcessor.onaudioprocess = null;
      try { transcriptionAudioProcessor.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioSource) {
      try { transcriptionAudioSource.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioMute) {
      try { transcriptionAudioMute.disconnect(); } catch (error) {}
    }
    if (transcriptionAudioContext) transcriptionAudioContext.close().catch(() => {});
    transcriptionAudioContext = null;
    transcriptionAudioSource = null;
    transcriptionAudioProcessor = null;
    transcriptionAudioMute = null;
  }

  function sendTranscriptionPcm(buffer) {
    if (!buffer || !buffer.byteLength || !window.notchAPI) return;
    if (['connecting', 'connected', 'reconnecting'].includes(transcriptionStatus)) {
      window.notchAPI.sendTranscriptionAudio(buffer);
    }
  }

  function startTranscriptionAudioPipeline(stream) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !stream) return false;
    try {
      transcriptionAudioContext = new AudioContext({ sampleRate: 16000 });
      transcriptionAudioSource = transcriptionAudioContext.createMediaStreamSource(stream);
      transcriptionAudioProcessor = transcriptionAudioContext.createScriptProcessor(4096, 1, 1);
      transcriptionAudioMute = transcriptionAudioContext.createGain();
      transcriptionAudioMute.gain.value = 0;
      transcriptionAudioProcessor.onaudioprocess = (event) => {
        if (recordingStatus !== 'recording') return;
        const source = event.inputBuffer.getChannelData(0);
        const pcm = Domain.resampleFloat32ToPcm16(source, transcriptionAudioContext.sampleRate, 16000);
        sendTranscriptionPcm(pcm.buffer);
      };
      transcriptionAudioSource.connect(transcriptionAudioProcessor);
      transcriptionAudioProcessor.connect(transcriptionAudioMute);
      transcriptionAudioMute.connect(transcriptionAudioContext.destination);
      return true;
    } catch (error) {
      stopTranscriptionAudioPipeline();
      return false;
    }
  }

  async function startCloudTranscription() {
    if (!transcriptionConfig.configured || !window.notchAPI || !mediaStream) return { ok: false, error: 'not_configured' };
    transcriptionStatus = 'connecting';
    startTranscriptionAudioPipeline(mediaStream);
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.startTranscription();
    } catch (error) {
      result = { ok: false, error: 'connection_failed' };
    }
    if (recordingStatus !== 'recording' && recordingStatus !== 'paused') return result;
    if (!result || !result.ok) {
      transcriptionStatus = 'error';
      stopTranscriptionAudioPipeline();
      updateRecordingUi();
      return result || { ok: false };
    }
    if (transcriptionStatus === 'connecting') transcriptionStatus = 'connected';
    updateRecordingUi();
    return result;
  }

  async function finishCloudTranscription() {
    if (!transcriptionStartPromise) return { ok: false, error: 'not_active', transcript: recordingTranscript };
    stopTranscriptionAudioPipeline();
    // Send finish immediately: waiting for a reconnect here could block saving for a minute.
    transcriptionStartPromise = null;
    transcriptionStatus = 'finishing';
    updateRecordingUi();
    let result;
    try {
      result = await window.notchAPI.finishTranscription();
    } catch (error) {
      result = { ok: false, error: 'finish_failed', transcript: currentRecordingText() };
    }
    recordingTranscript = result?.transcript || currentRecordingText();
    transcriptionStatus = result && result.ok ? 'idle' : 'error';
    interimTranscript = '';
    updateRecordingUi();
    return result;
  }

  if (window.notchAPI && typeof window.notchAPI.onTranscriptionEvent === 'function') {
    window.notchAPI.onTranscriptionEvent((event) => {
      if (!event || !['recording', 'paused', 'saving'].includes(recordingStatus)) return;
      if (event.type === 'transcript') {
        recordingTranscript = String(event.final || '').trim();
        interimTranscript = String(event.interim || '').trim();
      } else if (event.type === 'error') {
        transcriptionStatus = 'error';
      } else if (event.type === 'status' && ['connected', 'reconnecting'].includes(event.status)) {
        if (transcriptionStatus !== 'finishing') transcriptionStatus = event.status;
      } else if (event.type === 'warning' && event.code === 'audio_gap') {
        transcriptionAudioGap = true;
      }
      updateRecordingUi();
    });
  }

  function updateRecordingUi() {
    const recordingActive = isRecordingActive();
    const recordingBusy = isRecordingBusy();
    if (recordingNew) {
      recordingNew.disabled = recordingBusy;
      const label = recordingNew.querySelector('span');
      if (label) label.textContent = recordingBusy ? '录音中' : '录音';
      else recordingNew.textContent = recordingBusy ? '录音中' : '录音';
      recordingNew.dataset.state = recordingBusy ? 'recording' : '';
      recordingNew.setAttribute('aria-label', recordingStartTask.isPending()
        ? '正在请求麦克风权限'
        : recordingActive ? '录音进行中' : '开始录音');
    }
    syncRecordingDraftUi();
    document.dispatchEvent(new CustomEvent('notch:recording-state-changed', {
      detail: { active: recordingBusy },
    }));
  }

  function stopSpeechRecognition() {
    const recognition = speechRecognition;
    speechRecognition = null;
    if (recognition) {
      try { recognition.stop(); } catch (error) {}
    }
    interimTranscript = '';
  }

  function startSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      transcriptionStatus = 'browser-error';
      updateRecordingUi();
      return;
    }
    if (speechRecognitionBlocked || recordingStatus !== 'recording') return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      interimTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const text = String(event.results[index][0] && event.results[index][0].transcript || '').trim();
        if (!text) continue;
        if (event.results[index].isFinal) {
          recordingTranscript = `${recordingTranscript} ${text}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${text}`.trim();
        }
      }
      updateRecordingUi();
    };
    recognition.onerror = (event) => {
      interimTranscript = '';
      speechRecognitionError = String(event && event.error || 'unknown');
      if (['network', 'not-allowed', 'service-not-allowed', 'audio-capture'].includes(speechRecognitionError)) {
        speechRecognitionBlocked = true;
        transcriptionStatus = 'browser-error';
      }
      updateRecordingUi();
    };
    recognition.onend = () => {
      if (speechRecognition !== recognition) return;
      speechRecognition = null;
      if (recordingStatus === 'recording' && !speechRecognitionBlocked) setTimeout(startSpeechRecognition, 180);
    };
    speechRecognition = recognition;
    try {
      recognition.start();
    } catch (error) {
      speechRecognition = null;
    }
  }

  function stopMediaTracks() {
    stopRecordingStrands();
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  function chooseRecordingMimeType() {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    return candidates.find((type) => window.MediaRecorder && MediaRecorder.isTypeSupported(type)) || '';
  }

  async function finalizeRecording(blob, durationMs) {
    recordingStatus = 'saving';
    updateRecordingUi();
    if (!blob || blob.size === 0) {
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      showRecorderNotice('录音为空 · 请检查麦克风输入');
      updateRecordingUi();
      return;
    }
    let saved;
    try {
      saved = window.notchAPI && await window.notchAPI.saveRecording({
        bytes: await blob.arrayBuffer(),
        mimeType: blob.type || 'audio/webm',
      });
    } catch (error) {
      saved = null;
    }
    if (saved && saved.ok) {
      const draft = activeRecordingDraft();
      const recording = Domain.createRecording({
        id: draft?.id || uid('recording'),
        createdAt: draft?.createdAt || Date.now(),
        durationMs,
        transcript: recordingTranscript,
        audioPath: saved.audioPath,
        mimeType: saved.mimeType || blob.type,
      });
      const draftIndex = recordings.findIndex((item) => item.id === recording.id);
      if (draftIndex >= 0) recordings.splice(draftIndex, 1, recording);
      else recordings.unshift(recording);
      recordingDraftId = '';
      selectedRecordingId = recording.id;
      persistRecordings();
      renderRecordings();
      if (recording.transcript && window.notchAPI?.organizeMaterial) {
        window.notchAPI.organizeMaterial({ kind: 'recording', text: recording.transcript }).then((metadata) => {
          const target = recordings.find((item) => item.id === recording.id);
          if (!target || !metadata || !metadata.ok) return;
          target.title = metadata.title || target.title;
          target.category = metadata.category || target.category;
          persistRecordings();
          renderRecordings();
        }).catch(() => {});
      }
      if (!recording.transcript) {
        showRecorderNotice(transcriptionConfig.configured ? '录音已保存 · 暂无转写' : '录音已保存 · 请配置转写 API');
      }
    } else {
      discardRecordingDraft();
      showRecorderNotice('录音保存失败，请检查本机存储权限');
    }
    recordingStatus = 'idle';
    recordingStartedAt = 0;
    pausedAt = 0;
    pausedTotalMs = 0;
    audioChunks = [];
    recordingTranscript = '';
    interimTranscript = '';
    recordingCaptureIssue = '';
    updateRecordingUi();
  }

  // 录音没能开始或保存时说一声；录音中的状态、转写与暂停 / 结束都在录音页的详情里。
  function showRecorderNotice(text) {
    if (typeof showStatusToast === 'function') showStatusToast(text);
  }

  async function startRecordingAttempt() {
    if (recordingStatus !== 'idle' || !navigator.mediaDevices || !window.MediaRecorder) return;
    try {
      if (window.notchAPI && !(await window.notchAPI.ensureMicrophone())) {
        showRecorderNotice('无法访问麦克风 · 请在系统设置中授权');
        updateRecordingUi();
        return;
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      const audioTrack = mediaStream.getAudioTracks()[0];
      if (!audioTrack || audioTrack.readyState !== 'live') throw new Error('audio_track_unavailable');
      recordingCaptureIssue = '';
      audioTrack.addEventListener('mute', () => {
        if (!['recording', 'paused'].includes(recordingStatus)) return;
        recordingCaptureIssue = '麦克风无输入 · 请检查系统音源';
        updateRecordingUi();
      });
      audioTrack.addEventListener('unmute', () => {
        recordingCaptureIssue = '';
        updateRecordingUi();
      });
      startRecordingStrands(mediaStream);
      const mimeType = chooseRecordingMimeType();
      mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      audioChunks = [];
      recordingTranscript = '';
      interimTranscript = '';
      speechRecognitionBlocked = false;
      speechRecognitionError = '';
      recordingStartedAt = Date.now();
      recordingStopDurationMs = 0;
      pausedTotalMs = 0;
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size) audioChunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        recordingCaptureIssue = '录音中断 · 请重新开始';
        updateRecordingUi();
      };
      mediaRecorder.onstop = async () => {
        const durationMs = recordingStopDurationMs || currentDuration();
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || mimeType || 'audio/webm' });
        stopMediaTracks();
        if (transcriptionFinishPromise) {
          await transcriptionFinishPromise;
          transcriptionFinishPromise = null;
        }
        finalizeRecording(blob, durationMs);
      };
      mediaRecorder.start(1000);
      recordingStatus = 'recording';
      transcriptionStatus = 'idle';
      transcriptionAudioGap = false;
      transcriptionStartPromise = null;
      transcriptionFinishPromise = null;
      beginRecordingDraft();
      if (transcriptionConfig.configured) {
        transcriptionStartPromise = startCloudTranscription();
      } else {
        startSpeechRecognition();
      }
      clearInterval(recordingTimer);
      recordingTimer = setInterval(updateRecordingUi, 500);
      updateRecordingUi();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      recordingCaptureIssue = '';
      discardRecordingDraft();
      showRecorderNotice('无法开始录音 · 请检查麦克风权限');
      updateRecordingUi();
    }
  }

  function startRecording() {
    return recordingStartTask.run(startRecordingAttempt);
  }

  function togglePauseRecording() {
    if (!mediaRecorder) return;
    if (recordingStatus === 'recording') {
      mediaRecorder.pause();
      pausedAt = Date.now();
      recordingStatus = 'paused';
      if (!transcriptionConfig.configured) stopSpeechRecognition();
    } else if (recordingStatus === 'paused') {
      pausedTotalMs += Date.now() - pausedAt;
      pausedAt = 0;
      mediaRecorder.resume();
      recordingStatus = 'recording';
      if (!transcriptionConfig.configured) startSpeechRecognition();
    }
    updateRecordingUi();
  }

  function stopRecording() {
    if (!mediaRecorder || !['recording', 'paused'].includes(recordingStatus)) return;
    recordingStopDurationMs = currentDuration();
    recordingStatus = 'saving';
    if (!transcriptionConfig.configured) stopSpeechRecognition();
    transcriptionFinishPromise = transcriptionStartPromise
      ? finishCloudTranscription()
      : Promise.resolve({ ok: false, error: 'not_active', transcript: recordingTranscript });
    clearInterval(recordingTimer);
    recordingTimer = null;
    updateRecordingUi();
    try {
      mediaRecorder.stop();
    } catch (error) {
      stopMediaTracks();
      recordingStatus = 'idle';
      discardRecordingDraft();
      updateRecordingUi();
    }
  }

  if (recordingNew) recordingNew.addEventListener('click', startRecording);
  if (recordingConfigure) recordingConfigure.addEventListener('click', openTranscriptionSettings);
  if (settingsApiConfigure) settingsApiConfigure.addEventListener('click', openTranscriptionSettings);
  if (transcriptionSettingsClose) transcriptionSettingsClose.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsCancel) transcriptionSettingsCancel.addEventListener('click', closeTranscriptionSettings);
  if (transcriptionSettingsSave) transcriptionSettingsSave.addEventListener('click', saveTranscriptionSettings);
  if (transcriptionApiHelp) {
    transcriptionApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://bailian.console.aliyun.com/cn-beijing/?tab=app#/api-key');
    });
  }
  if (llmApiHelp) {
    llmApiHelp.addEventListener('click', () => {
      window.notchAPI?.openExternal('https://platform.deepseek.com/api_keys');
    });
  }
  if (transcriptionSettingsBackdrop) {
    transcriptionSettingsBackdrop.addEventListener('click', (event) => {
      if (event.target === transcriptionSettingsBackdrop) closeTranscriptionSettings();
    });
  }
  settingsFeatureList?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-feature]');
    if (!input || !window.notchAPI?.setFeature) return;
    input.disabled = true;
    const result = await window.notchAPI.setFeature(input.dataset.settingsFeature, input.checked)
      .catch(() => ({ ok: false }));
    input.disabled = false;
    if (!result?.ok) {
      input.checked = !input.checked;
      setSettingsNote('功能显示设置保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote('显示功能已更新。');
  });
  document.getElementById('settings-page')?.addEventListener('change', async (event) => {
    const input = event.target.closest('input[data-settings-home-module]');
    if (!input || !window.NotchHome?.setModuleVisible) return;
    input.disabled = true;
    const result = await window.NotchHome.setModuleVisible(
      input.dataset.settingsHomeModule,
      input.checked
    );
    renderHomeModuleSettings();
    if (!result?.ok) {
      const message = result?.error === 'at_least_one_required' ? '首页至少保留一个组件' : '首页组件设置未更新';
      if (typeof showStatusToast === 'function') showStatusToast(message);
      return;
    }
    if (result.changed === false) return;
    const message = result.persisted === false
      ? '首页已更新，仅当前会话生效，设置未能保存'
      : input.checked ? '首页组件已恢复' : '首页组件已隐藏';
    if (typeof showStatusToast === 'function') showStatusToast(message);
  });
  settingsShortcutChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('notch:record-shortcut'));
  });
  settingsCaptureChange?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('notch:record-shortcut', { detail: { target: 'capture' } }));
  });
  settingsDefaultTab?.addEventListener('change', async () => {
    if (!window.notchAPI?.setDefaultTab) return;
    const previous = settingsAppSettings?.defaultTab || 'home';
    settingsDefaultTab.disabled = true;
    const result = await window.notchAPI.setDefaultTab(settingsDefaultTab.value).catch(() => ({ ok: false }));
    settingsDefaultTab.disabled = false;
    if (!result?.ok) {
      settingsDefaultTab.value = previous;
      setSettingsNote('默认展开页保存失败，请重试。', true);
      return;
    }
    settingsAppSettings = result.settings || settingsAppSettings;
    renderSettingsPanel();
    setSettingsNote(`下次唤出将默认显示${settingsDefaultTab.selectedOptions[0]?.textContent || '所选页面'}。`);
  });
  settingsWorkspaceOpen?.addEventListener('click', () => {
    window.notchAPI?.openWorkspace?.().catch(() => setSettingsNote('无法打开数据文件夹。', true));
  });
  settingsWorkspaceChoose?.addEventListener('click', async () => {
    const changed = await window.notchAPI?.chooseWorkspace?.().catch(() => false);
    if (!changed) return;
    settingsWorkspace = await window.notchAPI?.getWorkspace?.().catch(() => settingsWorkspace);
    renderSettingsPanel();
    setSettingsNote('数据文件夹已更新。');
  });
  settingsAutoLaunch?.addEventListener('change', async () => {
    if (!window.notchAPI?.setAutoLaunch) return;
    settingsAutoLaunch.disabled = true;
    const result = await window.notchAPI.setAutoLaunch(settingsAutoLaunch.checked).catch(() => ({ ok: false }));
    settingsAutoLaunch.disabled = false;
    if (!result?.ok) {
      settingsAutoLaunch.checked = !settingsAutoLaunch.checked;
      setSettingsNote('开机启动设置失败。', true);
      return;
    }
    settingsAutoLaunch.checked = result.autoLaunch === true;
    if (settingsAppSettings) settingsAppSettings.autoLaunch = result.autoLaunch === true;
    setSettingsNote(result.autoLaunch ? '已开启开机自动启动。' : '已关闭开机自动启动。');
  });
  window.notchAPI?.onAppSettingsChanged?.((settings) => {
    settingsAppSettings = settings;
    renderSettingsPanel();
  });
  window.notchAPI?.onWorkspaceChanged?.(() => refreshSettingsPanel());

  // ---------------- 录音页：列表、播放器（圆形播放键 · 波形 · 倍速）、转写操作 ----------------
  // 播放器是自己画的：音频解码后取 72 段响度画成波形，已播放的部分是主色；空格播放 / 暂停，←→ 快退快进 5 秒。
  const WAVE_BARS = 72;
  const SPEEDS = [1, 1.5, 2];
  const REC_ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11l9-5.5Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="6.5" width="3" height="11" rx="1"/><rect x="13.5" y="6.5" width="3" height="11" rx="1"/></svg>',
    copy: COPY_ICON,
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="4.5" width="13" height="15" rx="2"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/></svg>',
    todo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 7h9M4.5 12h9M4.5 17h6"/><path d="m15.5 16 2 2 3.5-4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7.5a2 2 0 0 1 2-2h3.6l2 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/></svg>',
    trash: DELETE_ICON,
  };
  const wavePeaks = new Map();
  const pendingRecordingDeletes = new Map();
  let player = null; // { recordingId, audio, container }

  function recordingWhen(timestamp) {
    const date = new Date(timestamp);
    const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const startOf = (value) => { const day = new Date(value); day.setHours(0, 0, 0, 0); return day.getTime(); };
    const days = Math.round((startOf(Date.now()) - startOf(timestamp)) / 86400000);
    if (days === 0) return `今天 ${clock}`;
    if (days === 1) return `昨天 ${clock}`;
    return `${date.getMonth() + 1}/${date.getDate()} ${clock}`;
  }

  function playClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  async function computePeaks(bytes) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !bytes) return null;
    const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
    const copy = view.slice().buffer;
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(copy);
      const data = buffer.getChannelData(0);
      const step = Math.max(1, Math.floor(data.length / WAVE_BARS));
      const peaks = [];
      for (let bar = 0; bar < WAVE_BARS; bar += 1) {
        let sum = 0;
        const start = bar * step;
        const end = Math.min(data.length, start + step);
        for (let index = start; index < end; index += 16) sum += data[index] * data[index];
        peaks.push(Math.sqrt(sum / Math.max(1, (end - start) / 16)));
      }
      const max = Math.max(...peaks, 0.0001);
      return peaks.map((value) => Math.max(0.12, value / max));
    } catch (error) {
      return null;
    } finally {
      context.close().catch(() => {});
    }
  }

  function drawWave(container, recordingId) {
    const wave = container.querySelector('.rec-wave');
    if (!wave) return;
    const peaks = wavePeaks.get(recordingId);
    const bars = wave.children.length === WAVE_BARS ? [...wave.children] : null;
    if (!bars) {
      wave.replaceChildren(...Array.from({ length: WAVE_BARS }, () => document.createElement('i')));
    }
    [...wave.children].forEach((bar, index) => {
      bar.style.height = `${Math.round((peaks ? peaks[index] : 0.22) * 100)}%`;
    });
    wave.dataset.real = String(Boolean(peaks));
  }

  function totalSeconds(audio, recording) {
    return Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (recording.durationMs || 0) / 1000;
  }

  function updatePlayer(container, recording) {
    const audio = container.querySelector('audio');
    const total = totalSeconds(audio, recording);
    const progress = total ? Math.min(1, audio.currentTime / total) : 0;
    container.querySelector('.rec-time').textContent = `${playClock(audio.currentTime)} / ${playClock(total)}`;
    const played = Math.round(progress * WAVE_BARS);
    [...container.querySelectorAll('.rec-wave i')].forEach((bar, index) => bar.classList.toggle('played', index < played));
    const play = container.querySelector('.rec-play');
    play.innerHTML = audio.paused ? REC_ICON.play : REC_ICON.pause;
    play.setAttribute('aria-label', audio.paused ? '播放' : '暂停');
  }

  async function loadRecordingAudio(recording, container) {
    const markMissing = () => {
      container.dataset.state = 'missing';
      container.querySelector('.rec-time').textContent = '音频文件不可用';
    };
    if (!window.notchAPI || !recording.audioPath) return markMissing();
    const result = await window.notchAPI.readRecording(recording.audioPath);
    if (!result || selectedRecordingId !== recording.id || !container.isConnected) {
      if (container.isConnected) markMissing();
      return;
    }
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(new Blob([result.bytes], { type: result.mimeType }));
    container.querySelector('audio').src = currentAudioUrl;
    container.dataset.state = 'ready';
    if (!wavePeaks.has(recording.id)) {
      computePeaks(result.bytes).then((peaks) => {
        if (!peaks) return;
        wavePeaks.set(recording.id, peaks);
        if (container.isConnected) { drawWave(container, recording.id); updatePlayer(container, recording); }
      });
    }
  }

  function buildPlayer(recording) {
    const container = document.createElement('div');
    container.className = 'rec-player';
    container.dataset.state = 'loading';
    container.innerHTML = `<button class="rec-play" type="button" data-action="play" aria-label="播放">${REC_ICON.play}</button><div class="rec-wave" role="slider" aria-label="播放进度，点一下跳到这里" tabindex="-1"></div><span class="rec-time">0:00 / ${playClock((recording.durationMs || 0) / 1000)}</span><button class="rec-speed" type="button" data-action="speed" aria-label="倍速">1×</button><audio preload="metadata" hidden></audio>`;
    drawWave(container, recording.id);
    const audio = container.querySelector('audio');
    ['play', 'pause', 'timeupdate', 'loadedmetadata', 'ended'].forEach((name) => audio.addEventListener(name, () => updatePlayer(container, recording)));
    container.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'play') {
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
        return;
      }
      if (action === 'speed') {
        const next = SPEEDS[(SPEEDS.indexOf(audio.playbackRate) + 1) % SPEEDS.length] || 1;
        audio.playbackRate = next;
        event.target.closest('[data-action]').textContent = `${next}×`;
        return;
      }
      const wave = event.target.closest('.rec-wave');
      if (wave) {
        const rect = wave.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        audio.currentTime = fraction * totalSeconds(audio, recording);
        updatePlayer(container, recording);
      }
    });
    player = { recordingId: recording.id, audio, container };
    return container;
  }

  function seekPlayer(deltaSeconds) {
    if (!player?.audio || !player.container.isConnected) return false;
    const recording = recordings.find((item) => item.id === player.recordingId);
    const total = recording ? totalSeconds(player.audio, recording) : player.audio.duration;
    player.audio.currentTime = Math.max(0, Math.min(total || 0, player.audio.currentTime + deltaSeconds));
    return true;
  }

  function playerWantsKeys(event) {
    const target = event?.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false;
    return Boolean(player?.container?.isConnected && document.getElementById('tab-recordings')?.classList.contains('active'));
  }

  // 空格播放 / 暂停，←→ 快退快进 5 秒（焦点不在输入框里时）。
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing || !playerWantsKeys(event)) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (player.audio.paused) player.audio.play().catch(() => {});
      else player.audio.pause();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekPlayer(event.key === 'ArrowLeft' ? -5 : 5);
    }
  });

  function closeTodoPicker() {
    recordingDetail?.querySelector('.rec-todos')?.remove();
  }

  function openTodoPicker(recording, anchor) {
    closeTodoPicker();
    const candidates = window.NotchTodo?.extractTodoCandidates?.(recording.transcript, Date.now()) || [];
    if (!candidates.length) {
      if (typeof showStatusToast === 'function') showStatusToast('转写里没有带时间或动作的句子');
      return;
    }
    const todos = window.NotchTodos;
    const categories = todos?.categories?.() || [];
    const category = window.NotchCapture?.lastUsedCategory?.(todos?.items?.(), categories.map((item) => item.id)) || categories[0]?.id;
    const box = document.createElement('div');
    box.className = 'rec-todos';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '提取待办');
    const head = document.createElement('p');
    head.className = 'rec-todos-head';
    head.textContent = '勾选要加进待办的句子（原话照搬，不改写）';
    const list = document.createElement('div');
    list.className = 'rec-todos-list';
    candidates.forEach((candidate, index) => {
      const label = document.createElement('label');
      label.className = 'rec-todos-item';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.index = String(index);
      const text = document.createElement('span');
      text.textContent = candidate.text;
      label.append(check, text);
      if (candidate.label) {
        const when = document.createElement('em');
        when.textContent = candidate.label;
        label.append(when);
      }
      list.append(label);
    });
    const foot = document.createElement('div');
    foot.className = 'rec-todos-foot';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'rec-ghost';
    cancel.textContent = '取消';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'rec-primary';
    add.disabled = true;
    const categoryName = todos?.categoryName?.(category) || '待办';
    add.textContent = `加入「${categoryName}」`;
    foot.append(cancel, add);
    box.append(head, list, foot);
    list.addEventListener('change', () => {
      const count = list.querySelectorAll('input:checked').length;
      add.disabled = count === 0;
      add.textContent = count ? `加入「${categoryName}」· ${count} 条` : `加入「${categoryName}」`;
    });
    cancel.addEventListener('click', closeTodoPicker);
    add.addEventListener('click', () => {
      const picked = [...list.querySelectorAll('input:checked')].map((input) => candidates[Number(input.dataset.index)]);
      let added = 0;
      picked.forEach((candidate) => {
        const at = candidate.at || window.NotchTodo?.defaultDeadline?.(Date.now());
        if (todos?.add?.(category, candidate.text, at)) added += 1;
      });
      closeTodoPicker();
      if (typeof showStatusToast === 'function') {
        showStatusToast(added ? `已加 ${added} 条待办到「${categoryName}」` : '没加上，请到待办页再试', added ? { actionLabel: '查看', duration: 5000, onAction: () => todos?.open?.() } : undefined);
      }
    });
    recordingDetail.append(box);
    const host = recordingDetail.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    box.style.top = `${Math.round(rect.bottom - host.top + 6)}px`;
    box.style.right = `${Math.round(host.right - rect.right)}px`;
  }

  function renderRecordingDetail() {
    if (!recordingDetail) return;
    const recording = recordings.find((item) => item.id === selectedRecordingId);
    if (player && (!recording || player.recordingId !== recording.id)) {
      player.audio?.pause();
      player = null;
    }
    recordingDetail.replaceChildren();
    if (!recording) {
      const empty = document.createElement('div');
      empty.className = 'recording-detail-empty';
      empty.innerHTML = '<strong>还没有录音</strong><p>点左上角的「录音」开始，结束后音频和转写都会保存在这里。</p>';
      recordingDetail.appendChild(empty);
      return;
    }
    if (recording.isDraft) {
      const header = document.createElement('header');
      header.className = 'rec-head';
      header.innerHTML = '<div class="rec-heading"><h2 class="rec-live-title">新录音</h2><p class="rec-meta"><span data-recording-live-state></span> · <span data-recording-live-transcription></span></p></div>';
      const card = document.createElement('div');
      card.className = 'rec-live-card';
      const dot = document.createElement('span');
      dot.className = 'recording-state-dot';
      dot.dataset.recordingLiveDot = '';
      dot.dataset.state = recordingStatus;
      dot.hidden = true;
      const time = document.createElement('time');
      time.className = 'rec-live-time';
      time.dataset.recordingLiveTime = '';
      const wave = document.createElement('div');
      wave.className = 'rec-live-wave';
      wave.setAttribute('aria-hidden', 'true');
      wave.append(...Array.from({ length: 13 }, (_, index) => {
        const bar = document.createElement('i');
        bar.style.setProperty('--i', String(index));
        // 每根条的起伏系数固定，音量越大整体越高。
        bar.style.setProperty('--m', (0.45 + 0.55 * (((index * 37) % 11) / 10)).toFixed(2));
        return bar;
      }));
      const controls = document.createElement('div');
      controls.className = 'rec-live-controls';
      const pause = document.createElement('button');
      pause.type = 'button';
      pause.className = 'rec-secondary recording-live-pause';
      pause.textContent = recordingStatus === 'paused' ? '继续' : '暂停';
      pause.addEventListener('click', togglePauseRecording);
      const stop = document.createElement('button');
      stop.type = 'button';
      stop.className = 'rec-stop recording-live-stop';
      stop.innerHTML = '<i aria-hidden="true"></i>结束并保存';
      stop.addEventListener('click', stopRecording);
      controls.append(pause, stop);
      card.append(dot, time, wave, controls);
      const live = document.createElement('div');
      live.className = 'rec-live-text';
      const text = document.createElement('span');
      text.dataset.recordingLiveTranscript = '';
      const caret = document.createElement('i');
      caret.className = 'rec-caret';
      caret.setAttribute('aria-hidden', 'true');
      live.append(text, caret);
      const footer = document.createElement('div');
      footer.className = 'rec-live-foot';
      const feedback = document.createElement('p');
      feedback.className = 'recording-live-feedback';
      feedback.dataset.recordingLiveFeedback = '';
      feedback.setAttribute('aria-live', 'polite');
      const configure = document.createElement('button');
      configure.type = 'button';
      configure.className = 'rec-link';
      configure.dataset.action = 'configure-transcription';
      configure.textContent = '去配置转写';
      configure.addEventListener('click', openTranscriptionSettings);
      footer.append(feedback, configure);
      recordingDetail.append(header, card, live, footer);
      syncRecordingDraftUi();
      return;
    }

    const header = document.createElement('header');
    header.className = 'rec-head';
    const heading = document.createElement('div');
    heading.className = 'rec-heading';
    const title = document.createElement('input');
    title.className = 'recording-title-input';
    title.value = recording.title;
    title.maxLength = 60;
    title.setAttribute('aria-label', '录音名称，可直接修改');
    const meta = document.createElement('p');
    meta.className = 'rec-meta';
    const category = document.createElement('input');
    category.className = 'rec-category';
    category.value = recording.category === '未分类' ? '' : recording.category;
    category.placeholder = '分类';
    category.maxLength = 12;
    category.setAttribute('aria-label', '分类');
    const when = document.createElement('span');
    when.textContent = `${recordingWhen(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
    meta.append(category, when);
    heading.append(title, meta);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'rec-icon';
    remove.dataset.action = 'delete-recording';
    remove.setAttribute('aria-label', '删除录音');
    remove.title = '删除录音';
    remove.innerHTML = REC_ICON.trash;
    header.append(heading, remove);

    const playerEl = buildPlayer(recording);

    const transcriptHead = document.createElement('div');
    transcriptHead.className = 'rec-transcript-head';
    transcriptHead.innerHTML = `<b>转写</b><span class="rec-flex"></span>
      <button class="rec-action" type="button" data-action="copy-recording">${REC_ICON.copy}<span>复制</span></button>
      <button class="rec-action" type="button" data-action="save-note">${REC_ICON.note}<span>存为笔记</span></button>
      <button class="rec-action" type="button" data-action="extract-todos">${REC_ICON.todo}<span>提取待办</span></button>
      <button class="rec-icon" type="button" data-action="reveal-recording" aria-label="在文件夹中显示" title="在文件夹中显示">${REC_ICON.folder}</button>`;
    const hasText = Boolean(String(recording.transcript || '').trim());
    transcriptHead.querySelectorAll('[data-action="copy-recording"], [data-action="save-note"], [data-action="extract-todos"]').forEach((button) => { button.disabled = !hasText; });

    const transcript = document.createElement('textarea');
    transcript.className = 'recording-transcript-editor';
    transcript.value = recording.transcript;
    transcript.placeholder = transcriptionConfig.configured ? '这段录音没有转写文字，可以在这里补充。' : '还没有配置转写服务，可以在这里手动补充文字。';
    transcript.setAttribute('aria-label', '录音转写文本');
    recordingDetail.append(header, playerEl, transcriptHead, transcript);
    if (!hasText && !transcriptionConfig.configured) {
      const hint = document.createElement('p');
      hint.className = 'rec-empty-hint';
      hint.innerHTML = '转写服务还没配置 · <button class="rec-link" type="button" data-action="configure-transcription">去配置</button>';
      recordingDetail.append(hint);
    }

    title.addEventListener('change', () => {
      if (title.value.trim()) recording.title = title.value.trim();
      title.value = recording.title;
      persistRecordings();
      renderRecordingList();
    });
    category.addEventListener('change', () => {
      recording.category = category.value.replace(/\s+/g, ' ').trim().slice(0, 12) || '未分类';
      persistRecordings();
      renderRecordingList();
    });
    [title, category].forEach((input) => input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.isComposing) input.blur();
    }));
    transcript.addEventListener('input', () => {
      recording.transcript = transcript.value;
      persistRecordings();
      const has = Boolean(transcript.value.trim());
      transcriptHead.querySelectorAll('[data-action="copy-recording"], [data-action="save-note"], [data-action="extract-todos"]').forEach((button) => { button.disabled = !has; });
    });
    recordingDetail.onclick = async (event) => {
      const action = event.target.closest('[data-action]');
      if (!action || action.closest('.rec-player, .rec-todos')) return;
      const name = action.dataset.action;
      if (name === 'copy-recording' && window.notchAPI && recording.transcript) {
        await window.notchAPI.writeClipboard({ type: 'text', text: recording.transcript });
        if (typeof showStatusToast === 'function') showStatusToast('已复制转写');
      } else if (name === 'save-note' && recording.transcript) {
        const id = window.NotchNotes?.createFrom?.({ title: recording.title, content: recording.transcript });
        if (typeof showStatusToast === 'function') {
          showStatusToast(id ? '已存为笔记' : '没存上，请稍后再试', id ? { actionLabel: '打开', duration: 5000, onAction: () => window.NotchNotes?.open?.(id) } : undefined);
        }
      } else if (name === 'extract-todos') {
        openTodoPicker(recording, action);
      } else if (name === 'reveal-recording' && window.notchAPI && recording.audioPath) {
        await window.notchAPI.revealRecording(recording.audioPath);
      } else if (name === 'delete-recording') {
        deleteSingleRecording(recording.id);
      } else if (name === 'configure-transcription') {
        openTranscriptionSettings();
      }
    };
    loadRecordingAudio(recording, playerEl);
  }

  // 删除：先从列表拿掉，5 秒内可撤销；撤销时间过了才删音频文件。
  function deleteSingleRecording(recordingId) {
    const index = recordings.findIndex((item) => item.id === recordingId);
    const recording = recordings[index];
    if (!recording || recording.isDraft) return;
    const next = Domain.removeRecordingState(recordings, recording.id, [...recordingSelection], selectedRecordingId);
    recordings = next.recordings;
    recordingSelection = new Set(next.selection);
    selectedRecordingId = next.selectedId;
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
    const timer = setTimeout(() => {
      pendingRecordingDeletes.delete(recording.id);
      if (window.notchAPI && recording.audioPath) window.notchAPI.deleteRecording(recording.audioPath).catch(() => false);
    }, 5600);
    pendingRecordingDeletes.set(recording.id, timer);
    if (typeof showStatusToast === 'function') {
      showStatusToast(`已删除「${recording.title}」`, {
        actionLabel: '撤销',
        duration: 5000,
        onAction: () => {
          clearTimeout(pendingRecordingDeletes.get(recording.id));
          pendingRecordingDeletes.delete(recording.id);
          if (recordings.some((item) => item.id === recording.id)) return;
          recordings.splice(Math.min(index, recordings.length), 0, recording);
          selectedRecordingId = recording.id;
          persistRecordings();
          renderRecordings();
        },
      });
    }
  }

  function renderRecordingList() {
    if (!recordingList) return;
    recordingList.replaceChildren();
    if (recordingBulkDelete) {
      recordingBulkDelete.hidden = recordingSelection.size === 0;
      recordingBulkDelete.textContent = '删除';
      recordingBulkDelete.setAttribute('aria-label', recordingSelection.size ? `删除 ${recordingSelection.size} 项` : '删除所选');
    }
    if (!recordings.length) {
      const empty = document.createElement('div');
      empty.className = 'recording-list-empty';
      empty.textContent = '还没有录音';
      recordingList.appendChild(empty);
      return;
    }
    recordings.forEach((recording) => {
      const row = document.createElement('div');
      row.className = `recording-item${recording.id === selectedRecordingId ? ' active' : ''}${recordingSelection.has(recording.id) ? ' multi-selected' : ''}${recording.isDraft ? ' is-live' : ''}`;
      row.dataset.id = recording.id;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'recording-item-main';
      button.setAttribute('aria-label', `打开录音：${recording.title}`);
      const top = document.createElement('span');
      top.className = 'rec-row-top';
      const title = document.createElement('strong');
      const meta = document.createElement('time');
      meta.dataset.recordingMeta = '';
      if (recording.isDraft) {
        title.textContent = recordingStatus === 'saving' ? '正在保存…' : recordingStatus === 'paused' ? '已暂停' : '正在录音…';
        meta.className = 'rec-row-live-time';
        meta.textContent = formatClock(recording.durationMs);
        top.append(title, meta);
      } else {
        title.textContent = recording.title;
        top.append(title);
        if (recording.category && recording.category !== '未分类') {
          const chip = document.createElement('em');
          chip.className = 'rec-chip';
          chip.textContent = recording.category;
          top.append(chip);
        }
        meta.className = 'rec-row-meta';
        meta.textContent = `${recordingWhen(recording.createdAt)} · ${formatClock(recording.durationMs)}`;
      }
      const preview = document.createElement('span');
      preview.className = 'rec-row-excerpt';
      preview.dataset.recordingPreview = '';
      preview.textContent = recording.isDraft ? (currentRecordingText() || currentRecordingFeedback()) : (recording.transcript || '仅音频 · 暂无转写');
      button.append(top);
      if (!recording.isDraft) button.append(meta);
      button.append(preview);
      row.append(button);
      if (!recording.isDraft) {
        const remove = createIconButton('delete-recording-item', `删除录音：${recording.title}`, DELETE_ICON, true);
        remove.classList.add('recording-item-delete');
        row.append(remove);
      }
      recordingList.appendChild(row);
    });
  }

  function renderRecordings() {
    if (recordingCount) recordingCount.textContent = `${recordings.length} 条`;
    renderRecordingList();
    renderRecordingDetail();
  }

  if (recordingList) {
    recordingList.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-action="delete-recording-item"]');
      if (remove) {
        event.preventDefault();
        event.stopPropagation();
        const row = remove.closest('.recording-item[data-id]');
        if (row) deleteSingleRecording(row.dataset.id);
        return;
      }
      const item = event.target.closest('.recording-item[data-id]');
      if (!item) return;
      const targetRecording = recordings.find((recording) => recording.id === item.dataset.id);
      if (event.shiftKey && targetRecording && !targetRecording.isDraft) {
        event.preventDefault();
        const result = Domain.updateRangeSelection(
          recordings.filter((recording) => !recording.isDraft).map((recording) => recording.id),
          [...recordingSelection],
          item.dataset.id,
          recordingSelectionAnchor,
          true
        );
        recordingSelection = new Set(result.selected);
        recordingSelectionAnchor = result.anchor;
        renderRecordingList();
        return;
      }
      selectedRecordingId = item.dataset.id;
      recordingSelectionAnchor = selectedRecordingId;
      renderRecordings();
    });
  }

  recordingBulkDelete?.addEventListener('click', async () => {
    if (!recordingSelection.size) return;
    const targets = recordings.filter((recording) => !recording.isDraft && recordingSelection.has(recording.id));
    if (!targets.length) return;
    if (window.notchAPI) {
      await Promise.all(targets.map((recording) => recording.audioPath
        ? window.notchAPI.deleteRecording(recording.audioPath).catch(() => false)
        : Promise.resolve(true)));
    }
    const targetIds = new Set(targets.map((recording) => recording.id));
    recordings = recordings.filter((recording) => !targetIds.has(recording.id));
    recordingSelection.clear();
    selectedRecordingId = recordings[0] && recordings[0].id;
    recordingSelectionAnchor = selectedRecordingId || null;
    persistRecordings();
    renderRecordings();
  });

  document.addEventListener('notch:tabchange', (event) => {
    if ((event.detail && event.detail.tab) === 'settings') refreshSettingsPanel();
  });
  document.addEventListener('notch:home-modules-changed', renderHomeModuleSettings);

  document.addEventListener('notch:clear-selection', () => {
    recordingSelection.clear();
    recordingSelectionAnchor = selectedRecordingId || null;
    renderRecordingList();
  });

  window.addEventListener('beforeunload', () => {
    stopSpeechRecognition();
    stopTranscriptionAudioPipeline();
    if (transcriptionStartPromise && window.notchAPI) window.notchAPI.finishTranscription().catch(() => {});
    stopMediaTracks();
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  });

  renderRecordings();
  updateRecordingUi();
  loadTranscriptionConfig();
  refreshSettingsPanel();

  window.NotchWorkspace = {
    startRecording,
    stopRecording,
    isRecordingActive: isRecordingBusy,
    recordingState: () => ({ status: recordingStatus, durationMs: isRecordingActive() ? currentDuration() : 0 }),
    // 录音页的播放器要用空格和方向键时，面板不要把空格当成「收起」。
    playerWantsKeys,
  };
})();
