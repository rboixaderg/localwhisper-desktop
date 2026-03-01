const state = {
  stream: null,
  audioContext: null,
  sourceNode: null,
  processorNode: null,
  chunks: [],
  totalLength: 0,
  sampleRate: 48000
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
    await window.localWhisperApi.saveConfig(config);
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
  } catch (error) {
    setRecStatus(error.message || 'No s\'ha pogut iniciar la gravacio.', true);
  }
}

async function stopRecordingAndTranscribe() {
  try {
    el.stopRec.disabled = true;
    setRecStatus('Processant audio...');

    state.processorNode.disconnect();
    state.sourceNode.disconnect();
    state.stream.getTracks().forEach((track) => track.stop());
    await state.audioContext.close();

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
    el.startRec.disabled = false;
    el.stopRec.disabled = true;
    state.chunks = [];
    state.totalLength = 0;
  }
}

el.saveConfig.addEventListener('click', saveConfig);
el.pickBin.addEventListener('click', pickWhisperBin);
el.pickModel.addEventListener('click', pickModel);
el.startRec.addEventListener('click', startRecording);
el.stopRec.addEventListener('click', stopRecordingAndTranscribe);

loadInitialConfig().catch((error) => {
  setConfigStatus(error.message || 'No s\'ha pogut carregar configuracio.', true);
});
