const path = require('node:path');
const fs = require('node:fs');
const { Tray, Menu, nativeImage } = require('electron');

const ASSETS_DIR = path.join(__dirname, '../assets');
const TRAY_DIR = path.join(ASSETS_DIR, 'tray');
const APP_ICON_PATH = path.join(ASSETS_DIR, 'icon.png');
const ANIMATION_INTERVAL_MS = 260;

const IDLE_FILE = 'tray-idleTemplate.png';
const RECORDING_FRAME_FILES = [
  'tray-recording-1Template.png',
  'tray-recording-2Template.png',
  'tray-recording-3Template.png',
  'tray-recording-4Template.png'
];
const TRANSCRIBING_FRAME_FILES = [
  'tray-transcribing-1Template.png',
  'tray-transcribing-2Template.png',
  'tray-transcribing-3Template.png',
  'tray-transcribing-4Template.png'
];

let tray = null;
let cachedImages = null;
let animationTimer = null;
let animationFrame = 0;
let activePhase = 'idle';

let getState = () => ({ mainWindow: null, rendererReady: false, isRecording: false, phase: 'idle' });
let onCommand = () => {};

function loadImage(filePath, asTemplate) {
  if (!fs.existsSync(filePath)) return null;
  const img = nativeImage.createFromPath(filePath);
  if (img.isEmpty()) return null;
  if (asTemplate && process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function getImages() {
  if (cachedImages) return cachedImages;

  const isMac = process.platform === 'darwin';
  const idle = loadImage(path.join(TRAY_DIR, IDLE_FILE), isMac);
  const recFrames = RECORDING_FRAME_FILES
    .map((f) => loadImage(path.join(TRAY_DIR, f), isMac))
    .filter(Boolean);
  const trFrames = TRANSCRIBING_FRAME_FILES
    .map((f) => loadImage(path.join(TRAY_DIR, f), isMac))
    .filter(Boolean);

  if (idle && recFrames.length === RECORDING_FRAME_FILES.length) {
    cachedImages = {
      idle,
      recFrames,
      trFrames: trFrames.length === TRANSCRIBING_FRAME_FILES.length ? trFrames : recFrames
    };
    return cachedImages;
  }

  const appIcon = loadImage(APP_ICON_PATH, false);
  if (appIcon) {
    const resized = appIcon.resize({ width: 18, height: 18 });
    if (isMac) resized.setTemplateImage(true);
    cachedImages = { idle: resized, recFrames: [resized], trFrames: [resized] };
    return cachedImages;
  }

  const empty = nativeImage.createEmpty();
  cachedImages = { idle: empty, recFrames: [empty], trFrames: [empty] };
  return cachedImages;
}

function animFramesForPhase(phase) {
  const { recFrames, trFrames } = getImages();
  if (phase === 'transcribing' || phase === 'pasting' || phase === 'processing') {
    return trFrames;
  }
  return recFrames;
}

function setTrayImage(img) {
  if (!tray) return;
  tray.setImage(img);
  if (process.platform === 'darwin') tray.setPressedImage(img);
}

function stopAnimation() {
  if (!animationTimer) return;
  clearInterval(animationTimer);
  animationTimer = null;
  animationFrame = 0;
  activePhase = 'idle';
}

function startAnimation(phase) {
  const frames = animFramesForPhase(phase);
  const needsRestart = animationTimer && activePhase !== phase;

  if (!animationTimer || needsRestart) {
    if (animationTimer) {
      clearInterval(animationTimer);
      animationTimer = null;
    }
    animationFrame = 0;
    activePhase = phase;
    setTrayImage(frames[0]);

    animationTimer = setInterval(() => {
      if (!tray) return;
      const currentFrames = animFramesForPhase(activePhase);
      animationFrame = (animationFrame + 1) % currentFrames.length;
      setTrayImage(currentFrames[animationFrame]);
    }, ANIMATION_INTERVAL_MS);
  }
}

function update() {
  if (!tray) return;

  const { idle } = getImages();
  const { mainWindow, rendererReady, isRecording, phase } = getState();

  const canControl = Boolean(mainWindow && !mainWindow.isDestroyed() && rendererReady);
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());

  const active = isRecording || phase === 'processing' || phase === 'transcribing' || phase === 'pasting';

  if (active) {
    startAnimation(isRecording ? 'recording' : (phase || 'transcribing'));
  } else {
    stopAnimation();
    setTrayImage(idle);
  }

  let tooltip = 'LocalWhisper';
  if (isRecording) {
    tooltip = 'LocalWhisper (gravant)';
  } else if (phase === 'processing') {
    tooltip = 'LocalWhisper (processant)';
  } else if (phase === 'transcribing') {
    tooltip = 'LocalWhisper (transcrivint)';
  } else if (phase === 'pasting') {
    tooltip = 'LocalWhisper (enganxant)';
  }

  tray.setToolTip(tooltip);
  if (process.platform === 'darwin') tray.setTitle('');

  let startStopLabel;
  if (isRecording) {
    startStopLabel = 'Aturar i transcriure';
  } else if (phase === 'processing' || phase === 'transcribing' || phase === 'pasting') {
    startStopLabel = 'Transcrivint...';
  } else {
    startStopLabel = 'Iniciar gravacio';
  }

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: startStopLabel,
        enabled: canControl && isRecording,
        click: () => onCommand('stop')
      },
      {
        label: 'Iniciar gravacio',
        enabled: canControl && !active,
        click: () => onCommand('start')
      },
      {
        label: windowVisible ? 'Amagar finestra' : 'Mostrar finestra',
        click: () => onCommand('toggle-window')
      },
      { type: 'separator' },
      {
        label: 'Sortir',
        click: () => onCommand('quit')
      }
    ])
  );
}

function create({ stateGetter, commandHandler }) {
  if (tray) return;

  getState = stateGetter;
  onCommand = commandHandler;

  const { idle } = getImages();
  tray = new Tray(idle);
  tray.on('double-click', () => onCommand('show-window'));
  update();
}

function destroy() {
  stopAnimation();
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function getAppIcon() {
  return loadImage(APP_ICON_PATH, false);
}

module.exports = { create, update, destroy, stopAnimation, getAppIcon, APP_ICON_PATH };
