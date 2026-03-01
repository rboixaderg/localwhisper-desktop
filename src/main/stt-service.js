const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseExtraArgs(raw) {
  if (!raw || typeof raw !== 'string') {
    return [];
  }

  return raw
    .split(' ')
    .map((part) => part.trim())
    .filter(Boolean);
}

function runCommand(binPath, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    proc.on('error', reject);

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `whisper.cpp exit code ${code}. stderr: ${stderr || '(empty)'}`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function transcribeAudio({ audioBase64, config }) {
  const { whisperBinPath, modelPath, language, extraArgs } = config;

  if (!whisperBinPath || !(await fileExists(whisperBinPath))) {
    throw new Error('Whisper binary path is invalid.');
  }

  if (!modelPath || !(await fileExists(modelPath))) {
    throw new Error('Whisper model path is invalid.');
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localwhisper-'));
  const audioPath = path.join(tmpDir, 'input.wav');

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    await fs.writeFile(audioPath, audioBuffer);

    const args = [
      '-m',
      modelPath,
      '-f',
      audioPath,
      '-np',
      '-nt',
      ...parseExtraArgs(extraArgs)
    ];

    if (language && language !== 'auto') {
      args.push('-l', language);
    }

    const { stdout } = await runCommand(whisperBinPath, args);
    return (stdout || '').trim();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  transcribeAudio
};
