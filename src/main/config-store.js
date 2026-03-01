const fs = require('node:fs/promises');
const path = require('node:path');
const { app } = require('electron');

const DEFAULT_CONFIG = {
  whisperBinPath: '',
  modelPath: '',
  language: 'auto',
  extraArgs: '-otxt'
};

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
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

function sanitizeConfig(config, strict = false) {
  const merged = { ...DEFAULT_CONFIG, ...config };
  return {
    whisperBinPath:
      typeof merged.whisperBinPath === 'string' ? merged.whisperBinPath.trim() : '',
    modelPath: typeof merged.modelPath === 'string' ? merged.modelPath.trim() : '',
    language: normalizeLanguage(merged.language, strict),
    extraArgs: typeof merged.extraArgs === 'string' ? merged.extraArgs.trim() : ''
  };
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
  DEFAULT_CONFIG
};
