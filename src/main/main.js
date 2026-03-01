const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  clipboard,
  systemPreferences,
  screen
} = require('electron');
const { loadConfig, saveConfig, DEFAULT_RECORD_SHORTCUT } = require('./config-store');
const { transcribeAudio } = require('./stt-service');

const execFileAsync = promisify(execFile);

let mainWindow = null;
let tray = null;
let trayImages = null;
let recordingAnimationTimer = null;
let recordingAnimationFrame = 0;
let quitRequested = false;
let rendererReady = false;
let isRecording = false;
let shortcutPasteTarget = null;
let lastShortcutPasteError = null;
let currentRecordShortcut = DEFAULT_RECORD_SHORTCUT;
let registeredRecordShortcut = '';
let statusOverlayWindow = null;
let statusOverlayHideTimer = null;
const appIconPath = path.join(__dirname, '../assets/icon.png');
const trayAssetsDir = path.join(__dirname, '../assets/tray');
const RECORDING_ANIMATION_INTERVAL_MS = 260;
const STATUS_OVERLAY_WIDTH = 340;
const STATUS_OVERLAY_HEIGHT = 76;
const STATUS_OVERLAY_HIDE_DELAY_MS = 1200;
const STATUS_PHASE_MESSAGES = {
  recording: "S'esta escoltant...",
  processing: "S'esta processant..."
};
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

function buildStatusOverlayHtml() {
  return `<!doctype html>
<html lang="ca">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        color-scheme: light dark;
      }
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: transparent;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .pill {
        min-width: 260px;
        max-width: 320px;
        padding: 14px 18px;
        border-radius: 14px;
        background: rgba(20, 24, 23, 0.9);
        color: #f5f8f6;
        text-align: center;
        font-size: 17px;
        line-height: 1.2;
        font-weight: 600;
        letter-spacing: 0.01em;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(255, 255, 255, 0.12);
        -webkit-backdrop-filter: blur(8px);
        backdrop-filter: blur(8px);
      }
    </style>
  </head>
  <body>
    <div class="pill" id="status">LocalWhisper</div>
    <script>
      window.setOverlayStatus = (value) => {
        const target = document.getElementById('status');
        if (!target) {
          return;
        }

        target.textContent = value || 'LocalWhisper';
      };
    </script>
  </body>
</html>`;
}

function clearStatusOverlayHideTimer() {
  if (statusOverlayHideTimer) {
    clearTimeout(statusOverlayHideTimer);
    statusOverlayHideTimer = null;
  }
}

function hideStatusOverlay() {
  clearStatusOverlayHideTimer();
  if (!statusOverlayWindow || statusOverlayWindow.isDestroyed()) {
    return;
  }

  statusOverlayWindow.hide();
}

function setStatusOverlayPosition() {
  if (!statusOverlayWindow || statusOverlayWindow.isDestroyed()) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const bounds = activeDisplay.workArea;

  const x = Math.round(bounds.x + (bounds.width - STATUS_OVERLAY_WIDTH) / 2);
  const y = Math.round(bounds.y + 28);
  statusOverlayWindow.setBounds({
    x,
    y,
    width: STATUS_OVERLAY_WIDTH,
    height: STATUS_OVERLAY_HEIGHT
  });
}

function createStatusOverlayWindow() {
  if (statusOverlayWindow && !statusOverlayWindow.isDestroyed()) {
    return statusOverlayWindow;
  }

  statusOverlayWindow = new BrowserWindow({
    width: STATUS_OVERLAY_WIDTH,
    height: STATUS_OVERLAY_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    roundedCorners: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  statusOverlayWindow.setAlwaysOnTop(true, 'screen-saver');
  statusOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  statusOverlayWindow.setIgnoreMouseEvents(true);
  statusOverlayWindow.on('closed', () => {
    clearStatusOverlayHideTimer();
    statusOverlayWindow = null;
  });

  statusOverlayWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(buildStatusOverlayHtml())}`
  );
  setStatusOverlayPosition();

  return statusOverlayWindow;
}

async function showStatusOverlay(message) {
  const win = createStatusOverlayWindow();
  if (!win || win.isDestroyed()) {
    return;
  }

  clearStatusOverlayHideTimer();
  setStatusOverlayPosition();

  if (win.webContents.isLoadingMainFrame()) {
    await new Promise((resolve) => {
      win.webContents.once('did-finish-load', resolve);
    });
  }

  const safeMessage = JSON.stringify(message || 'LocalWhisper');
  try {
    await win.webContents.executeJavaScript(`window.setOverlayStatus(${safeMessage});`, true);
  } catch {
    // Ignore; overlay can still be shown with previous text.
  }

  if (process.platform === 'darwin') {
    win.showInactive();
  } else {
    win.show();
  }
}

function scheduleStatusOverlayHide(delayMs = STATUS_OVERLAY_HIDE_DELAY_MS) {
  clearStatusOverlayHideTimer();
  statusOverlayHideTimer = setTimeout(() => {
    hideStatusOverlay();
  }, delayMs);
}

function updateStatusOverlayForPhase(phase) {
  if (phase === 'recording') {
    showStatusOverlay(STATUS_PHASE_MESSAGES.recording).catch(() => {});
    return;
  }

  if (phase === 'processing') {
    showStatusOverlay(STATUS_PHASE_MESSAGES.processing).catch(() => {});
    return;
  }

  scheduleStatusOverlayHide();
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

function clearShortcutPasteTarget() {
  shortcutPasteTarget = null;
  lastShortcutPasteError = null;
}

function isMacPermissionError(error) {
  const message = String(error && error.message ? error.message : '').toLowerCase();
  return (
    message.includes('-1743') ||
    message.includes('not authorized') ||
    message.includes('not permitted') ||
    message.includes('assistive access') ||
    message.includes('automation')
  );
}

function getMacPermissionMessage() {
  return (
    'Cal permetre Accessibilitat i Automatitzacio (System Events) a LocalWhisper ' +
    '(Configuracio del sistema > Privacitat i seguretat).'
  );
}

async function runAppleScript(script, args = []) {
  const commandArgs = ['-e', script];
  if (args.length > 0) {
    commandArgs.push('--', ...args.map((item) => String(item)));
  }

  const { stdout } = await execFileAsync('/usr/bin/osascript', commandArgs);
  return String(stdout || '').trim();
}

async function getFrontmostAppTarget() {
  if (process.platform !== 'darwin') {
    return null;
  }

  const script = `
    tell application "System Events"
      set frontProcess to first application process whose frontmost is true
      set appName to name of frontProcess
      set bundleId to ""
      set pidValue to ""
      try
        set bundleId to bundle identifier of frontProcess
      end try
      try
        set pidValue to (unix id of frontProcess) as text
      end try
      return bundleId & tab & appName & tab & pidValue
    end tell
  `.trim();

  const output = await runAppleScript(script);
  if (!output) {
    return null;
  }

  const parts = output.split('\t');
  const bundleIdRaw = parts[0] || '';
  const appNameRaw = parts[1] || '';
  const pidRaw = parts[2] || '';
  const bundleId = bundleIdRaw.trim();
  const appName = appNameRaw.trim();
  const pid = Number.parseInt(pidRaw.trim(), 10);
  const processId = Number.isFinite(pid) ? pid : null;
  if (processId && processId === process.pid) {
    return null;
  }

  const ownBundleId = app.getBundleId();
  const ownName = app.getName();
  if (!processId && bundleId && appName && bundleId === ownBundleId && appName === ownName) {
    return null;
  }

  if (!bundleId && !appName) {
    return null;
  }

  return { bundleId, appName, processId };
}

async function captureShortcutPasteTarget(options = {}) {
  const { clearOnFailure = true } = options;

  if (process.platform !== 'darwin') {
    clearShortcutPasteTarget();
    return;
  }

  try {
    const target = await getFrontmostAppTarget();
    if (target) {
      shortcutPasteTarget = target;
      lastShortcutPasteError = null;
      return;
    }

    if (clearOnFailure) {
      clearShortcutPasteTarget();
    }
  } catch (error) {
    lastShortcutPasteError = error;
    if (clearOnFailure) {
      shortcutPasteTarget = null;
    }
  }
}

async function activateTargetAndPaste(target) {
  const byProcessIdScript = `
    on run argv
      set pidValue to (item 1 of argv) as integer
      tell application "System Events"
        set frontmost of (first application process whose unix id is pidValue) to true
      end tell
      delay 0.18
      tell application "System Events"
        keystroke "v" using {command down}
      end tell
    end run
  `.trim();

  const byBundleIdScript = `
    on run argv
      set bundleId to item 1 of argv
      tell application id bundleId to activate
      delay 0.18
      tell application "System Events"
        keystroke "v" using {command down}
      end tell
    end run
  `.trim();

  const byNameScript = `
    on run argv
      set appName to item 1 of argv
      tell application appName to activate
      delay 0.18
      tell application "System Events"
        keystroke "v" using {command down}
      end tell
    end run
  `.trim();

  if (typeof target.processId === 'number' && Number.isFinite(target.processId)) {
    try {
      await runAppleScript(byProcessIdScript, [target.processId]);
      return;
    } catch {
      // Continue with fallbacks.
    }
  }

  if (target.bundleId) {
    try {
      await runAppleScript(byBundleIdScript, [target.bundleId]);
      return;
    } catch {
      // Fallback by app name when bundle id activation fails.
    }
  }

  if (target.appName) {
    await runAppleScript(byNameScript, [target.appName]);
    return;
  }

  throw new Error('No destination app target was captured.');
}

async function pasteToCurrentFrontmostApp() {
  const script = `
    tell application "System Events"
      keystroke "v" using {command down}
    end tell
  `.trim();

  await runAppleScript(script);
}

async function pasteTranscriptionToCapturedTarget(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, message: 'No hi ha text per enganxar.' };
  }

  clipboard.writeText(text);

  if (process.platform !== 'darwin') {
    clearShortcutPasteTarget();
    return {
      ok: false,
      message: 'L\'enganxat automatic nomes esta disponible a macOS. Text copiat al porta-retalls.'
    };
  }

  if (!systemPreferences.isTrustedAccessibilityClient(true)) {
    return {
      ok: false,
      message: getMacPermissionMessage()
    };
  }

  const capturedDetectionError = lastShortcutPasteError;
  let target = shortcutPasteTarget;
  shortcutPasteTarget = null;
  lastShortcutPasteError = null;

  if (!target) {
    try {
      target = await getFrontmostAppTarget();
    } catch {
      target = null;
    }
  }

  if (!target) {
    try {
      await pasteToCurrentFrontmostApp();
      return { ok: true, message: 'Completat i enganxat a l\'app activa.' };
    } catch (error) {
      if (isMacPermissionError(error) || isMacPermissionError(capturedDetectionError)) {
        return {
          ok: false,
          message: getMacPermissionMessage()
        };
      }

      return {
        ok: false,
        message: 'No s\'ha detectat cap app desti. Text copiat al porta-retalls.'
      };
    }
  }

  try {
    await activateTargetAndPaste(target);
    const appName = target.appName ? ` a ${target.appName}` : '';
    return { ok: true, message: `Completat i enganxat${appName}.` };
  } catch {
    try {
      await pasteToCurrentFrontmostApp();
      return { ok: true, message: 'Completat i enganxat a l\'app activa.' };
    } catch (error) {
      if (isMacPermissionError(error) || isMacPermissionError(capturedDetectionError)) {
        return {
          ok: false,
          message: getMacPermissionMessage()
        };
      }

      return {
        ok: false,
        message: 'No s\'ha pogut enganxar automaticament. Text copiat al porta-retalls.'
      };
    }
  }
}

function sendRendererCommand(command, source) {
  if (!canControlRecordingFromTray()) {
    return;
  }

  if (command === 'start' && source !== 'shortcut') {
    clearShortcutPasteTarget();
  }

  mainWindow.webContents.send('tray:command', { command, source });
}

async function handleGlobalShortcutToggle() {
  if (!canControlRecordingFromTray()) {
    showMainWindow();
    return;
  }

  const nextCommand = isRecording ? 'stop' : 'start';
  if (nextCommand === 'start') {
    await captureShortcutPasteTarget({ clearOnFailure: true });
  } else {
    await captureShortcutPasteTarget({ clearOnFailure: false });
  }

  sendRendererCommand(nextCommand, 'shortcut');
}

function normalizeRecordShortcut(shortcut) {
  if (typeof shortcut !== 'string') {
    return DEFAULT_RECORD_SHORTCUT;
  }

  const normalized = shortcut.trim();
  return normalized || DEFAULT_RECORD_SHORTCUT;
}

function registerGlobalRecordingShortcut(nextShortcut, options = {}) {
  const { throwOnError = false } = options;
  const shortcut = normalizeRecordShortcut(nextShortcut);

  if (
    registeredRecordShortcut === shortcut &&
    registeredRecordShortcut &&
    globalShortcut.isRegistered(registeredRecordShortcut)
  ) {
    currentRecordShortcut = shortcut;
    updateTray();
    return { ok: true, shortcut };
  }

  let registered = false;
  try {
    registered = globalShortcut.register(shortcut, () => {
      handleGlobalShortcutToggle().catch((error) => {
        console.error('Global shortcut handler failed:', error);
      });
    });
  } catch {
    registered = false;
  }

  if (!registered) {
    const message = `No s'ha pogut registrar el shortcut global: ${shortcut}.`;
    if (throwOnError) {
      throw new Error(`${message} Revisa el format o si ja l'usa una altra app.`);
    }

    return { ok: false, shortcut: currentRecordShortcut, message };
  }

  if (registeredRecordShortcut && registeredRecordShortcut !== shortcut) {
    globalShortcut.unregister(registeredRecordShortcut);
  }

  registeredRecordShortcut = shortcut;
  currentRecordShortcut = shortcut;
  updateTray();
  return { ok: true, shortcut };
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
        label: `${recordingLabel} (${currentRecordShortcut})`,
        enabled: canControlRecordingFromTray(),
        click: () => {
          sendRendererCommand(isRecording ? 'stop' : 'start', 'tray');
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
  try {
    const config = await loadConfig();
    const result = registerGlobalRecordingShortcut(config.recordShortcut);
    if (!result.ok && result.message) {
      console.error(result.message);
      registerGlobalRecordingShortcut(DEFAULT_RECORD_SHORTCUT);
    }
  } catch (error) {
    console.error('Failed to initialize shortcut from config:', error);
    registerGlobalRecordingShortcut(DEFAULT_RECORD_SHORTCUT);
  }

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
  hideStatusOverlay();
  if (statusOverlayWindow && !statusOverlayWindow.isDestroyed()) {
    statusOverlayWindow.destroy();
    statusOverlayWindow = null;
  }
  clearShortcutPasteTarget();
  registeredRecordShortcut = '';
  currentRecordShortcut = DEFAULT_RECORD_SHORTCUT;
  globalShortcut.unregisterAll();
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
  const previousConfig = await loadConfig();
  const nextConfig = await saveConfig(config);

  try {
    const result = registerGlobalRecordingShortcut(nextConfig.recordShortcut, { throwOnError: true });
    return { ...nextConfig, recordShortcut: result.shortcut };
  } catch (error) {
    await saveConfig(previousConfig);
    throw error;
  }
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
  const phase =
    payload && typeof payload.phase === 'string'
      ? payload.phase
      : isRecording
        ? 'recording'
        : 'idle';
  updateTray();
  updateStatusOverlayForPhase(phase);
  return true;
});

ipcMain.handle('transcription:paste', async (_event, payload) => {
  const text = payload && typeof payload.text === 'string' ? payload.text : '';
  return pasteTranscriptionToCapturedTarget(text);
});
