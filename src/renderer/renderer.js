const DEFAULT_RECORD_SHORTCUT = 'CommandOrControl+Shift+Space';

const state = {
  stream: null,
  audioContext: null,
  sourceNode: null,
  processorNode: null,
  chunks: [],
  totalLength: 0,
  sampleRate: 48000,
  isTranscribing: false,
  autoPasteOnComplete: false,
  recordShortcutValue: DEFAULT_RECORD_SHORTCUT,
  pendingShortcutModifiers: new Set()
};

const el = {
  whisperBinPath: document.getElementById('whisperBinPath'),
  modelPath: document.getElementById('modelPath'),
  language: document.getElementById('language'),
  extraArgs: document.getElementById('extraArgs'),
  recordShortcut: document.getElementById('recordShortcut'),
  saveConfig: document.getElementById('saveConfig'),
  pickBin: document.getElementById('pickBin'),
  pickModel: document.getElementById('pickModel'),
  configStatus: document.getElementById('configStatus'),
  startRec: document.getElementById('startRec'),
  stopRec: document.getElementById('stopRec'),
  recStatus: document.getElementById('recStatus'),
  result: document.getElementById('result')
};

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift']);
const MODIFIER_ORDER = ['CommandOrControl', 'Alt', 'Shift', 'Control'];

function setConfigStatus(text, isError = false) {
  el.configStatus.textContent = text;
  el.configStatus.style.color = isError ? '#9f1d1d' : '#1f7a5a';
}

function setRecStatus(text, isError = false) {
  el.recStatus.textContent = text;
  el.recStatus.style.color = isError ? '#9f1d1d' : '#1c2321';
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
    return { command: payload, source: 'tray' };
  }

  if (!payload || typeof payload !== 'object') {
    return { command: '', source: 'unknown' };
  }

  return {
    command: typeof payload.command === 'string' ? payload.command : '',
    source: typeof payload.source === 'string' ? payload.source : 'unknown'
  };
}

function normalizeRecordShortcutValue(shortcut) {
  if (typeof shortcut !== 'string') {
    return DEFAULT_RECORD_SHORTCUT;
  }

  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 0 ? parts.join('+') : DEFAULT_RECORD_SHORTCUT;
}

function acceleratorPartToDisplayIcon(part) {
  const raw = String(part || '').trim();
  if (!raw) {
    return '';
  }

  const normalized = raw.toLowerCase();
  if (normalized === 'commandorcontrol' || normalized === 'command') {
    return '⌘';
  }

  if (normalized === 'alt' || normalized === 'option') {
    return '⌥';
  }

  if (normalized === 'shift') {
    return '⇧';
  }

  if (normalized === 'control' || normalized === 'ctrl') {
    return '⌃';
  }

  if (normalized === 'space') {
    return '␣';
  }

  if (normalized === 'enter' || normalized === 'return') {
    return '↩';
  }

  if (normalized === 'tab') {
    return '⇥';
  }

  if (normalized === 'escape' || normalized === 'esc') {
    return '⎋';
  }

  if (normalized === 'backspace') {
    return '⌫';
  }

  if (normalized === 'delete') {
    return '⌦';
  }

  if (normalized === 'up') {
    return '↑';
  }

  if (normalized === 'down') {
    return '↓';
  }

  if (normalized === 'left') {
    return '←';
  }

  if (normalized === 'right') {
    return '→';
  }

  if (normalized === 'plus') {
    return '+';
  }

  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(normalized)) {
    return normalized.toUpperCase();
  }

  if (raw.length === 1) {
    return raw.toUpperCase();
  }

  return raw;
}

function formatShortcutForDisplay(shortcut) {
  const normalized = normalizeRecordShortcutValue(shortcut);
  return normalized
    .split('+')
    .map((part) => acceleratorPartToDisplayIcon(part))
    .filter(Boolean)
    .join(' ');
}

function setRecordShortcutValue(shortcut) {
  const normalized = normalizeRecordShortcutValue(shortcut);
  state.recordShortcutValue = normalized;
  el.recordShortcut.value = formatShortcutForDisplay(normalized);
  el.recordShortcut.title = normalized;
}

function resetPendingShortcutModifiers() {
  state.pendingShortcutModifiers.clear();
}

function getModifierTokenFromKey(key) {
  if (key === 'Meta') {
    return 'CommandOrControl';
  }
  if (key === 'Alt') {
    return 'Alt';
  }
  if (key === 'Shift') {
    return 'Shift';
  }
  if (key === 'Control') {
    return 'Control';
  }
  return '';
}

function getModifierTokensFromEvent(event) {
  const modifiers = [];
  if (event.metaKey) {
    modifiers.push('CommandOrControl');
  }
  if (event.altKey) {
    modifiers.push('Alt');
  }
  if (event.shiftKey) {
    modifiers.push('Shift');
  }
  if (event.ctrlKey) {
    modifiers.push('Control');
  }
  return modifiers;
}

function getOrderedModifierTokens(modifierSet) {
  return MODIFIER_ORDER.filter((modifier) => modifierSet.has(modifier));
}

function getPrimaryShortcutKeyFromEvent(event) {
  const key = String(event.key || '');

  if (!key || MODIFIER_KEYS.has(key)) {
    return '';
  }

  if (key === ' ' || key === 'Spacebar') {
    return 'Space';
  }

  if (key === '+') {
    return 'Plus';
  }

  if (/^[a-z]$/i.test(key)) {
    return key.toUpperCase();
  }

  if (/^[0-9]$/.test(key)) {
    return key;
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(key)) {
    return key.toUpperCase();
  }

  const map = {
    Enter: 'Enter',
    Return: 'Enter',
    Tab: 'Tab',
    Escape: 'Escape',
    Esc: 'Escape',
    Backspace: 'Backspace',
    Delete: 'Delete',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown'
  };

  if (map[key]) {
    return map[key];
  }

  if (key.length === 1 && !/\s/.test(key)) {
    return key.toUpperCase();
  }

  return '';
}

function captureRecordShortcutFromKeyboardEvent(event) {
  const noModifierPressed = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
  if (event.key === 'Tab' && noModifierPressed && state.pendingShortcutModifiers.size === 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if ((event.key === 'Backspace' || event.key === 'Delete') && noModifierPressed) {
    resetPendingShortcutModifiers();
    setRecordShortcutValue(DEFAULT_RECORD_SHORTCUT);
    setConfigStatus('Shortcut restaurat al valor per defecte.');
    return;
  }

  if (event.key === 'Escape' && noModifierPressed) {
    resetPendingShortcutModifiers();
    setRecordShortcutValue(state.recordShortcutValue);
    setConfigStatus('Captura de shortcut cancel·lada.');
    return;
  }

  const currentModifiers = new Set(state.pendingShortcutModifiers);
  for (const modifier of getModifierTokensFromEvent(event)) {
    currentModifiers.add(modifier);
  }
  const modifierFromCurrentKey = getModifierTokenFromKey(event.key);
  if (modifierFromCurrentKey) {
    currentModifiers.add(modifierFromCurrentKey);
  }

  const primaryKey = getPrimaryShortcutKeyFromEvent(event);
  if (!primaryKey) {
    state.pendingShortcutModifiers = currentModifiers;
    const modifierPreview = getOrderedModifierTokens(currentModifiers).join('+');
    if (modifierPreview) {
      el.recordShortcut.value = formatShortcutForDisplay(modifierPreview);
      el.recordShortcut.title = modifierPreview;
      setConfigStatus('Afegeix una tecla principal per completar el shortcut.');
    }
    return;
  }

  const orderedParts = [...getOrderedModifierTokens(currentModifiers), primaryKey];
  const accelerator = orderedParts.join('+');
  resetPendingShortcutModifiers();
  setRecordShortcutValue(accelerator);
  setConfigStatus(`Shortcut seleccionat: ${formatShortcutForDisplay(accelerator)}.`);
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
    recordShortcut: state.recordShortcutValue || DEFAULT_RECORD_SHORTCUT
  };
}

function setConfigToUi(config) {
  el.whisperBinPath.value = config.whisperBinPath || '';
  el.modelPath.value = config.modelPath || '';
  el.language.value = config.language || 'auto';
  el.extraArgs.value = config.extraArgs || '-otxt';
  setRecordShortcutValue(config.recordShortcut || DEFAULT_RECORD_SHORTCUT);
}

async function loadInitialConfig() {
  const config = await window.localWhisperApi.loadConfig();
  setConfigToUi(config);
}

async function saveConfig() {
  try {
    const config = getConfigFromUi();
    const savedConfig = await window.localWhisperApi.saveConfig(config);
    setConfigToUi(savedConfig);
    setConfigStatus('Configuracio guardada.');
  } catch (error) {
    setConfigStatus(error.message || 'Error guardant configuracio.', true);
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

async function startRecording({ autoPasteOnComplete = false } = {}) {
  if (state.isTranscribing) {
    setRecStatus('Espera que acabi la transcripcio actual.', true);
    return;
  }

  if (isRecordingActive()) {
    return;
  }

  state.autoPasteOnComplete = Boolean(autoPasteOnComplete);

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    state.audioContext = new window.AudioContext();
    state.sampleRate = state.audioContext.sampleRate;
    state.sourceNode = state.audioContext.createMediaStreamSource(state.stream);
    state.processorNode = state.audioContext.createScriptProcessor(4096, 1, 1);

    state.chunks = [];
    state.totalLength = 0;

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
    setRecStatus('Gravant...');
    syncRecordingState(true, 'recording');
  } catch (error) {
    state.autoPasteOnComplete = false;
    releaseRecordingResources();
    syncRecordingState(false, 'idle');
    setRecStatus(error.message || 'No s\'ha pogut iniciar la gravacio.', true);
  }
}

async function stopRecordingAndTranscribe() {
  if (state.isTranscribing) {
    return;
  }

  if (!isRecordingActive()) {
    state.autoPasteOnComplete = false;
    syncRecordingState(false, 'idle');
    el.startRec.disabled = false;
    el.stopRec.disabled = true;
    setRecStatus('No hi ha cap gravacio activa.', true);
    return;
  }

  state.isTranscribing = true;
  const shouldAutoPaste = state.autoPasteOnComplete;

  try {
    el.stopRec.disabled = true;
    el.startRec.disabled = true;
    setRecStatus('Processant audio...');

    state.processorNode.disconnect();
    state.sourceNode.disconnect();
    state.stream.getTracks().forEach((track) => track.stop());
    await state.audioContext.close();
    state.processorNode = null;
    state.sourceNode = null;
    state.stream = null;
    state.audioContext = null;
    syncRecordingState(false, 'processing');

    const merged = window.audioUtils.mergeFloat32(state.chunks, state.totalLength);
    const downsampled = window.audioUtils.downsampleBuffer(merged, state.sampleRate, 16000);
    const wavBuffer = window.audioUtils.encodeWavFromFloat32(downsampled, 16000);
    const audioBase64 = window.audioUtils.arrayBufferToBase64(wavBuffer);

    setRecStatus('Transcrivint...');
    const text = await window.localWhisperApi.transcribe(audioBase64);
    el.result.value = text || '[Sense sortida textual]';

    if (text && shouldAutoPaste && typeof window.localWhisperApi.pasteTranscription === 'function') {
      const pasteResult = await window.localWhisperApi.pasteTranscription(text);
      if (pasteResult && pasteResult.ok) {
        setRecStatus(pasteResult.message || 'Completat i enganxat.');
      } else {
        setRecStatus(
          (pasteResult && pasteResult.message) ||
            'Completat. Text copiat al porta-retalls, enganxa manualment amb Cmd+V.',
          true
        );
      }
      return;
    }

    setRecStatus('Completat');
  } catch (error) {
    setRecStatus(error.message || 'Error de transcripcio.', true);
  } finally {
    state.isTranscribing = false;
    state.autoPasteOnComplete = false;
    releaseRecordingResources();
    syncRecordingState(false, 'idle');
    el.startRec.disabled = false;
    el.stopRec.disabled = true;
    state.chunks = [];
    state.totalLength = 0;
  }
}

function handleTrayCommand(payload) {
  const { command, source } = normalizeIncomingCommand(payload);

  if (command === 'start') {
    startRecording({ autoPasteOnComplete: source === 'shortcut' });
    return;
  }

  if (command === 'stop') {
    stopRecordingAndTranscribe();
  }
}

el.saveConfig.addEventListener('click', saveConfig);
el.pickBin.addEventListener('click', pickWhisperBin);
el.pickModel.addEventListener('click', pickModel);
el.recordShortcut.addEventListener('keydown', captureRecordShortcutFromKeyboardEvent);
el.recordShortcut.addEventListener('focus', () => {
  resetPendingShortcutModifiers();
  setConfigStatus('Prem la combinacio de tecles per al shortcut global.');
});
el.recordShortcut.addEventListener('blur', () => {
  resetPendingShortcutModifiers();
  setRecordShortcutValue(state.recordShortcutValue);
});
el.startRec.addEventListener('click', () => {
  startRecording({ autoPasteOnComplete: false });
});
el.stopRec.addEventListener('click', stopRecordingAndTranscribe);
const unsubscribeTray = window.localWhisperApi.onTrayCommand(handleTrayCommand);

setRecordShortcutValue(state.recordShortcutValue);
loadInitialConfig().catch((error) => {
  setConfigStatus(error.message || 'No s\'ha pogut carregar configuracio.', true);
});
notifyRendererReady();
syncRecordingState(false, 'idle');

window.addEventListener('beforeunload', () => {
  if (typeof unsubscribeTray === 'function') {
    unsubscribeTray();
  }

  syncRecordingState(false, 'idle');
});
