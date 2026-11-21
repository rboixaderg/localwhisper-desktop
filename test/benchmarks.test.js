const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => os.tmpdir() } };
  return originalLoad.call(this, request, parent, isMain);
};

const { createBenchmarkStore, resolveBenchmarksDir, summarizeConfig, redactExtraArgs, wavDurationMs } = require('../src/main/benchmark-store');
const { createBenchmarkService } = require('../src/main/benchmark-service');
const { applyPostProcessing } = require('../src/main/stt-service');
const { sanitizeConfig, DEFAULT_CONFIG } = require('../src/main/config-store');
const { encodeWavFromFloat32 } = require('../src/shared/audio-utils');

function wavBuffer(seconds = 1) {
  return Buffer.from(encodeWavFromFloat32(new Float32Array(16000 * seconds), 16000));
}

const baseConfig = {
  whisperBinPath: '/Users/me/whisper.cpp/build/bin/whisper-cli',
  modelPath: '/Users/me/models/ggml-large-v3.bin',
  language: 'ca',
  extraArgs: '-ng',
  glossaryPrompt: 'deploy, backend',
  substitutions: 'bac em => backend',
  saveBenchmarks: true
};

function fakeStt(overrides = {}) {
  const calls = { transcribeRaw: 0 };
  return {
    calls,
    transcribeRaw: async () => {
      calls.transcribeRaw += 1;
      if (overrides.fail) throw new Error(overrides.fail);
      return overrides.raw || 'el deploy del bac em';
    },
    applyPostProcessing: overrides.applyPostProcessing || applyPostProcessing
  };
}

let dir;
let store;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lw-bench-'));
  store = createBenchmarkStore({ rootDir: path.join(dir, 'benchmarks'), appVersion: '9.9.9' });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('saveBenchmarks config', () => {
  it('is off by default and only an explicit true enables it', () => {
    assert.equal(DEFAULT_CONFIG.saveBenchmarks, false);
    assert.equal(sanitizeConfig({}).saveBenchmarks, false);
    assert.equal(sanitizeConfig({ saveBenchmarks: 'true' }).saveBenchmarks, false);
    assert.equal(sanitizeConfig({ saveBenchmarks: true }).saveBenchmarks, true);
  });
});

describe('benchmark store', () => {
  it('persists audio, metadata and runs across store instances', async () => {
    const audio = wavBuffer(2);
    const meta = await store.createDictation({ audio, language: 'ca', source: 'shortcut' });
    await store.addRun(meta.id, { kind: 'initial', rawText: 'raw', text: 'final', settings: summarizeConfig(baseConfig) });

    const reopened = createBenchmarkStore({ rootDir: store.rootDir, appVersion: '9.9.9' });
    const loaded = await reopened.getDictation(meta.id);
    assert.equal(loaded.language, 'ca');
    assert.equal(loaded.source, 'shortcut');
    assert.equal(loaded.durationMs, 2000);
    assert.equal(loaded.runs.length, 1);
    assert.equal(loaded.runs[0].rawText, 'raw');
    assert.equal(loaded.runs[0].text, 'final');
    assert.equal(loaded.runs[0].appVersion, '9.9.9');
    assert.deepEqual(await reopened.getAudio(meta.id), audio);
    assert.equal((await reopened.list()).length, 1);
  });

  it('appends runs without touching earlier ones, even concurrently', async () => {
    const { id } = await store.createDictation({ audio: wavBuffer() });
    await Promise.all(
      ['a', 'b', 'c', 'd', 'e'].map((t) => store.addRun(id, { kind: 'reprocess', rawText: t, text: t }))
    );
    const loaded = await store.getDictation(id);
    assert.deepEqual(loaded.runs.map((r) => r.rawText).sort(), ['a', 'b', 'c', 'd', 'e']);
    assert.equal(new Set(loaded.runs.map((r) => r.id)).size, 5);
  });

  it('stores and clears the reference transcript', async () => {
    const { id } = await store.createDictation({ audio: wavBuffer() });
    const withRef = await store.setReference(id, '  Correct text  ');
    assert.equal(withRef.reference.text, 'Correct text');
    assert.equal((await store.list())[0].hasReference, true);
    const cleared = await store.setReference(id, '');
    assert.equal(cleared.reference, null);
  });

  it('deletes one dictation with all its files, and all dictations on request', async () => {
    const a = await store.createDictation({ audio: wavBuffer() });
    const b = await store.createDictation({ audio: wavBuffer() });
    await store.remove(a.id);
    assert.equal(fsSync.existsSync(path.join(store.rootDir, a.id)), false);
    assert.equal((await store.list()).length, 1);
    assert.equal(await store.removeAll(), 1);
    assert.equal(fsSync.existsSync(path.join(store.rootDir, b.id)), false);
    assert.deepEqual(await store.usage(), { count: 0, bytes: 0 });
  });

  it('reports disk usage', async () => {
    assert.deepEqual(await store.usage(), { count: 0, bytes: 0 });
    const audio = wavBuffer();
    await store.createDictation({ audio });
    const usage = await store.usage();
    assert.equal(usage.count, 1);
    assert.ok(usage.bytes > audio.length);
  });

  it('rejects ids that could escape the storage folder', async () => {
    for (const id of ['../x', '..', 'a/b', '', null, '20260101T000000Z-zzzzzzzz']) {
      await assert.rejects(() => store.getDictation(id), /Invalid dictation id/);
      await assert.rejects(() => store.remove(id), /Invalid dictation id/);
    }
  });

  it('reports a missing dictation', async () => {
    await assert.rejects(() => store.getDictation('20260101T000000Z-00000000'), /not found/);
  });

  it('lists newest first', async () => {
    const old = await store.createDictation({ audio: wavBuffer(), now: new Date('2026-01-01T00:00:00Z') });
    const recent = await store.createDictation({ audio: wavBuffer(), now: new Date('2026-02-01T00:00:00Z') });
    assert.deepEqual((await store.list()).map((i) => i.id), [recent.id, old.id]);
  });

  it('parses WAV durations and tolerates garbage', () => {
    assert.equal(wavDurationMs(wavBuffer(3)), 3000);
    assert.equal(wavDurationMs(Buffer.from('nope')), null);
  });
});

describe('resolveBenchmarksDir', () => {
  it('defaults to <userData>/benchmarks', () => {
    assert.equal(resolveBenchmarksDir({ userDataDir: '/ud', env: {} }), path.join('/ud', 'benchmarks'));
    assert.equal(resolveBenchmarksDir({ userDataDir: '/ud', env: { LOCALWHISPER_DATA_DIR: '  ' } }), path.join('/ud', 'benchmarks'));
  });

  it('uses LOCALWHISPER_DATA_DIR when it is an absolute path', () => {
    assert.equal(
      resolveBenchmarksDir({ userDataDir: '/ud', env: { LOCALWHISPER_DATA_DIR: '/data/lw' } }),
      path.join('/data/lw', 'benchmarks')
    );
  });

  it('rejects a relative LOCALWHISPER_DATA_DIR', () => {
    assert.throws(
      () => resolveBenchmarksDir({ userDataDir: '/ud', env: { LOCALWHISPER_DATA_DIR: 'relative/dir' } }),
      /absolute path/
    );
  });
});

describe('settings summary', () => {
  it('keeps file names only and no secret values', () => {
    const summary = summarizeConfig({ ...baseConfig, extraArgs: '-ng --api-key sk-123 --token=abc -t 4' });
    assert.equal(summary.whisper.model, 'ggml-large-v3.bin');
    assert.equal(summary.whisper.binary, 'whisper-cli');
    assert.equal(summary.postprocess.substitutions, 'bac em => backend');
    const json = JSON.stringify(summary);
    assert.ok(!json.includes('sk-123'));
    assert.ok(!json.includes('abc'));
    assert.ok(!json.includes('/Users/me'));
    assert.equal(summary.whisper.extraArgs, '-ng --api-key [redacted] --token=[redacted] -t 4');
  });

  it('redacts only values that follow secret-looking flags', () => {
    assert.equal(redactExtraArgs('-ng -t 4'), '-ng -t 4');
    assert.equal(redactExtraArgs(''), '');
    assert.equal(redactExtraArgs('--prompt "hello world" -t 4'), '--prompt "hello world" -t 4');
  });

  it('redacts quoted secret values and values starting with a dash', () => {
    assert.equal(redactExtraArgs('--api-key "my secret value" -t 4'), '--api-key [redacted] -t 4');
    assert.equal(redactExtraArgs("--token='a b c' -t 4"), '--token=[redacted] -t 4');
    assert.equal(redactExtraArgs('--api-key -secret123 -t 4'), '--api-key [redacted] -t 4');
  });
});

describe('benchmark service', () => {
  it('saves nothing when the option is off', async () => {
    const stt = fakeStt();
    const service = createBenchmarkService({ store, stt });
    const result = await service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'manual', config: { ...baseConfig, saveBenchmarks: false } });
    assert.equal(result.text, 'el deploy del backend');
    assert.equal(result.benchmarkId, null);
    assert.equal(fsSync.existsSync(store.rootDir), false);
  });

  it('keeps audio, raw text and final text when the option is on', async () => {
    const service = createBenchmarkService({ store, stt: fakeStt() });
    const result = await service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'shortcut', config: baseConfig });
    assert.equal(result.text, 'el deploy del backend');
    assert.equal(result.rawText, 'el deploy del bac em');

    const saved = await store.getDictation(result.benchmarkId);
    assert.equal(saved.source, 'shortcut');
    assert.equal(saved.runs[0].kind, 'initial');
    assert.equal(saved.runs[0].rawText, 'el deploy del bac em');
    assert.equal(saved.runs[0].text, 'el deploy del backend');
    assert.equal(saved.runs[0].settings.postprocess.substitutions, 'bac em => backend');
  });

  it('keeps the audio and shows the error when transcription fails', async () => {
    const service = createBenchmarkService({ store, stt: fakeStt({ fail: 'whisper exploded' }) });
    await assert.rejects(
      () => service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'manual', config: baseConfig }),
      /whisper exploded.*kept/
    );
    const [item] = await store.list();
    assert.ok(item);
    const saved = await store.getDictation(item.id);
    assert.match(saved.runs[0].error, /whisper exploded/);
    assert.ok((await store.getAudio(item.id)).length > 0);
  });

  it('still transcribes when saving fails', async () => {
    const brokenStore = { ...store, createDictation: async () => { throw new Error('disk full'); } };
    const service = createBenchmarkService({ store: brokenStore, stt: fakeStt() });
    const result = await service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'manual', config: baseConfig });
    assert.equal(result.text, 'el deploy del backend');
    assert.equal(result.benchmarkError, 'disk full');
  });

  it('reprocesses the saved raw text with the current rules and never runs Whisper', async () => {
    const stt = fakeStt();
    const service = createBenchmarkService({ store, stt });
    const { benchmarkId: id } = await service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'manual', config: baseConfig });
    assert.equal(stt.calls.transcribeRaw, 1);

    const run = await service.reprocess(id, undefined, { ...baseConfig, substitutions: 'deploy => despliegue\nbac em => back-end', modelPath: '/other/model.bin' });
    assert.equal(stt.calls.transcribeRaw, 1);
    assert.equal(run.kind, 'reprocess');
    assert.equal(run.rawText, 'el deploy del bac em');
    assert.equal(run.text, 'el despliegue del back-end');
    // Raw text still comes from the original model, not the current one.
    assert.equal(run.settings.whisper.model, 'ggml-large-v3.bin');
    assert.match(run.settings.postprocess.substitutions, /despliegue/);

    const saved = await store.getDictation(id);
    assert.equal(saved.runs.length, 2);
    assert.equal(saved.runs[0].text, 'el deploy del backend');
    assert.equal(run.basedOnRunId, saved.runs[0].id);
  });

  it('re-transcribes the saved audio as a new run and keeps earlier runs', async () => {
    const stt = fakeStt();
    const service = createBenchmarkService({ store, stt });
    const { benchmarkId: id } = await service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'manual', config: baseConfig });

    stt.transcribeRaw = async () => 'segona transcripció';
    const run = await service.retranscribe(id, { ...baseConfig, language: 'en' });
    assert.equal(run.kind, 'retranscribe');
    assert.equal(run.rawText, 'segona transcripció');
    assert.equal(run.settings.whisper.language, 'en');

    const saved = await store.getDictation(id);
    assert.deepEqual(saved.runs.map((r) => r.kind), ['initial', 'retranscribe']);
    assert.equal(saved.runs[0].rawText, 'el deploy del bac em');
  });

  it('records a failed re-transcription without losing the audio or earlier runs', async () => {
    const stt = fakeStt();
    const service = createBenchmarkService({ store, stt });
    const { benchmarkId: id } = await service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'manual', config: baseConfig });
    stt.transcribeRaw = async () => { throw new Error('model missing'); };

    await assert.rejects(() => service.retranscribe(id, baseConfig), /model missing/);
    const saved = await store.getDictation(id);
    assert.equal(saved.runs.length, 2);
    assert.match(saved.runs[1].error, /model missing/);
    assert.ok((await store.getAudio(id)).length > 0);
  });

  it('refuses to reprocess when no run has raw text', async () => {
    const service = createBenchmarkService({ store, stt: fakeStt({ fail: 'boom' }) });
    await assert.rejects(() => service.dictate({ audioBase64: wavBuffer().toString('base64'), source: 'manual', config: baseConfig }));
    const [{ id }] = await store.list();
    await assert.rejects(() => service.reprocess(id, undefined, baseConfig), /no raw transcript/);
  });
});

describe('privacy', () => {
  it('benchmark code has no network access and the UI keeps the strict CSP', () => {
    for (const file of ['src/main/benchmark-store.js', 'src/main/benchmark-service.js', 'src/renderer/benchmarks.js']) {
      const source = fsSync.readFileSync(path.join(__dirname, '..', file), 'utf8');
      assert.ok(!/node:(https?|net|dns|tls|dgram)|require\(['"](https?|net|electron)['"]\)|fetch\(|XMLHttpRequest|WebSocket/.test(source), file);
    }
    const html = fsSync.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
    assert.match(html, /connect-src 'self'/);
    assert.match(html, /default-src 'none'/);
  });

  it('keeps benchmark data out of config.json', () => {
    const sanitized = sanitizeConfig({ ...baseConfig, runs: [{ text: 'x' }], audio: 'abc' });
    assert.deepEqual(Object.keys(sanitized).sort(), Object.keys(DEFAULT_CONFIG).sort());
  });
});

describe('applyPostProcessing', () => {
  it('applies the current rules to raw text and passes through without rules', () => {
    assert.equal(applyPostProcessing('bac em', { substitutions: 'bac em => backend' }), 'backend');
    assert.equal(applyPostProcessing('bac em', {}), 'bac em');
  });
});

describe('main IPC with invalid LOCALWHISPER_DATA_DIR', () => {
  function loadMainHandlers(config, envDir) {
    const handlers = new Map();
    const prevEnv = process.env.LOCALWHISPER_DATA_DIR;
    process.env.LOCALWHISPER_DATA_DIR = envDir;
    const moduleObj = { exports: {} };
    const mocks = {
      electron: {
        app: { whenReady: () => ({ then() {} }), on() {}, getVersion: () => '9.9.9', getPath: () => '/unused' },
        ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
        dialog: {},
        systemPreferences: {},
        globalShortcut: {},
        shell: {}
      },
      './config-store': { loadConfig: async () => config, saveConfig: async (c) => c },
      './stt-service': fakeStt(),
      './paste-service': {},
      './tray-manager': {},
      './overlay-window': {},
      './benchmark-store': require('../src/main/benchmark-store'),
      './benchmark-service': require('../src/main/benchmark-service'),
      '../shared/glossary': require('../src/shared/glossary')
    };
    const file = path.join(__dirname, '../src/main/main.js');
    vm.runInNewContext(fsSync.readFileSync(file, 'utf8'), {
      module: moduleObj,
      exports: moduleObj.exports,
      __dirname: path.dirname(file),
      require: (name) => (Object.hasOwn(mocks, name) ? mocks[name] : require(name)),
      process,
      Buffer,
      console
    }, { filename: file });
    return {
      handlers,
      restore: () => {
        if (prevEnv === undefined) delete process.env.LOCALWHISPER_DATA_DIR;
        else process.env.LOCALWHISPER_DATA_DIR = prevEnv;
      }
    };
  }

  const event = { senderFrame: { url: 'file:///app/index.html' } };

  it('still dictates when LOCALWHISPER_DATA_DIR is relative and saving is off', async () => {
    const { handlers, restore } = loadMainHandlers({ ...baseConfig, saveBenchmarks: false }, 'relative/dir');
    try {
      const outcome = await handlers.get('stt:transcribe')(event, { audioBase64: wavBuffer().toString('base64'), source: 'manual' });
      assert.equal(outcome.text, 'el deploy del backend');
      assert.equal(outcome.benchmarkId, null);
      assert.equal(outcome.benchmarkError, '');
      await assert.rejects(() => handlers.get('benchmarks:list')(event), /absolute path/);
    } finally {
      restore();
    }
  });

  it('still dictates and reports benchmarkError when LOCALWHISPER_DATA_DIR is relative and saving is on', async () => {
    const { handlers, restore } = loadMainHandlers({ ...baseConfig, saveBenchmarks: true }, 'relative/dir');
    try {
      const outcome = await handlers.get('stt:transcribe')(event, { audioBase64: wavBuffer().toString('base64'), source: 'manual' });
      assert.equal(outcome.text, 'el deploy del backend');
      assert.equal(outcome.benchmarkId, null);
      assert.match(outcome.benchmarkError, /absolute path/);
    } finally {
      restore();
    }
  });
});

describe('benchmarks UI regressions', () => {
  function mountBenchmarksUi(apiOverrides = {}) {
    function makeNode(tag = '') {
      const listeners = new Map();
      return {
        tag,
        className: '',
        dataset: {},
        value: '',
        textContent: '',
        hidden: false,
        disabled: false,
        style: {},
        children: [],
        listeners,
        addEventListener(type, fn) { listeners.set(type, fn); },
        replaceChildren(...nodes) { this.children = [...nodes]; },
        appendChild(node) { this.children.push(node); },
        querySelectorAll(sel) {
          const out = [];
          const walk = (n) => {
            if (n.tag === sel) out.push(n);
            for (const c of n.children || []) walk(c);
          };
          walk(this);
          return out;
        },
        removeAttribute(attr) { delete this[attr]; }
      };
    }

    const elements = new Map();
    const getEl = (id) => {
      if (!elements.has(id)) elements.set(id, makeNode(id));
      return elements.get(id);
    };

    const calls = { list: 0 };
    const dictations = {
      '20260101T000000Z-aaaaaaaa': {
        id: '20260101T000000Z-aaaaaaaa',
        createdAt: '2026-01-01T00:00:00Z',
        durationMs: 1000,
        language: 'ca',
        source: 'manual',
        reference: null,
        runs: [{ id: '11111111', createdAt: '2026-01-01T00:00:00Z', kind: 'initial', rawText: 'raw-a', text: 'text-a', settings: {} }]
      },
      '20260102T000000Z-bbbbbbbb': {
        id: '20260102T000000Z-bbbbbbbb',
        createdAt: '2026-01-02T00:00:00Z',
        durationMs: 1000,
        language: 'ca',
        source: 'manual',
        reference: null,
        runs: [{ id: '22222222', createdAt: '2026-01-02T00:00:00Z', kind: 'initial', rawText: null, text: null, error: 'boom', settings: {} }]
      }
    };

    const api = {
      listBenchmarks: async () => {
        calls.list += 1;
        return {
          dictations: Object.values(dictations).map((d) => ({
            id: d.id, createdAt: d.createdAt, durationMs: d.durationMs, language: d.language,
            source: d.source, runCount: d.runs.length, hasReference: Boolean(d.reference), preview: ''
          })),
          usage: { count: 2, bytes: 200 },
          directory: '/tmp/benchmarks'
        };
      },
      getBenchmark: async (id) => dictations[id],
      getBenchmarkAudio: async () => 'YQ==',
      reprocessBenchmark: async () => ({ id: '33333333' }),
      retranscribeBenchmark: async () => ({ id: '33333333' }),
      setBenchmarkReference: async (id, text) => ({ ...dictations[id], reference: text ? { text, updatedAt: '2026-01-03T00:00:00Z' } : null }),
      deleteBenchmark: async () => true,
      deleteAllBenchmarks: async () => 2,
      openBenchmarksFolder: async () => '/tmp/benchmarks',
      ...apiOverrides
    };

    const context = vm.createContext({
      window: { localWhisperApi: api, confirm: () => true },
      document: { getElementById: getEl, createElement: (tag) => makeNode(tag) },
      URL: { createObjectURL: () => 'blob:1', revokeObjectURL: () => {} },
      Blob: class { constructor(parts) { this.parts = parts; } },
      atob: (s) => Buffer.from(s, 'base64').toString('binary'),
      console
    });

    vm.runInContext(fsSync.readFileSync(path.join(__dirname, '../src/renderer/benchmarks.js'), 'utf8'), context);
    return { getEl, calls, context };
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 15));

  it('keeps the newly selected dictation and draft reference when an in-flight retranscribe finishes', async () => {
    let resolveRetranscribe;
    const { getEl } = mountBenchmarksUi({
      retranscribeBenchmark: () => new Promise((r) => { resolveRetranscribe = r; })
    });
    await flush();

    // Open A and start retranscribe.
    getEl('benchmarkList').children[0].listeners.get('click')();
    await flush();
    getEl('retranscribeBenchmark').listeners.get('click')();
    await flush();

    // Switch to B and start typing a reference while A is still transcribing.
    getEl('benchmarkList').children[1].listeners.get('click')();
    await flush();
    getEl('benchmarkReference').value = 'draft for B';

    // A finishes; view must remain on B with the user's draft intact.
    resolveRetranscribe({ id: '99999999' });
    await flush();
    assert.equal(getEl('benchmarkReference').value, 'draft for B');
    assert.equal(getEl('benchmarkList').children[1].className, 'selected');
  });

  it('keeps the newly selected dictation and draft reference when an in-flight retranscribe fails', async () => {
    let rejectRetranscribe;
    const { getEl } = mountBenchmarksUi({
      retranscribeBenchmark: () => new Promise((_, rej) => { rejectRetranscribe = rej; })
    });
    await flush();

    getEl('benchmarkList').children[0].listeners.get('click')();
    await flush();
    getEl('retranscribeBenchmark').listeners.get('click')();
    await flush();

    getEl('benchmarkList').children[1].listeners.get('click')();
    await flush();
    getEl('benchmarkReference').value = 'draft for B';

    rejectRetranscribe(new Error('whisper crashed'));
    await flush();
    assert.equal(getEl('benchmarkReference').value, 'draft for B');
    assert.equal(getEl('benchmarkList').children[1].className, 'selected');
  });

  it('disables Reprocess when no run has raw text and avoids re-listing on selection clicks', async () => {
    const { getEl, calls } = mountBenchmarksUi();
    await flush();
    assert.equal(calls.list, 1);

    // Click A (has rawText) -> enabled, no extra listBenchmarks call.
    getEl('benchmarkList').children[0].listeners.get('click')();
    await flush();
    assert.equal(getEl('reprocessBenchmark').disabled, false);
    assert.equal(calls.list, 1);

    // Click B (failed run, no rawText) -> disabled, no extra listBenchmarks call.
    getEl('benchmarkList').children[1].listeners.get('click')();
    await flush();
    assert.equal(getEl('reprocessBenchmark').disabled, true);
    assert.equal(calls.list, 1);
  });
});
