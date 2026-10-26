const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');
const {
  normalizeGlossaryPrompt,
  MAX_PROMPT_LENGTH,
  MAX_SUBSTITUTIONS_LENGTH
} = require('../shared/glossary');

const DEFAULT_CONFIG = {
  whisperBinPath: '',
  modelPath: '',
  language: 'auto',
  extraArgs: '',
  glossaryPrompt: '',
  substitutions: '',
  shortcut: 'CommandOrControl+Shift+Space'
};

const MAX_PATH_LENGTH = 4096;
const MAX_ARGS_LENGTH = 2048;
const MAX_ACCELERATOR_LENGTH = 100;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function sanitizeConfig(config, strict = false) {
  const merged = { ...DEFAULT_CONFIG, ...config };

  const whisperBinPath = typeof merged.whisperBinPath === 'string'
    ? merged.whisperBinPath.trim().slice(0, MAX_PATH_LENGTH)
    : '';
  const modelPath = typeof merged.modelPath === 'string'
    ? merged.modelPath.trim().slice(0, MAX_PATH_LENGTH)
    : '';
  const extraArgs = typeof merged.extraArgs === 'string'
    ? merged.extraArgs.trim().slice(0, MAX_ARGS_LENGTH)
    : '';
  const shortcut = typeof merged.shortcut === 'string'
    ? merged.shortcut.trim().slice(0, MAX_ACCELERATOR_LENGTH)
    : DEFAULT_CONFIG.shortcut;

  // The vocabulary prompt is stored already normalized (single line, commas)
  // so the value written to disk is exactly what whisper-cli receives.
  const glossaryPrompt = normalizeGlossaryPrompt(merged.glossaryPrompt).slice(0, MAX_PROMPT_LENGTH);

  const substitutions = typeof merged.substitutions === 'string'
    ? merged.substitutions.trim().slice(0, MAX_SUBSTITUTIONS_LENGTH)
    : '';

  return {
    whisperBinPath,
    modelPath,
    language: normalizeLanguage(merged.language, strict),
    extraArgs,
    glossaryPrompt,
    substitutions,
    shortcut
  };
}

function normalizeLanguage(language, strict = false) {
  if (typeof language !== 'string') {
    return 'auto';
  }

  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === 'auto') {
    return 'auto';
  }

  if (/^[a-z]{2,3}$/.test(normalized)) {
    return normalized;
  }

  if (strict) {
    throw new Error(
      'Invalid language code. Use "auto" or a 2/3-letter code like "ca", "es" or "en".'
    );
  }

  return 'auto';
}

async function loadConfig() {
  const configPath = getConfigPath();

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return sanitizeConfig(parsed, false);
  } catch {
    return sanitizeConfig({}, false);
  }
}

async function saveConfig(config) {
  const configPath = getConfigPath();
  const next = sanitizeConfig(config, true);
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  loadConfig,
  saveConfig,
  sanitizeConfig,
  normalizeLanguage,
  DEFAULT_CONFIG
};
