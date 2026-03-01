const state = {
  stream: null,
  audioContext: null,
  sourceNode: null,
  processorNode: null,
  chunks: [],
  totalLength: 0,
  sampleRate: 48000,
  isTranscribing: false
};

const el = {
  whisperBinPath: document.getElementById('whisperBinPath'),
  modelPath: document.getElementById('modelPath'),
  language: document.getElementById('language'),
  extraArgs: document.getElementById('extraArgs'),
  saveConfig: document.getElementById('saveConfig'),
  pickBin: document.getElementById('pickBin'),
  pickModel: document.getElementById('pickModel'),
  configStatus: document.getElementById('configStatus'),
  startRec: document.getElementById('startRec'),
  stopRec: document.getElementById('stopRec'),
  recStatus: document.getElementById('recStatus'),
  result: document.getElementById('result')
};

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
    return { command: payload };
  }

  if (!payload || typeof payload !== 'object') {
    return { command: '' };
  }

  return {
    command: typeof payload.command === 'string' ? payload.command : ''
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
    extraArgs: el.extraArgs.value.trim()
  };
}

function setConfigToUi(config) {
  el.whisperBinPath.value = config.whisperBinPath || '';
  el.modelPath.value = config.modelPath || '';
  el.language.value = config.language || 'auto';
  el.extraArgs.value = config.extraArgs || '-otxt';
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

async function startRecording() {
  if (state.isTranscribing) {
    setRecStatus('Espera que acabi la transcripcio actual.', true);
    return;
  }

  if (isRecordingActive()) {
    return;
  }

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
    syncRecordingState(false, 'idle');
    el.startRec.disabled = false;
    el.stopRec.disabled = true;
    setRecStatus('No hi ha cap gravacio activa.', true);
    return;
  }

  state.isTranscribing = true;

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

    setRecStatus('Completat');
  } catch (error) {
    setRecStatus(error.message || 'Error de transcripcio.', true);
  } finally {
    state.isTranscribing = false;
    releaseRecordingResources();
    syncRecordingState(false, 'idle');
    el.startRec.disabled = false;
    el.stopRec.disabled = true;
    state.chunks = [];
    state.totalLength = 0;
  }
}

function handleTrayCommand(payload) {
  const { command } = normalizeIncomingCommand(payload);

  if (command === 'start') {
    startRecording();
    return;
  }

  if (command === 'stop') {
    stopRecordingAndTranscribe();
  }
}

el.saveConfig.addEventListener('click', saveConfig);
el.pickBin.addEventListener('click', pickWhisperBin);
el.pickModel.addEventListener('click', pickModel);
el.startRec.addEventListener('click', () => {
  startRecording();
});
el.stopRec.addEventListener('click', stopRecordingAndTranscribe);
const unsubscribeTray = window.localWhisperApi.onTrayCommand(handleTrayCommand);

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
