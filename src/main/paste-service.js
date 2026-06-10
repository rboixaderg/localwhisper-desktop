const { clipboard } = require('electron');
const { spawn } = require('node:child_process');

function runAppleScript(script) {
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/bin/osascript', ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', reject);

    proc.on('close', (code) => {
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

  clipboard.writeText(trimmed);

  const script =
    'tell application "System Events" to keystroke "v" using command down';

  await runAppleScript(script);

  return { success: true };
}

module.exports = { pasteTextToActiveApp };
