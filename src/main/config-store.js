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

async function loadConfig() {
  const configPath = getConfigPath();

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

async function saveConfig(config) {
  const configPath = getConfigPath();
  const next = { ...DEFAULT_CONFIG, ...config };
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  loadConfig,
  saveConfig,
  DEFAULT_CONFIG
};
