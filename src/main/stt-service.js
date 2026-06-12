const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MAX_AUDIO_BASE64_LENGTH = 25 * 1024 * 1024;

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseExtraArgs(raw) {
  if (!raw || typeof raw !== 'string') return [];

  const args = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
        quoteChar = '';
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function truncateStderr(stderr, maxLen = 700) {
  const text = (stderr || '').trim();
  if (!text) return '(empty)';
  return text.length <= maxLen ? text : `${text.slice(0, maxLen)}...`;
}

function isGpuCrash(error) {
  return /exit 139|signal SIGSEGV/i.test(error?.message || '');
}

function runWhisper(binPath, args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd });

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
        const info = `exit ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''}`;
        const hint =
          code === 139 || signal === 'SIGSEGV'
            ? ' Hint: add "-ng" to Args extra to disable GPU on macOS.'
            : '';
        reject(new Error(`whisper.cpp failed (${info}). stderr: ${truncateStderr(stderr)}${hint}`));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function findOutputTextInDir(dir) {
  const files = await fs.readdir(dir);

  for (const file of files) {
    if (!file.endsWith('.txt')) continue;
    const content = await fs.readFile(path.join(dir, file), 'utf8');
    const trimmed = content.trim();
    if (trimmed) return trimmed;
  }

  return null;
}

async function transcribeAudio({ audioBase64, config }) {
  const { whisperBinPath, modelPath, language, extraArgs } = config;

  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new Error('No audio data provided.');
  }

  if (audioBase64.length > MAX_AUDIO_BASE64_LENGTH) {
    throw new Error('Audio data too large. Maximum recording duration is 5 minutes.');
  }

  if (!whisperBinPath || !(await fileExists(whisperBinPath))) {
    throw new Error('Whisper binary path is invalid.');
  }

  if (!modelPath || !(await fileExists(modelPath))) {
    throw new Error('Whisper model path is invalid.');
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'localwhisper-'));
  const audioPath = path.join(tmpDir, 'input.wav');

  try {
    await fs.writeFile(audioPath, Buffer.from(audioBase64, 'base64'));

    const parsedExtra = parseExtraArgs(extraArgs);
    const usesOutputFile = parsedExtra.some((a) => /^-o(txt|srt|vtt|csv|json)$/.test(a));

    const args = ['-m', modelPath, '-f', audioPath, '-np', '-nt', ...parsedExtra];
    if (language && language !== 'auto') args.push('-l', language);

    let result;
    try {
      result = await runWhisper(whisperBinPath, args, tmpDir);
    } catch (error) {
      if (process.platform === 'darwin' && !args.includes('-ng') && isGpuCrash(error)) {
        result = await runWhisper(whisperBinPath, [...args, '-ng'], tmpDir);
      } else {
        throw error;
      }
    }

    const stdoutText = (result.stdout || '').trim();

    // When an output flag like -otxt is used, whisper writes to a sidecar file.
    // stdout may contain non-text artifacts (e.g. "#"), so prefer the sidecar.
    if (usesOutputFile) {
      const sidecarText = await findOutputTextInDir(tmpDir);
      if (sidecarText) return sidecarText;
    }

    if (stdoutText) return stdoutText;

    // Fallback: check for sidecar files even without explicit output flag
    const sidecarText = await findOutputTextInDir(tmpDir);
    if (sidecarText) return sidecarText;

    const stderrText = (result.stderr || '').trim();

    if (/unknown language/i.test(stderrText)) {
      throw new Error(
        'Invalid language code. Use "auto" or a 2/3-letter code like "ca", "es" or "en".'
      );
    }

    if (stderrText) {
      throw new Error(`Whisper returned no text. stderr: ${truncateStderr(stderrText)}`);
    }

    throw new Error(
      'Whisper returned no text. Try speaking longer, or add "-ng" to Args extra on macOS.'
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

module.exports = { transcribeAudio, parseExtraArgs, truncateStderr, isGpuCrash };
