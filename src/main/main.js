const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, systemPreferences, globalShortcut, shell } = require('electron');
const { loadConfig, saveConfig } = require('./config-store');
const { transcribeAudio } = require('./stt-service');
const { pasteTextToActiveApp } = require('./paste-service');
const trayManager = require('./tray-manager');
const overlayWindow = require('./overlay-window');

let mainWindow = null;
let rendererReady = false;
let isRecording = false;
let recordingPhase = 'idle';
let quitRequested = false;
let shortcutStatus = { registered: false, accelerator: '', error: '' };

function getAppState() {
  return { mainWindow, rendererReady, isRecording, phase: recordingPhase };
}

function sendRendererCommand(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    mainWindow.webContents.send(channel, payload);
  }
}

function handleGlobalShortcut() {
  if (isRecording) {
    sendRendererCommand('shortcut:command', { command: 'stop', source: 'shortcut' });
  } else {
    sendRendererCommand('shortcut:command', { command: 'start', source: 'shortcut' });
  }
}

function unregisterGlobalShortcut() {
  globalShortcut.unregisterAll();
  shortcutStatus = { registered: false, accelerator: '', error: '' };
}

function registerGlobalShortcut(accelerator) {
  unregisterGlobalShortcut();

  if (!accelerator) {
    return shortcutStatus;
  }

  try {
    const ok = globalShortcut.register(accelerator, handleGlobalShortcut);

    if (ok) {
      shortcutStatus = { registered: true, accelerator, error: '' };
    } else {
      shortcutStatus = {
        registered: false,
        accelerator,
        error: 'Shortcut is taken or invalid. Try a different combination.'
      };
    }
  } catch (err) {
    shortcutStatus = {
      registered: false,
      accelerator,
      error: err.message || 'Error registering shortcut.'
    };
  }

  sendRendererCommand('shortcut:status', shortcutStatus);
  return shortcutStatus;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  rendererReady = false;
  trayManager.update();

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 760,
    icon: trayManager.APP_ICON_PATH,
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
      trayManager.update();
    }
  });

  mainWindow.on('show', () => trayManager.update());
  mainWindow.on('hide', () => trayManager.update());

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (isRecording || recordingPhase !== 'idle') {
      isRecording = false;
      recordingPhase = 'idle';
      overlayWindow.hide();
      trayManager.update();
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function handleTrayCommand(command) {
  switch (command) {
    case 'start':
    case 'stop':
      if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
        mainWindow.webContents.send('tray:command', { command, source: 'tray' });
      }
      break;

    case 'toggle-window':
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
      } else if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        showWindow();
      }
      break;

    case 'show-window':
      showWindow();
      break;

    case 'quit':
      quitRequested = true;
      app.quit();
      break;
  }
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    if (app.dock) {
      try {
        const appIcon = trayManager.getAppIcon();
        if (appIcon) app.dock.setIcon(appIcon);
      } catch (err) {
        console.error('Failed to set dock icon:', err);
      }
    }

    try {
      await systemPreferences.askForMediaAccess('microphone');
    } catch (err) {
      console.error('Failed to request microphone access:', err);
    }
  }

  const config = await loadConfig();
  createWindow();
  overlayWindow.create();
  trayManager.create({ stateGetter: getAppState, commandHandler: handleTrayCommand });

  registerGlobalShortcut(config.shortcut);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      showWindow();
    }
  });
});

app.on('before-quit', () => {
  quitRequested = true;
  unregisterGlobalShortcut();
  overlayWindow.destroy();
  trayManager.stopAnimation();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC handlers ---

ipcMain.handle('config:load', () => loadConfig());

ipcMain.handle('config:save', (_event, config) => saveConfig(config));

ipcMain.handle('file:pick', async (_event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result.canceled || result.filePaths.length === 0 ? '' : result.filePaths[0];
});

ipcMain.handle('stt:transcribe', async (_event, payload) => {
  const config = await loadConfig();
  return transcribeAudio({ audioBase64: payload.audioBase64, config });
});

ipcMain.handle('renderer:ready', () => {
  rendererReady = true;
  trayManager.update();
  return true;
});

ipcMain.handle('recording:set-state', (_event, payload) => {
  isRecording = Boolean(payload && payload.isRecording);
  recordingPhase = (payload && typeof payload.phase === 'string') ? payload.phase : 'idle';

  if (recordingPhase === 'recording' || recordingPhase === 'processing' || recordingPhase === 'transcribing' || recordingPhase === 'pasting') {
    overlayWindow.showPhase(recordingPhase);
  } else {
    overlayWindow.hide();
  }

  trayManager.update();
  return true;
});

ipcMain.handle('shortcut:register', async (_event, accelerator) => {
  return registerGlobalShortcut(accelerator);
});

ipcMain.handle('shortcut:get-status', async () => {
  return shortcutStatus;
});

ipcMain.handle('text:paste', async (_event, payload) => {
  if (!payload || typeof payload.text !== 'string') {
    throw new Error('No text to paste.');
  }

  return pasteTextToActiveApp(payload.text);
});

ipcMain.handle('permissions:open-accessibility', async () => {
  const trusted = systemPreferences.isTrustedAccessibilityClient(true);

  if (!trusted) {
    shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    );
  }

  return { trusted };
});

ipcMain.handle('permissions:get-status', async () => {
  return {
    appName: app.getName(),
    accessibilityTrusted: systemPreferences.isTrustedAccessibilityClient(false)
  };
});
