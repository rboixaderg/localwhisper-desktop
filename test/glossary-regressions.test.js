const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const glossary = require('../src/shared/glossary');

function loadModule(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    module, exports: module.exports, __dirname: path.dirname(path.join(__dirname, '..', file)),
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
    process, Buffer, console
  }, { filename: file });
  return module.exports;
}

const configStore = loadModule('src/main/config-store.js', {
  electron: { app: { getPath: () => '/unused' } },
  '../shared/glossary': glossary
});

function mainHandlers(fileText) {
  const handlers = new Map();
  loadModule('src/main/main.js', {
    electron: {
      app: { whenReady: () => ({ then() {} }), on() {} },
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/glossary.txt'] }) }
    },
    'node:fs/promises': fileText === undefined ? require('node:fs/promises') : {
      stat: async () => ({ size: Buffer.byteLength(fileText) }),
      readFile: async () => fileText
    },
    './config-store': {}, './stt-service': {}, './paste-service': {},
    './tray-manager': {}, './overlay-window': {}, '../shared/glossary': glossary
  });
  return handlers;
}

async function renderer() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', hidden: false, style: {},
      addEventListener() {}, replaceChildren() {}, appendChild() {}
    });
    return elements.get(id);
  };
  const api = {
    loadConfig: async () => ({}),
    saveConfig: async config => configStore.sanitizeConfig(config, true),
    describeGlossary: async payload => mainHandlers().get('glossary:describe')(event, payload),
    getShortcutStatus: async () => ({}), getPermissionsStatus: async () => ({}),
    registerShortcut: async () => {}, notifyRendererReady: async () => {}, setRecordingState: async () => {},
    onTrayCommand() {}, onShortcutCommand() {}, onShortcutStatus() {}
  };
  const context = vm.createContext({
    window: { localWhisperApi: api, addEventListener() {} },
    document: { getElementById: element, createElement: () => ({}) },
    setTimeout, clearTimeout, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/renderer.js'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return { context, element, api };
}

const event = { senderFrame: { url: 'file:///app/index.html' } };
const oversizedRules = '#' + 'x'.repeat(3983) + '\nbac em => backend';

describe('glossary review regressions', () => {
  it('rejects oversized replacements on save instead of cutting a rule', () => {
    assert.equal(oversizedRules.length, 4002);
    assert.throws(() => configStore.sanitizeConfig({ substitutions: oversizedRules }, true), /4000/);
  });

  it('preserves oversized input on load so it can be repaired', () => {
    assert.equal(configStore.sanitizeConfig({ substitutions: oversizedRules }).substitutions, oversizedRules);
  });

  it('does not preview or execute an oversized rule list', () => {
    const info = mainHandlers().get('glossary:describe')(event, {
      substitutions: oversizedRules, sampleText: 'bac em'
    });
    assert.equal(info.ruleCount, 0);
    assert.equal(info.preview, 'bac em');
    assert.match(info.problems[0].reason, /4000/);
  });

  it('refuses to export a list that cannot be saved intact', () => {
    assert.throws(() => glossary.serializeGlossary({ substitutions: oversizedRules }), /4000/);
  });

  it('ignores rules under an unknown first section', () => {
    const parsed = glossary.parseGlossaryFile('[private]\nbac em => backend');
    assert.equal(parsed.substitutions, '');
    assert.equal(parsed.problems[0].line, 1);
  });

  it('resumes known sections after skipping an unknown section', () => {
    const parsed = glossary.parseGlossaryFile('[private]\na => b\n[substitutions]\nc => d');
    assert.equal(parsed.substitutions, 'c => d');
    assert.equal(parsed.problems.length, 1);
  });

  it('reports the original file line including comments and blank lines', () => {
    const parsed = glossary.parseGlossaryFile('# heading\n[prompt]\ndeploy\n\n[substitutions]\n# note\n\ninvalid');
    assert.equal(parsed.problems[0].line, 8);
  });

  it('reports original duplicate line numbers in both parts of the diagnostic', () => {
    const parsed = glossary.parseGlossaryFile('[substitutions]\n# note\na => b\n\nA => c');
    assert.equal(parsed.problems[0].line, 5);
    assert.equal(parsed.problems[0].reason, 'duplicate of line 3');
  });

  it('preserves line numbers in headerless files too', () => {
    const parsed = glossary.parseGlossaryFile('# note\n\na => b\n\ninvalid');
    assert.equal(parsed.problems[0].line, 5);
  });

  it('warns about token-dense prompts even below the 600-character cap', () => {
    const prompt = Array.from({ length: 100 }, (_, i) => `X${i}`).join(', ');
    const info = mainHandlers().get('glossary:describe')(event, { glossaryPrompt: prompt });
    assert.equal(prompt.length, 488);
    // Upstream Whisper vocabulary tokenizes this fixture as 299 tokens.
    assert.ok(info.promptTokenUpperBound >= 299);
    assert.equal(info.promptMayExceedLimit, true);
  });

  it('does not warn for a short prompt and bounds UTF-8 rather than UTF-16', () => {
    const info = mainHandlers().get('glossary:describe')(event, { glossaryPrompt: 'café' });
    assert.equal(info.promptTokenUpperBound, 5);
    assert.equal(info.promptMayExceedLimit, false);
  });

  it('bounds chained expansion before allocating huge output', () => {
    const rules = Array.from({ length: 18 }, (_, i) => {
      const from = `a${String(i).padStart(3, '0')}`;
      const to = `a${String(i + 1).padStart(3, '0')}`;
      return `${from} => ${to} ${to}`;
    }).join('\n');
    assert.throws(() => glossary.applySubstitutions('a000', glossary.parseSubstitutions(rules)), /limit/i);
  });

  it('returns preview expansion failures as a visible diagnostic', () => {
    const info = mainHandlers().get('glossary:describe')(event, {
      substitutions: 'a => ' + 'b'.repeat(3000), sampleText: Array(1001).fill('a').join(' ')
    });
    assert.match(info.previewError, /limit/i);
  });

  it('rejects oversized replacement imports instead of replacing the fields', async () => {
    const handler = mainHandlers('[substitutions]\na => ' + 'b'.repeat(3997)).get('glossary:import');
    await assert.rejects(() => handler(event), /4000/);
  });

  it('rejects empty imports instead of replacing the fields', async () => {
    await assert.rejects(() => mainHandlers(' ').get('glossary:import')(event), /empty/);
  });

  it('does not write configuration after rejecting an oversized list', async () => {
    let writes = 0;
    const store = loadModule('src/main/config-store.js', {
      electron: { app: { getPath: () => '/unused' } },
      '../shared/glossary': glossary,
      'node:fs/promises': { mkdir: async () => {}, writeFile: async () => { writes++; } }
    });
    await assert.rejects(() => store.saveConfig({ substitutions: oversizedRules }), /4000/);
    assert.equal(writes, 0);
  });

  it('accepts the exact replacement length limit intact', () => {
    const substitutions = 'a => ' + 'b'.repeat(3995);
    assert.equal(configStore.sanitizeConfig({ substitutions }, true).substitutions, substitutions);
    assert.equal(glossary.parseSubstitutions(substitutions)[0].to.length, 3995);
  });

  it('bounds total match work even without output growth', () => {
    const sample = Array(60001).fill('a000').join(' ');
    const rules = glossary.parseSubstitutions('a000 => a001\na001 => a002');
    assert.throws(() => glossary.applySubstitutions(sample, rules), /limit/i);
  });

  it('accepts bounded output at the exact character limit', () => {
    const rules = glossary.parseSubstitutions('a => b');
    assert.equal(glossary.applySubstitutions('a'.repeat(500000), rules).length, 500000);
    assert.throws(() => glossary.applySubstitutions('a'.repeat(500001), rules), /limit/i);
  });

  it('warns in the renderer for token-dense prompts', async () => {
    const { context, element } = await renderer();
    element('glossaryPrompt').value = Array.from({ length: 100 }, (_, i) => `X${i}`).join(', ');
    await context.refreshGlossaryFeedback();
    assert.match(element('promptStatus').textContent, /488.*conservative.*may exceed 224/);
    assert.equal(element('promptStatus').style.color, '#9f1d1d');
  });

  it('refreshes the preview after saving and preserves edits on a failed save', async () => {
    const { context, element } = await renderer();
    element('substitutions').value = 'bac em => backend';
    element('previewInput').value = 'bac em';
    await context.saveConfig();
    assert.equal(element('previewOutput').textContent, 'backend');
    element('substitutions').value = oversizedRules;
    await context.saveConfig();
    assert.equal(element('substitutions').value, oversizedRules);
    assert.match(element('configStatus').textContent, /4000/);
  });

  it('shows expansion failures in the renderer instead of hiding them', async () => {
    const { context, element } = await renderer();
    element('substitutions').value = 'a => ' + 'b'.repeat(3000);
    element('previewInput').value = Array(1000).fill('a').join(' ');
    await context.refreshGlossaryFeedback();
    assert.match(element('previewOutput').textContent, /limit/i);
    assert.equal(element('previewOutput').style.color, '#9f1d1d');
  });

  it('still supports ordinary sequential chaining and literal replacements', () => {
    assert.equal(glossary.applySubstitutions('alpha', glossary.parseSubstitutions('alpha => beta\nbeta => $&')), '$&');
  });
});

describe('transcription replacement integration', () => {
  function service({ stdout = '', sidecar = '', extraArgs = '', substitutions = 'bac em => backend' }) {
    const { EventEmitter } = require('node:events');
    let cleanedUp = false;
    const stt = loadModule('src/main/stt-service.js', {
      '../shared/glossary': glossary,
      'node:fs/promises': {
        access: async () => {}, mkdtemp: async () => '/fake-temp', writeFile: async () => {},
        readdir: async () => sidecar ? ['output.txt'] : [],
        readFile: async () => sidecar,
        rm: async () => { cleanedUp = true; }
      },
      'node:child_process': {
        spawn: () => {
          const proc = new EventEmitter();
          proc.stdout = new EventEmitter();
          proc.stderr = new EventEmitter();
          setImmediate(() => {
            proc.stdout.emit('data', Buffer.from(stdout));
            proc.emit('close', 0, null);
          });
          return proc;
        }
      }
    });
    return {
      transcribe: () => stt.transcribeAudio({
        audioBase64: 'YQ==', config: { whisperBinPath: '/fake-bin', modelPath: '/fake-model', extraArgs, substitutions }
      }),
      cleanedUp: () => cleanedUp
    };
  }

  for (const [name, options] of [
    ['stdout', { stdout: 'bac em' }],
    ['explicit sidecar', { stdout: '#', sidecar: 'bac em', extraArgs: '-otxt' }],
    ['fallback sidecar', { sidecar: 'bac em' }]
  ]) {
    it(`applies replacements to ${name} and removes temporary files`, async () => {
      const run = service(options);
      assert.equal(await run.transcribe(), 'backend');
      assert.equal(run.cleanedUp(), true);
    });
  }

  it('cleans up and rejects a transcription that exceeds the expansion budget', async () => {
    const run = service({ stdout: Array(1000).fill('a').join(' '), substitutions: 'a => ' + 'b'.repeat(3000) });
    await assert.rejects(run.transcribe, /limit/i);
    assert.equal(run.cleanedUp(), true);
  });
});
