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

function compactStderr(stderr) {
  const clean = (stderr || '').trim();
  if (!clean) {
    return '(empty)';
  }

  if (clean.length <= 700) {
    return clean;
  }

  return `${clean.slice(0, 700)}...`;
}

function isGpuCrashError(error) {
  const message = error?.message || '';
  return /exit 139|signal SIGSEGV/i.test(message);
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

    proc.on('close', (code, signal) => {
      if (code !== 0 || signal) {
        const codeText = typeof code === 'number' ? String(code) : 'unknown';
        const signalText = signal ? `, signal ${signal}` : '';
        const hint =
          code === 139 || signal === 'SIGSEGV'
            ? ' Hint: on some macOS setups, add "-ng" in Args extra to disable GPU.'
            : '';

        reject(
          new Error(
            `whisper.cpp failed (exit ${codeText}${signalText}). stderr: ${compactStderr(stderr)}${hint}`
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

    let commandResult;
    try {
      commandResult = await runCommand(whisperBinPath, args);
    } catch (error) {
      // On some Apple Silicon systems whisper-cli can crash on GPU path; retry once with -ng.
      if (process.platform === 'darwin' && !args.includes('-ng') && isGpuCrashError(error)) {
        commandResult = await runCommand(whisperBinPath, [...args, '-ng']);
      } else {
        throw error;
      }
    }

    const { stdout, stderr } = commandResult;
    let text = (stdout || '').trim();

    // Some whisper.cpp builds write text output to a sidecar file when -otxt is used.
    if (!text) {
      const outputTextPath = `${audioPath}.txt`;
      if (await fileExists(outputTextPath)) {
        const fileText = await fs.readFile(outputTextPath, 'utf8');
        text = fileText.trim();
      }
    }

    if (!text) {
      const stderrText = (stderr || '').trim();

      if (/unknown language/i.test(stderrText)) {
        throw new Error(
          'Invalid language code. Use "auto" or a 2/3-letter code like "ca", "es" or "en".'
        );
      }

      if (stderrText) {
        throw new Error(`Whisper returned no text. stderr: ${compactStderr(stderrText)}`);
      }

      throw new Error(
        'Whisper returned no text. Try speaking longer, or add "-ng" to Args extra on macOS.'
      );
    }

    return text;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

module.exports = {
  transcribeAudio
};
