const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const Module = require('node:module');

// Provide a minimal `electron` mock so config-store can be required in Node.
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => os.tmpdir() } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const sttService = require('../src/main/stt-service.js');
const configStore = require('../src/main/config-store.js');
const audioUtils = require('../src/shared/audio-utils.js');

const { parseExtraArgs, truncateStderr, isGpuCrash, transcribeAudio } = sttService;
const { normalizeLanguage, sanitizeConfig, DEFAULT_CONFIG, loadConfig, saveConfig } = configStore;
const { mergeFloat32, downsampleBuffer, encodeWavFromFloat32, arrayBufferToBase64 } = audioUtils;

describe('parseExtraArgs', () => {
  it('splits on whitespace', () => {
    assert.deepStrictEqual(parseExtraArgs('-ng -otxt'), ['-ng', '-otxt']);
  });

  it('handles empty input', () => {
    assert.deepStrictEqual(parseExtraArgs(''), []);
    assert.deepStrictEqual(parseExtraArgs(null), []);
    assert.deepStrictEqual(parseExtraArgs(undefined), []);
  });

  it('handles double-quoted values', () => {
    assert.deepStrictEqual(parseExtraArgs('--prompt "hello world"'), ['--prompt', 'hello world']);
  });

  it('handles single-quoted values', () => {
    assert.deepStrictEqual(parseExtraArgs("--prompt 'hello world'"), ['--prompt', 'hello world']);
  });

  it('handles mixed quoted and unquoted', () => {
    assert.deepStrictEqual(
      parseExtraArgs('-ng --prompt "hello world" --max-tokens 100'),
      ['-ng', '--prompt', 'hello world', '--max-tokens', '100']
    );
  });

  it('handles multiple spaces and tabs', () => {
    assert.deepStrictEqual(parseExtraArgs('-ng \t -otxt'), ['-ng', '-otxt']);
  });

  it('recovers content from an unterminated quote', () => {
    assert.deepStrictEqual(parseExtraArgs('--prompt "hi'), ['--prompt', 'hi']);
  });

  it('drops empty quoted arguments', () => {
    // Documented behaviour: an explicit empty value is discarded rather than
    // passed through as an empty string.
    assert.deepStrictEqual(parseExtraArgs('--prompt ""'), ['--prompt']);
  });

  it('concatenates adjacent quoted and unquoted segments', () => {
    assert.deepStrictEqual(parseExtraArgs('a"b"c'), ['abc']);
  });

  it('returns empty array for whitespace-only input', () => {
    assert.deepStrictEqual(parseExtraArgs('   \t  '), []);
  });
});

describe('normalizeLanguage', () => {
  it('returns auto for empty', () => {
    assert.strictEqual(normalizeLanguage(''), 'auto');
    assert.strictEqual(normalizeLanguage('auto'), 'auto');
    assert.strictEqual(normalizeLanguage(null), 'auto');
  });

  it('returns valid codes', () => {
    assert.strictEqual(normalizeLanguage('en'), 'en');
    assert.strictEqual(normalizeLanguage('ca'), 'ca');
    assert.strictEqual(normalizeLanguage('es'), 'es');
    assert.strictEqual(normalizeLanguage('yue'), 'yue'); // 3-letter code
    assert.strictEqual(normalizeLanguage('  EN  '), 'en');
  });

  it('rejects invalid codes in strict mode', () => {
    assert.throws(() => normalizeLanguage('english', true), /Invalid language code/);
    assert.throws(() => normalizeLanguage('123', true), /Invalid language code/);
    assert.strictEqual(normalizeLanguage('english', false), 'auto');
  });
});

describe('sanitizeConfig', () => {
  it('fills defaults for empty input', () => {
    assert.deepStrictEqual(sanitizeConfig({}), DEFAULT_CONFIG);
  });

  it('trims string fields', () => {
    const result = sanitizeConfig({ whisperBinPath: '  /bin/whisper  ', modelPath: ' /m.bin ' });
    assert.strictEqual(result.whisperBinPath, '/bin/whisper');
    assert.strictEqual(result.modelPath, '/m.bin');
  });

  it('caps overly long path values', () => {
    const longPath = '/'.repeat(5000);
    const result = sanitizeConfig({ whisperBinPath: longPath });
    assert.strictEqual(result.whisperBinPath.length, 4096);
  });

  it('caps overly long extra args', () => {
    const result = sanitizeConfig({ extraArgs: 'x'.repeat(5000) });
    assert.strictEqual(result.extraArgs.length, 2048);
  });

  it('caps overly long shortcut', () => {
    const result = sanitizeConfig({ shortcut: 'a'.repeat(500) });
    assert.strictEqual(result.shortcut.length, 100);
  });

  it('ignores non-string fields', () => {
    const result = sanitizeConfig({ whisperBinPath: 123, modelPath: {}, extraArgs: [] });
    assert.strictEqual(result.whisperBinPath, '');
    assert.strictEqual(result.modelPath, '');
    assert.strictEqual(result.extraArgs, '');
  });
});

describe('stt-service error helpers', () => {
  it('isGpuCrash detects exit 139', () => {
    assert.ok(isGpuCrash(new Error('exit 139')));
    assert.ok(isGpuCrash(new Error('signal SIGSEGV')));
    assert.ok(!isGpuCrash(new Error('exit 1')));
    assert.ok(!isGpuCrash(null));
  });

  it('truncateStderr truncates long output', () => {
    assert.strictEqual(truncateStderr(''), '(empty)');
    assert.strictEqual(truncateStderr(null), '(empty)');
    assert.strictEqual(truncateStderr('short'), 'short');
    const long = 'x'.repeat(800);
    const result = truncateStderr(long);
    assert.ok(result.endsWith('...'));
    assert.strictEqual(result.length, 703);
  });
});

describe('WAV encoding', () => {
  it('produces correct RIFF header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = encodeWavFromFloat32(samples, 16000);
    const view = new DataView(buf);

    const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    assert.strictEqual(riff, 'RIFF');

    const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
    assert.strictEqual(wave, 'WAVE');

    const fmt = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
    assert.strictEqual(fmt, 'fmt ');
  });

  it('has correct file size', () => {
    const samples = new Float32Array(100);
    const buf = encodeWavFromFloat32(samples, 16000);
    assert.strictEqual(buf.byteLength, 44 + 100 * 2);
  });

  it('has correct sample rate in header', () => {
    const samples = new Float32Array(50);
    const buf = encodeWavFromFloat32(samples, 44100);
    const view = new DataView(buf);
    assert.strictEqual(view.getUint32(24, true), 44100);
  });

  it('clamps samples to [-1, 1]', () => {
    const samples = new Float32Array([2.0, -3.0, 0.5]);
    const buf = encodeWavFromFloat32(samples, 16000);
    const view = new DataView(buf);
    assert.strictEqual(view.getInt16(44, true), 32767);
    assert.strictEqual(view.getInt16(46, true), -32768);
  });

  it('handles empty samples', () => {
    const buf = encodeWavFromFloat32(new Float32Array(0), 16000);
    assert.strictEqual(buf.byteLength, 44);
  });
});

describe('audio-utils downsample', () => {
  it('downsamples 48k to 16k', () => {
    const input = new Float32Array(48000).fill(0.5);
    const result = downsampleBuffer(input, 48000, 16000);
    assert.strictEqual(result.length, 16000);
    assert.ok(Math.abs(result[0] - 0.5) < 0.01);
  });

  it('returns input if outputRate >= inputRate', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    const result = downsampleBuffer(input, 16000, 48000);
    assert.strictEqual(result, input);
  });
});

describe('mergeFloat32', () => {
  it('merges multiple chunks into one buffer', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4, 5]);
    const result = mergeFloat32([a, b], 5);
    assert.deepStrictEqual(Array.from(result), [1, 2, 3, 4, 5]);
  });

  it('handles single chunk', () => {
    const a = new Float32Array([1, 2, 3]);
    const result = mergeFloat32([a], 3);
    assert.deepStrictEqual(Array.from(result), [1, 2, 3]);
  });
});

describe('arrayBufferToBase64', () => {
  it('encodes bytes to base64', () => {
    const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    assert.strictEqual(arrayBufferToBase64(bytes.buffer), 'aGVsbG8=');
  });

  it('encodes an empty buffer', () => {
    assert.strictEqual(arrayBufferToBase64(new ArrayBuffer(0)), '');
  });

  it('round-trips arbitrary byte values', () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    const decoded = Buffer.from(arrayBufferToBase64(bytes.buffer), 'base64');
    assert.deepStrictEqual(Array.from(decoded), Array.from(bytes));
  });

  it('handles buffers larger than the 0x8000 chunk size', () => {
    const bytes = new Uint8Array(0x8000 + 10).fill(65); // "A" repeated
    const decoded = Buffer.from(arrayBufferToBase64(bytes.buffer), 'base64');
    assert.strictEqual(decoded.length, bytes.length);
    assert.ok(decoded.every((b) => b === 65));
  });
});

describe('transcribeAudio validation', () => {
  const validAudio = Buffer.from('fake audio').toString('base64');

  it('rejects missing audio data', async () => {
    await assert.rejects(
      () => transcribeAudio({ audioBase64: '', config: {} }),
      /No audio data provided/
    );
    await assert.rejects(
      () => transcribeAudio({ audioBase64: null, config: {} }),
      /No audio data provided/
    );
  });

  it('rejects audio data above the size limit', async () => {
    const tooBig = 'A'.repeat(25 * 1024 * 1024 + 1);
    await assert.rejects(
      () => transcribeAudio({ audioBase64: tooBig, config: {} }),
      /Audio data too large/
    );
  });

  it('rejects an invalid whisper binary path', async () => {
    await assert.rejects(
      () =>
        transcribeAudio({
          audioBase64: validAudio,
          config: { whisperBinPath: '/no/such/whisper', modelPath: process.execPath }
        }),
      /Whisper binary path is invalid/
    );
  });

  it('rejects an invalid model path', async () => {
    // Use a real existing file as the binary so validation reaches the model check.
    await assert.rejects(
      () =>
        transcribeAudio({
          audioBase64: validAudio,
          config: { whisperBinPath: process.execPath, modelPath: '/no/such/model.bin' }
        }),
      /Whisper model path is invalid/
    );
  });
});

describe('loadConfig / saveConfig', () => {
  it('round-trips a saved config (regression: getConfigPath must exist)', async () => {
    const saved = await saveConfig({
      whisperBinPath: '/bin/whisper',
      modelPath: '/m.bin',
      language: 'ca',
      extraArgs: '-ng',
      shortcut: 'CommandOrControl+Shift+X'
    });
    const loaded = await loadConfig();
    assert.deepStrictEqual(loaded, saved);
  });

  it('falls back to defaults when no config file is readable', async () => {
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const os = require('node:os');
    await fs.rm(path.join(os.tmpdir(), 'config.json'), { force: true });
    const loaded = await loadConfig();
    assert.deepStrictEqual(loaded, DEFAULT_CONFIG);
  });

  it('saveConfig rejects an invalid language (strict mode)', async () => {
    await assert.rejects(
      () => saveConfig({ language: 'english' }),
      /Invalid language code/
    );
  });
});
