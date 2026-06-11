const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayApi', {
  onPhase: (handler) => {
    if (typeof handler !== 'function') return () => {};

    const listener = (_event, payload) => handler(payload);

    ipcRenderer.on('overlay:phase', listener);
    return () => {
      ipcRenderer.removeListener('overlay:phase', listener);
    };
  }
});
