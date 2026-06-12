const { clipboard } = require('electron');
const { spawn } = require('node:child_process');

const PASTE_TIMEOUT_MS = 15000;

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/osascript', ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Paste timed out. Check Accessibility permissions.'));
    }, PASTE_TIMEOUT_MS);

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        const trimmed = (stderr || '').trim();
        const msg = trimmed
          ? `osascript failed (exit ${code}): ${trimmed}`
          : `osascript failed (exit ${code}).`;
        reject(new Error(msg));
        return;
      }

      resolve();
    });
  });
}

async function pasteTextToActiveApp(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('No text to paste.');
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('No text to paste.');
  }

  if (process.platform !== 'darwin') {
    throw new Error('Automatic paste is only supported on macOS. The transcribed text is in the clipboard for manual paste.');
  }

  clipboard.writeText(trimmed);

  const script =
    'tell application "System Events" to keystroke "v" using command down';

  await runAppleScript(script);

  return { success: true };
}

module.exports = { pasteTextToActiveApp };
