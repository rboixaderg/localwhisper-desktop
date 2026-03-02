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

let tray = null;
let cachedImages = null;
let animationTimer = null;
let animationFrame = 0;

let getState = () => ({ mainWindow: null, rendererReady: false, isRecording: false });
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
  const frames = RECORDING_FRAME_FILES
    .map((f) => loadImage(path.join(TRAY_DIR, f), isMac))
    .filter(Boolean);

  if (idle && frames.length === RECORDING_FRAME_FILES.length) {
    cachedImages = { idle, frames };
    return cachedImages;
  }

  const appIcon = loadImage(APP_ICON_PATH, false);
  if (appIcon) {
    const resized = appIcon.resize({ width: 18, height: 18 });
    if (isMac) resized.setTemplateImage(true);
    cachedImages = { idle: resized, frames: [resized] };
    return cachedImages;
  }

  const empty = nativeImage.createEmpty();
  cachedImages = { idle: empty, frames: [empty] };
  return cachedImages;
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
}

function startAnimation() {
  if (animationTimer) return;

  const { frames } = getImages();
  animationFrame = 0;
  setTrayImage(frames[0]);

  animationTimer = setInterval(() => {
    if (!tray || !getState().isRecording) return;
    animationFrame = (animationFrame + 1) % frames.length;
    setTrayImage(frames[animationFrame]);
  }, ANIMATION_INTERVAL_MS);
}

function update() {
  if (!tray) return;

  const { idle } = getImages();
  const { mainWindow, rendererReady, isRecording } = getState();

  const canControl = Boolean(mainWindow && !mainWindow.isDestroyed() && rendererReady);
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());

  if (isRecording) {
    startAnimation();
  } else {
    stopAnimation();
    setTrayImage(idle);
  }

  tray.setToolTip(isRecording ? 'LocalWhisper (gravant)' : 'LocalWhisper');
  if (process.platform === 'darwin') tray.setTitle('');

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: isRecording ? 'Aturar i transcriure' : 'Iniciar gravacio',
        enabled: canControl,
        click: () => onCommand(isRecording ? 'stop' : 'start')
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
