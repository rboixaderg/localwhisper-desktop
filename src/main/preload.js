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
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  pickFile: (options) => ipcRenderer.invoke('file:pick', options),
  transcribe: (audioBase64) => ipcRenderer.invoke('stt:transcribe', { audioBase64 }),
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
