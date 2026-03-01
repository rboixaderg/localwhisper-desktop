const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localWhisperApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  pickFile: (options) => ipcRenderer.invoke('file:pick', options),
  transcribe: (audioBase64) => ipcRenderer.invoke('stt:transcribe', { audioBase64 })
});
