const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { loadConfig, saveConfig } = require('./config-store');
const { transcribeAudio } = require('./stt-service');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('config:load', async () => {
  return loadConfig();
});

ipcMain.handle('config:save', async (_event, config) => {
  return saveConfig(config);
});

ipcMain.handle('file:pick', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  if (result.canceled || result.filePaths.length === 0) {
    return '';
  }

  return result.filePaths[0];
});

ipcMain.handle('stt:transcribe', async (_event, payload) => {
  const config = await loadConfig();
  return transcribeAudio({ audioBase64: payload.audioBase64, config });
});
