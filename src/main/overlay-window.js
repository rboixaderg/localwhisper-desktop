const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

const OVERLAY_SIZE = 200;
const POSITION_INTERVAL_MS = 500;

let overlayWin = null;
let positionTimer = null;

function getCenterPosition() {
  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width: screenW, height: screenH } = currentDisplay.workArea;
  return {
    x: Math.round(x + (screenW - OVERLAY_SIZE) / 2),
    y: Math.round(y + (screenH - OVERLAY_SIZE) / 2)
  };
}

function updatePosition() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const pos = getCenterPosition();
  overlayWin.setPosition(pos.x, pos.y);
}

function startPositionTracking() {
  if (positionTimer) return;
  updatePosition();
  positionTimer = setInterval(updatePosition, POSITION_INTERVAL_MS);
}

function stopPositionTracking() {
  if (!positionTimer) return;
  clearInterval(positionTimer);
  positionTimer = null;
}

function create() {
  if (overlayWin && !overlayWin.isDestroyed()) return;

  const pos = getCenterPosition();

  overlayWin = new BrowserWindow({
    width: OVERLAY_SIZE,
    height: OVERLAY_SIZE,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    type: 'overlay',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload-overlay.js')
    }
  });

  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true);

  overlayWin.loadFile(path.join(__dirname, '../renderer/overlay.html'));
}

function showPhase(phase) {
  if (!overlayWin || overlayWin.isDestroyed()) create();

  updatePosition();

  if (!overlayWin.isVisible()) {
    overlayWin.showInactive();
  }

  overlayWin.webContents.send('overlay:phase', { phase });
  startPositionTracking();
}

function hide() {
  stopPositionTracking();
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.hide();
  }
}

function destroy() {
  stopPositionTracking();
  if (overlayWin) {
    if (!overlayWin.isDestroyed()) overlayWin.destroy();
    overlayWin = null;
  }
}

module.exports = { create, showPhase, hide, destroy };
