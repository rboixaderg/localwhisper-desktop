const path = require('node:path');
const fs = require('node:fs');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage
} = require('electron');
const { loadConfig, saveConfig } = require('./config-store');
const { transcribeAudio } = require('./stt-service');

let mainWindow = null;
let tray = null;
let trayImages = null;
let recordingAnimationTimer = null;
let recordingAnimationFrame = 0;
let quitRequested = false;
let rendererReady = false;
let isRecording = false;
const appIconPath = path.join(__dirname, '../assets/icon.png');
const trayAssetsDir = path.join(__dirname, '../assets/tray');
const RECORDING_ANIMATION_INTERVAL_MS = 260;
const TRAY_IDLE_FILE = 'tray-idleTemplate.png';
const TRAY_RECORDING_FILES = [
  'tray-recording-1Template.png',
  'tray-recording-2Template.png',
  'tray-recording-3Template.png',
  'tray-recording-4Template.png'
];

function loadTrayImage(fileName) {
  const filePath = path.join(trayAssetsDir, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) {
    return null;
  }

  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }

  return image;
}

function loadAppIconImage() {
  if (!fs.existsSync(appIconPath)) {
    return null;
  }

  const image = nativeImage.createFromPath(appIconPath);
  if (image.isEmpty()) {
    return null;
  }

  return image;
}

function getTrayImages() {
  if (trayImages) {
    return trayImages;
  }

  const idle = loadTrayImage(TRAY_IDLE_FILE);
  const recordingFrames = TRAY_RECORDING_FILES.map((fileName) => loadTrayImage(fileName)).filter(
    Boolean
  );
  const hasRecordingFrames = recordingFrames.length > 0 && recordingFrames.every((img) => !img.isEmpty());

  if (idle && !idle.isEmpty() && hasRecordingFrames) {
    trayImages = { idle, recordingFrames };
    return trayImages;
  }

  const appIcon = loadAppIconImage();
  if (appIcon) {
    const resized = appIcon.resize({ width: 18, height: 18 });
    if (process.platform === 'darwin' && !resized.isEmpty()) {
      resized.setTemplateImage(true);
    }
    trayImages = { idle: resized, recordingFrames: [resized] };
    return trayImages;
  }

  const empty = nativeImage.createEmpty();
  trayImages = { idle: empty, recordingFrames: [empty] };
  return trayImages;
}

function stopRecordingTrayAnimation() {
  if (recordingAnimationTimer) {
    clearInterval(recordingAnimationTimer);
    recordingAnimationTimer = null;
  }

  recordingAnimationFrame = 0;
}

function setCurrentRecordingFrameImage() {
  if (!tray) {
    return;
  }

  const images = getTrayImages();
  const frames =
    images.recordingFrames && images.recordingFrames.length > 0
      ? images.recordingFrames
      : [images.idle];

  const next = frames[recordingAnimationFrame % frames.length];
  tray.setImage(next);
  if (process.platform === 'darwin') {
    tray.setPressedImage(next);
  }
}

function startRecordingTrayAnimation() {
  if (recordingAnimationTimer) {
    return;
  }

  recordingAnimationFrame = 0;
  setCurrentRecordingFrameImage();

  recordingAnimationTimer = setInterval(() => {
    if (!tray || !isRecording) {
      return;
    }

    const images = getTrayImages();
    const frameCount = images.recordingFrames?.length || 1;
    recordingAnimationFrame = (recordingAnimationFrame + 1) % frameCount;
    setCurrentRecordingFrameImage();
  }, RECORDING_ANIMATION_INTERVAL_MS);
}

function canControlRecordingFromTray() {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && rendererReady);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  mainWindow.show();
  mainWindow.focus();
}

function sendRendererCommand(command) {
  if (!canControlRecordingFromTray()) {
    return;
  }

  mainWindow.webContents.send('tray:command', { command, source: 'tray' });
}

function updateTray() {
  if (!tray) {
    return;
  }

  const images = getTrayImages();

  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const recordingLabel = isRecording ? 'Aturar i transcriure' : 'Iniciar gravacio';
  const showLabel = windowVisible ? 'Amagar finestra' : 'Mostrar finestra';

  if (isRecording) {
    startRecordingTrayAnimation();
  } else {
    stopRecordingTrayAnimation();
    tray.setImage(images.idle);
    if (process.platform === 'darwin') {
      tray.setPressedImage(images.idle);
    }
  }

  tray.setToolTip(isRecording ? 'LocalWhisper (gravant)' : 'LocalWhisper');
  if (process.platform === 'darwin') {
    tray.setTitle('');
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: recordingLabel,
        enabled: canControlRecordingFromTray(),
        click: () => {
          sendRendererCommand(isRecording ? 'stop' : 'start');
        }
      },
      {
        label: showLabel,
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
            return;
          }

          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            showMainWindow();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Sortir',
        click: () => {
          quitRequested = true;
          app.quit();
        }
      }
    ])
  );
}

function createTray() {
  if (tray) {
    return;
  }

  const images = getTrayImages();
  tray = new Tray(images.idle);
  tray.on('double-click', () => {
    showMainWindow();
  });
  updateTray();
}

function createWindow() {
  rendererReady = false;
  updateTray();

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !quitRequested) {
      event.preventDefault();
      mainWindow.hide();
      updateTray();
    }
  });

  mainWindow.on('show', updateTray);
  mainWindow.on('hide', updateTray);

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      const appIcon = loadAppIconImage();
      if (appIcon) {
        app.dock.setIcon(appIcon);
      }
    } catch (error) {
      console.error('Failed to set dock icon:', error);
    }
  }

  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }

    showMainWindow();
  });
});

app.on('before-quit', () => {
  quitRequested = true;
  stopRecordingTrayAnimation();
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

ipcMain.handle('renderer:ready', async () => {
  rendererReady = true;
  updateTray();
  return true;
});

ipcMain.handle('recording:set-state', async (_event, payload) => {
  isRecording = Boolean(payload && payload.isRecording);
  updateTray();
  return true;
});
