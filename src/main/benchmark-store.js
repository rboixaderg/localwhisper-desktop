const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Local storage for saved dictations ("benchmarks").
 *
 * Layout under `rootDir`:
 *   <dictationId>/audio.wav        original recording
 *   <dictationId>/dictation.json   metadata, reference text and every run
 *
 * Runs are append-only: nothing here rewrites or removes an earlier run.
 * This module has no network code and does not depend on Electron.
 */

const SCHEMA_VERSION = 1;
const AUDIO_FILE = 'audio.wav';
const META_FILE = 'dictation.json';
const ID_PATTERN = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{8}$/;
const RUN_ID_PATTERN = /^[0-9a-f]{8}$/;
const RUN_KINDS = ['initial', 'reprocess', 'retranscribe'];
const SOURCES = ['manual', 'shortcut', 'tray', 'unknown'];
const MAX_REFERENCE_LENGTH = 200000;
const SECRET_FLAG_PATTERN = /key|token|secret|pass(word|wd)?|auth|credential/i;

function assertId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error('Invalid dictation id.');
  }
  return id;
}

function newDictationId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return `${stamp}-${crypto.randomBytes(4).toString('hex')}`;
}

/** Duration of a PCM WAV buffer in ms, or null when the header is unusable. */
function wavDurationMs(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ' && offset + 20 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16);
    } else if (chunkId === 'data') {
      if (!byteRate) return null;
      const available = buffer.length - (offset + 8);
      return Math.round((Math.min(chunkSize, available) / byteRate) * 1000);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  return null;
}

function redactExtraArgs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const tokens = raw.trim().split(/\s+/);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const eq = token.indexOf('=');
    if (token.startsWith('-') && eq > 0 && SECRET_FLAG_PATTERN.test(token.slice(0, eq))) {
      out.push(`${token.slice(0, eq)}=[redacted]`);
    } else if (token.startsWith('-') && SECRET_FLAG_PATTERN.test(token) && eq < 0) {
      out.push(token);
      if (i + 1 < tokens.length && !tokens[i + 1].startsWith('-')) {
        out.push('[redacted]');
        i += 1;
      }
    } else {
      out.push(token);
    }
  }
  return out.join(' ');
}

/**
 * Non-secret summary of the configuration used by a run. Paths are reduced
 * to file names so the record does not leak the user's directory layout.
 */
function summarizeConfig(config) {
  const c = config && typeof config === 'object' ? config : {};
  const base = (value) => (typeof value === 'string' && value ? path.basename(value) : '');
  return {
    whisper: {
      binary: base(c.whisperBinPath),
      model: base(c.modelPath),
      language: typeof c.language === 'string' ? c.language : 'auto',
      extraArgs: redactExtraArgs(c.extraArgs),
      glossaryPrompt: typeof c.glossaryPrompt === 'string' ? c.glossaryPrompt : ''
    },
    postprocess: {
      substitutions: typeof c.substitutions === 'string' ? c.substitutions : ''
    }
  };
}

async function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

/**
 * Folder that holds saved dictations: `<LOCALWHISPER_DATA_DIR>/benchmarks`
 * when that variable is an absolute path, otherwise `<userData>/benchmarks`.
 * A relative value is rejected instead of being resolved against an
 * unpredictable working directory.
 */
function resolveBenchmarksDir({ userDataDir, env = process.env }) {
  const override = typeof env.LOCALWHISPER_DATA_DIR === 'string' ? env.LOCALWHISPER_DATA_DIR.trim() : '';
  if (override) {
    if (!path.isAbsolute(override)) {
      throw new Error('LOCALWHISPER_DATA_DIR must be an absolute path.');
    }
    return path.join(override, 'benchmarks');
  }
  return path.join(userDataDir, 'benchmarks');
}

function createBenchmarkStore({ rootDir, appVersion = '' }) {
  if (!rootDir || typeof rootDir !== 'string') {
    throw new Error('rootDir is required.');
  }

  const locks = new Map();

  // Serializes read-modify-write cycles per dictation so concurrent runs
  // are all appended instead of overwriting each other.
  function withLock(id, task) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(task);
    locks.set(id, next);
    const cleanup = () => {
      if (locks.get(id) === next) locks.delete(id);
    };
    next.then(cleanup, cleanup);
    return next;
  }

  const dirOf = (id) => path.join(rootDir, assertId(id));
  const metaPathOf = (id) => path.join(dirOf(id), META_FILE);

  async function readMeta(id) {
    let raw;
    try {
      raw = await fs.readFile(metaPathOf(id), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Saved dictation not found.');
      throw error;
    }
    return JSON.parse(raw);
  }

  function normalizeRun(run, now) {
    const kind = RUN_KINDS.includes(run && run.kind) ? run.kind : 'initial';
    const entry = {
      id: crypto.randomBytes(4).toString('hex'),
      createdAt: now.toISOString(),
      kind,
      basedOnRunId: RUN_ID_PATTERN.test(run.basedOnRunId || '') ? run.basedOnRunId : null,
      rawText: typeof run.rawText === 'string' ? run.rawText : null,
      text: typeof run.text === 'string' ? run.text : null,
      error: run.error ? String(run.error) : null,
      appVersion,
      elapsedMs: Number.isFinite(run.elapsedMs) ? Math.round(run.elapsedMs) : null,
      settings: run.settings && typeof run.settings === 'object' ? run.settings : summarizeConfig({})
    };
    return entry;
  }

  async function createDictation({ audio, language = 'auto', source = 'unknown', now = new Date() }) {
    if (!Buffer.isBuffer(audio) || audio.length === 0) {
      throw new Error('No audio to save.');
    }

    const id = newDictationId(now);
    const dir = dirOf(id);
    const meta = {
      schemaVersion: SCHEMA_VERSION,
      id,
      createdAt: now.toISOString(),
      appVersion,
      durationMs: wavDurationMs(audio),
      language: typeof language === 'string' ? language : 'auto',
      source: SOURCES.includes(source) ? source : 'unknown',
      audioFile: AUDIO_FILE,
      audioBytes: audio.length,
      reference: null,
      runs: []
    };

    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(path.join(dir, AUDIO_FILE), audio);
      await writeJsonAtomic(path.join(dir, META_FILE), meta);
    } catch (error) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return meta;
  }

  async function addRun(id, run, now = new Date()) {
    assertId(id);
    return withLock(id, async () => {
      const meta = await readMeta(id);
      const entry = normalizeRun(run || {}, now);
      meta.runs.push(entry);
      await writeJsonAtomic(metaPathOf(id), meta);
      return entry;
    });
  }

  async function setReference(id, text, now = new Date()) {
    assertId(id);
    if (text !== null && typeof text !== 'string') throw new Error('Invalid reference text.');
    if (typeof text === 'string' && text.length > MAX_REFERENCE_LENGTH) {
      throw new Error('Reference text is too long.');
    }
    return withLock(id, async () => {
      const meta = await readMeta(id);
      const trimmed = typeof text === 'string' ? text.trim() : '';
      meta.reference = trimmed ? { text: trimmed, updatedAt: now.toISOString() } : null;
      await writeJsonAtomic(metaPathOf(id), meta);
      return meta;
    });
  }

  async function getDictation(id) {
    assertId(id);
    return readMeta(id);
  }

  async function getAudio(id) {
    assertId(id);
    try {
      return await fs.readFile(path.join(dirOf(id), AUDIO_FILE));
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Saved audio not found.');
      throw error;
    }
  }

  async function list() {
    let entries;
    try {
      entries = await fs.readdir(rootDir);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }

    const items = [];
    for (const name of entries) {
      if (!ID_PATTERN.test(name)) continue;
      try {
        const meta = await readMeta(name);
        const lastWithText = [...meta.runs].reverse().find((r) => typeof r.text === 'string');
        items.push({
          id: meta.id,
          createdAt: meta.createdAt,
          durationMs: meta.durationMs,
          language: meta.language,
          source: meta.source,
          runCount: meta.runs.length,
          hasReference: Boolean(meta.reference),
          preview: lastWithText ? lastWithText.text.slice(0, 160) : ''
        });
      } catch {
        // Skip unreadable entries; they still count in usage() and can be removed.
      }
    }
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  async function remove(id) {
    assertId(id);
    return withLock(id, async () => {
      await fs.rm(dirOf(id), { recursive: true, force: true });
      return true;
    });
  }

  async function removeAll() {
    let entries;
    try {
      entries = await fs.readdir(rootDir);
    } catch (error) {
      if (error.code === 'ENOENT') return 0;
      throw error;
    }
    let removed = 0;
    for (const name of entries) {
      if (!ID_PATTERN.test(name)) continue;
      await remove(name);
      removed += 1;
    }
    return removed;
  }

  async function usage() {
    let entries;
    try {
      entries = await fs.readdir(rootDir);
    } catch (error) {
      if (error.code === 'ENOENT') return { count: 0, bytes: 0 };
      throw error;
    }

    let count = 0;
    let bytes = 0;
    for (const name of entries) {
      if (!ID_PATTERN.test(name)) continue;
      count += 1;
      const dir = path.join(rootDir, name);
      let files = [];
      try {
        files = await fs.readdir(dir);
      } catch {}
      for (const file of files) {
        try {
          bytes += (await fs.stat(path.join(dir, file))).size;
        } catch {}
      }
    }
    return { count, bytes };
  }

  return {
    rootDir,
    createDictation,
    addRun,
    setReference,
    getDictation,
    getAudio,
    list,
    remove,
    removeAll,
    usage
  };
}

module.exports = {
  createBenchmarkStore,
  resolveBenchmarksDir,
  summarizeConfig,
  redactExtraArgs,
  wavDurationMs,
  newDictationId,
  ID_PATTERN,
  RUN_ID_PATTERN,
  SCHEMA_VERSION
};
