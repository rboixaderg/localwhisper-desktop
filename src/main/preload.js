const { contextBridge, ipcRenderer } = require('electron');

function createIpcListener(channel) {
  return function onEvent(handler) {
    if (typeof handler !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => {
      handler(payload);
    };

    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

contextBridge.exposeInMainWorld('localWhisperApi', {
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  pickFile: (options) => ipcRenderer.invoke('file:pick', options),
  describeGlossary: (payload) => ipcRenderer.invoke('glossary:describe', payload),
  exportGlossary: (payload) => ipcRenderer.invoke('glossary:export', payload),
  importGlossary: () => ipcRenderer.invoke('glossary:import'),
  transcribe: (audioBase64, source) =>
    ipcRenderer.invoke('stt:transcribe', { audioBase64, source }),
  listBenchmarks: () => ipcRenderer.invoke('benchmarks:list'),
  getBenchmark: (id) => ipcRenderer.invoke('benchmarks:get', { id }),
  getBenchmarkAudio: (id) => ipcRenderer.invoke('benchmarks:get-audio', { id }),
  reprocessBenchmark: (id, runId) =>
    ipcRenderer.invoke('benchmarks:reprocess', { id, runId }),
  retranscribeBenchmark: (id) => ipcRenderer.invoke('benchmarks:retranscribe', { id }),
  setBenchmarkReference: (id, text) =>
    ipcRenderer.invoke('benchmarks:set-reference', { id, text }),
  deleteBenchmark: (id) => ipcRenderer.invoke('benchmarks:delete', { id }),
  deleteAllBenchmarks: () => ipcRenderer.invoke('benchmarks:delete-all'),
  notifyRendererReady: () => ipcRenderer.invoke('renderer:ready'),
  setRecordingState: (isRecording, phase) =>
    ipcRenderer.invoke('recording:set-state', { isRecording, phase }),
  onTrayCommand: createIpcListener('tray:command'),
  onShortcutCommand: createIpcListener('shortcut:command'),
  onShortcutStatus: createIpcListener('shortcut:status'),
  registerShortcut: (accelerator) =>
    ipcRenderer.invoke('shortcut:register', accelerator),
  getShortcutStatus: () => ipcRenderer.invoke('shortcut:get-status'),
  pasteText: (text) => ipcRenderer.invoke('text:paste', { text }),
  openAccessibilityPermissions: () =>
    ipcRenderer.invoke('permissions:open-accessibility'),
  getPermissionsStatus: () =>
    ipcRenderer.invoke('permissions:get-status')
});
