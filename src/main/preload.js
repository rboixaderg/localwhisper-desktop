const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localWhisperApi', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  pickFile: (options) => ipcRenderer.invoke('file:pick', options),
  transcribe: (audioBase64) => ipcRenderer.invoke('stt:transcribe', { audioBase64 }),
  pasteTranscription: (text) => ipcRenderer.invoke('transcription:paste', { text }),
  notifyRendererReady: () => ipcRenderer.invoke('renderer:ready'),
  setRecordingState: (isRecording, phase) =>
    ipcRenderer.invoke('recording:set-state', { isRecording, phase }),
  onTrayCommand: (handler) => {
    if (typeof handler !== 'function') {
      return () => {};
    }

    const listener = (_event, command) => {
      handler(command);
    };

    ipcRenderer.on('tray:command', listener);
    return () => {
      ipcRenderer.removeListener('tray:command', listener);
    };
  }
});
