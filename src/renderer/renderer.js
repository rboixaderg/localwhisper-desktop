const state = {
  stream: null,
  audioContext: null,
  sourceNode: null,
  processorNode: null,
  chunks: [],
  totalLength: 0,
  sampleRate: 48000,
  isTranscribing: false,
  recordingSource: 'manual',
  appName: 'LocalWhisper'
};

const el = {
  whisperBinPath: document.getElementById('whisperBinPath'),
  modelPath: document.getElementById('modelPath'),
  language: document.getElementById('language'),
  extraArgs: document.getElementById('extraArgs'),
  shortcut: document.getElementById('shortcut'),
  clearShortcut: document.getElementById('clearShortcut'),
  saveConfig: document.getElementById('saveConfig'),
  pickBin: document.getElementById('pickBin'),
  pickModel: document.getElementById('pickModel'),
  configStatus: document.getElementById('configStatus'),
  startRec: document.getElementById('startRec'),
  stopRec: document.getElementById('stopRec'),
  recStatus: document.getElementById('recStatus'),
  result: document.getElementById('result'),
  accessibilityBtn: document.getElementById('openAccessibility')
};

function setConfigStatus(text, isError = false) {
  el.configStatus.textContent = text;
  el.configStatus.style.color = isError ? '#9f1d1d' : '#1f7a5a';
}

function setRecStatus(text, isError = false) {
  el.recStatus.textContent = text;
  el.recStatus.style.color = isError ? '#9f1d1d' : '#1c2321';
}

function setShortcutStatus(text, isError = false) {
  const el = document.getElementById('shortcutStatus');
  if (!el) return;
  el.textContent = text;
  el.style.color = isError ? '#9f1d1d' : '#1c2321';
}

function syncRecordingState(isRecording, phase = isRecording ? 'recording' : 'idle') {
  if (!window.localWhisperApi || typeof window.localWhisperApi.setRecordingState !== 'function') {
    return;
  }

  window.localWhisperApi.setRecordingState(isRecording, phase).catch(() => {});
}

function notifyRendererReady() {
  if (!window.localWhisperApi || typeof window.localWhisperApi.notifyRendererReady !== 'function') {
    return;
  }

  window.localWhisperApi.notifyRendererReady().catch(() => {});
}

function isRecordingActive() {
  return Boolean(state.stream && state.audioContext && state.sourceNode && state.processorNode);
}

function normalizeIncomingCommand(payload) {
  if (typeof payload === 'string') {
    return { command: payload, source: 'unknown' };
  }

  if (!payload || typeof payload !== 'object') {
    return { command: '', source: 'unknown' };
  }

  return {
    command: typeof payload.command === 'string' ? payload.command : '',
    source: typeof payload.source === 'string' ? payload.source : 'unknown'
  };
}

function releaseRecordingResources() {
  if (state.processorNode) {
    try {
      state.processorNode.disconnect();
    } catch {}
  }

  if (state.sourceNode) {
    try {
      state.sourceNode.disconnect();
    } catch {}
  }

  if (state.stream) {
    try {
      state.stream.getTracks().forEach((track) => track.stop());
    } catch {}
  }

  if (state.audioContext) {
    try {
      state.audioContext.close();
    } catch {}
  }

  state.processorNode = null;
  state.sourceNode = null;
  state.stream = null;
  state.audioContext = null;
}

function getConfigFromUi() {
  return {
    whisperBinPath: el.whisperBinPath.value.trim(),
    modelPath: el.modelPath.value.trim(),
    language: el.language.value.trim() || 'auto',
    extraArgs: el.extraArgs.value.trim(),
    shortcut: el.shortcut.value.trim()
  };
}

function setConfigToUi(config) {
  el.whisperBinPath.value = config.whisperBinPath || '';
  el.modelPath.value = config.modelPath || '';
  el.language.value = config.language || 'auto';
  el.extraArgs.value = config.extraArgs || '';
  el.shortcut.value = config.shortcut || '';
}

async function loadInitialConfig() {
  const config = await window.localWhisperApi.loadConfig();
  setConfigToUi(config);
  updateShortcutFeedbackFromMain();
}

async function loadPermissionsStatus() {
  try {
    const status = await window.localWhisperApi.getPermissionsStatus();
    state.appName = status.appName || 'LocalWhisper';
  } catch {}
}

async function updateShortcutFeedbackFromMain() {
  try {
    const status = await window.localWhisperApi.getShortcutStatus();
    if (!status.registered) {
      if (status.error) {
        setShortcutStatus(status.error, true);
      } else if (!status.accelerator) {
        setShortcutStatus('Shortcut disabled.');
      }
    } else {
      setShortcutStatus('');
    }
  } catch {}
}

async function saveConfig() {
  try {
    const config = getConfigFromUi();
    const savedConfig = await window.localWhisperApi.saveConfig(config);
    setConfigToUi(savedConfig);
    setConfigStatus('Configuration saved.');

    await window.localWhisperApi.registerShortcut(savedConfig.shortcut);
    updateShortcutFeedbackFromMain();
  } catch (error) {
    setConfigStatus(error.message || 'Error saving configuration.', true);
  }
}

async function pickWhisperBin() {
  const filePath = await window.localWhisperApi.pickFile({
    properties: ['openFile']
  });

  if (filePath) {
    el.whisperBinPath.value = filePath;
  }
}

async function pickModel() {
  const filePath = await window.localWhisperApi.pickFile({
    properties: ['openFile']
  });

  if (filePath) {
    el.modelPath.value = filePath;
  }
}

function eventToAccelerator(event) {
  const parts = [];

  if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl');

  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = event.key;
  if (key === ' ') {
    parts.push('Space');
  } else if (key.length === 1 && /[a-zA-Z0-9]/.test(key)) {
    parts.push(key.toUpperCase());
  } else if (key.length > 1 && key.startsWith('F') && /^F\d+$/.test(key)) {
    parts.push(key);
  } else {
    return '';
  }

  return parts.length > 1 ? parts.join('+') : '';
}

function handleShortcutKeydown(event) {
  event.preventDefault();
  event.stopPropagation();

  const accelerator = eventToAccelerator(event);
  if (accelerator) {
    el.shortcut.value = accelerator;
  }
}

function handleClearShortcut() {
  el.shortcut.value = '';
  setShortcutStatus('Shortcut disabled. Save configuration to apply.');
}

async function openAccessibilityPermissions() {
  try {
    const result = await window.localWhisperApi.openAccessibilityPermissions();
    if (result && result.trusted) {
      setRecStatus('Accessibility permissions granted.');
    } else {
      setRecStatus(
        'Add ' + state.appName + ' in System Settings > Privacy & Security > Accessibility.',
        true
      );
    }
  } catch (error) {
    setRecStatus('Failed to open permissions: ' + (error.message || ''), true);
  }
}

async function startRecording(source = 'manual') {
  if (state.isTranscribing) {
    setRecStatus('Wait for the current transcription to finish.', true);
    return;
  }

  if (isRecordingActive()) {
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioContext = new window.AudioContext();
    await state.audioContext.resume();
    state.sampleRate = state.audioContext.sampleRate;
    state.sourceNode = state.audioContext.createMediaStreamSource(state.stream);
    state.processorNode = state.audioContext.createScriptProcessor(4096, 1, 1);

    state.chunks = [];
    state.totalLength = 0;
    state.recordingSource = source;

    state.processorNode.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const cloned = new Float32Array(input.length);
      cloned.set(input);
      state.chunks.push(cloned);
      state.totalLength += cloned.length;
    };

    state.sourceNode.connect(state.processorNode);
    state.processorNode.connect(state.audioContext.destination);

    el.startRec.disabled = true;
    el.stopRec.disabled = false;
    setRecStatus('Recording...');
    syncRecordingState(true, 'recording');
  } catch (error) {
    releaseRecordingResources();
    syncRecordingState(false, 'idle');
    setRecStatus(error.message || 'Could not start recording.', true);
  }
}

async function stopRecordingAndTranscribe() {
  if (state.isTranscribing) {
    return;
  }

  if (!isRecordingActive()) {
    syncRecordingState(false, 'idle');
    el.startRec.disabled = false;
    el.stopRec.disabled = true;
    setRecStatus('No active recording.', true);
    return;
  }

  const source = state.recordingSource;
  state.isTranscribing = true;

  try {
    el.stopRec.disabled = true;
    el.startRec.disabled = true;
    setRecStatus('Processing audio...');

    state.processorNode.disconnect();
    state.sourceNode.disconnect();
    state.stream.getTracks().forEach((track) => track.stop());
    await state.audioContext.close();
    state.processorNode = null;
    state.sourceNode = null;
    state.stream = null;
    state.audioContext = null;
    syncRecordingState(false, 'processing');

    if (state.totalLength === 0 || state.chunks.length === 0) {
      setRecStatus('No audio captured. Check microphone permissions.', true);
      return;
    }

    const merged = window.audioUtils.mergeFloat32(state.chunks, state.totalLength);

    let peak = 0;
    for (let i = 0; i < merged.length; i += 1) {
      const abs = Math.abs(merged[i]);
      if (abs > peak) peak = abs;
    }
    if (peak < 0.001) {
      setRecStatus(
        'Silent audio. The microphone may be muted or without permissions.',
        true
      );
      return;
    }

    const downsampled = window.audioUtils.downsampleBuffer(merged, state.sampleRate, 16000);
    const wavBuffer = window.audioUtils.encodeWavFromFloat32(downsampled, 16000);
    const audioBase64 = window.audioUtils.arrayBufferToBase64(wavBuffer);

    setRecStatus('Transcribing...');
    syncRecordingState(false, 'transcribing');
    const text = await window.localWhisperApi.transcribe(audioBase64);
    el.result.value = text || '[No text output]';

    if (source === 'shortcut' && text) {
      try {
        setRecStatus('Pasting text...');
        syncRecordingState(false, 'pasting');
        await window.localWhisperApi.pasteText(text);
        setRecStatus('Completed and pasted');
      } catch (pasteError) {
        const isAccessibility =
          /System Events|access|permission|not allowed/i.test(pasteError.message || '');
        if (isAccessibility) {
          setRecStatus(
            'Completed, but paste failed. Grant Accessibility permissions to ' +
              state.appName +
              '.',
            true
          );
        } else {
          setRecStatus(
            'Completed, but paste failed. The text is in the clipboard.',
            true
          );
        }
      }
    } else {
      setRecStatus('Completed');
    }
  } catch (error) {
    setRecStatus(error.message || 'Transcription error.', true);
  } finally {
    state.isTranscribing = false;
    releaseRecordingResources();
    syncRecordingState(false, 'idle');
    el.startRec.disabled = false;
    el.stopRec.disabled = true;
    state.chunks = [];
    state.totalLength = 0;
    state.recordingSource = 'manual';
  }
}

function handleTrayCommand(payload) {
  const { command, source } = normalizeIncomingCommand(payload);

  if (command === 'start') {
    startRecording(source || 'tray');
    return;
  }

  if (command === 'stop') {
    stopRecordingAndTranscribe();
  }
}

function handleShortcutCommand(payload) {
  const { command, source } = normalizeIncomingCommand(payload);

  if (command === 'start') {
    startRecording(source || 'shortcut');
    return;
  }

  if (command === 'stop') {
    stopRecordingAndTranscribe();
  }
}

function handleShortcutStatus(payload) {
  if (!payload) return;

  if (!payload.registered) {
    if (payload.error) {
      setShortcutStatus(payload.error, true);
    } else if (!payload.accelerator) {
      setShortcutStatus('Shortcut disabled.');
    }
  } else {
    setShortcutStatus('');
  }
}

el.saveConfig.addEventListener('click', saveConfig);
el.pickBin.addEventListener('click', pickWhisperBin);
el.pickModel.addEventListener('click', pickModel);
el.startRec.addEventListener('click', () => {
  startRecording('manual');
});
el.stopRec.addEventListener('click', stopRecordingAndTranscribe);
el.shortcut.addEventListener('keydown', handleShortcutKeydown);
el.clearShortcut.addEventListener('click', handleClearShortcut);

if (el.accessibilityBtn) {
  el.accessibilityBtn.addEventListener('click', openAccessibilityPermissions);
}

const unsubscribeTray = window.localWhisperApi.onTrayCommand(handleTrayCommand);
const unsubscribeShortcut = window.localWhisperApi.onShortcutCommand(handleShortcutCommand);
const unsubscribeShortcutStatus = window.localWhisperApi.onShortcutStatus(handleShortcutStatus);

loadInitialConfig().catch((error) => {
  setConfigStatus(error.message || 'Could not load configuration.', true);
});
loadPermissionsStatus();
notifyRendererReady();
syncRecordingState(false, 'idle');

window.addEventListener('beforeunload', () => {
  if (typeof unsubscribeTray === 'function') {
    unsubscribeTray();
  }

  if (typeof unsubscribeShortcut === 'function') {
    unsubscribeShortcut();
  }

  if (typeof unsubscribeShortcutStatus === 'function') {
    unsubscribeShortcutStatus();
  }

  syncRecordingState(false, 'idle');
});
