// Configuration loading, user-data directory resolution and the Storage.ini store.
// Mirrors ReNamer's portable layout: the app keeps its state next to the executable
// (Storage.ini) unless a per-user data directory is available.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const PUBLIC_DIR = join(ROOT, 'public');
export const DATA_FILES_DIR = join(ROOT, 'data');

export const DEFAULT_CONFIG = Object.freeze({
  host: '127.0.0.1',
  port: 8758,
  idleTimeoutSec: 120,
  maxScanEntries: 200000,
  scriptTimeoutMs: 100,
  longPathThreshold: 250,
  // Undo history is bounded by count and age so data/undo cannot grow forever.
  maxUndoHistory: 50,
  undoRetentionDays: 30,
  // Windows antivirus / Explorer preview can hold a handle for a few ms.
  renameRetryCount: 3,
  renameRetryDelayMs: 50,
});

function readJsonSafe(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const fileConfig = readJsonSafe(join(ROOT, 'config.json'), {});
const envPort = Number(process.env.RENAMER_WEB_PORT);
const portOverride = Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : null;

export const config = {
  ...DEFAULT_CONFIG,
  ...fileConfig,
  // Test harnesses and portable launchers can avoid colliding with a running
  // instance without editing config.json.
  ...(portOverride ? { port: portOverride } : {}),
};

/** Per-user data directory (presets, undo logs). Overridable for tests/portable use. */
export const dataDir =
  process.env.RENAMER_WEB_DATA ||
  join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'renamer-web');

export const presetsDir = join(dataDir, 'presets');
export const undoDir = join(dataDir, 'undo');
export const logsDir = join(dataDir, 'logs');

for (const dir of [dataDir, presetsDir, undoDir, logsDir]) {
  mkdirSync(dir, { recursive: true });
}

const storagePath = join(dataDir, 'Storage.ini');

/** Minimal INI reader: [section] / key=value. Returns a plain nested object. */
export function readStorage() {
  const out = {};
  if (!existsSync(storagePath)) return out;
  let section = 'general';
  out[section] = {};
  for (const rawLine of readFileSync(storagePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      section = head[1].trim();
      out[section] ||= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    out[section] ||= {};
    out[section][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Minimal INI writer (stable key order, sections in insertion order). */
export function writeStorage(obj) {
  const lines = [];
  for (const [section, values] of Object.entries(obj)) {
    lines.push(`[${section}]`);
    for (const [key, value] of Object.entries(values || {})) lines.push(`${key}=${value}`);
    lines.push('');
  }
  writeFileSync(storagePath, lines.join('\r\n'), 'utf8');
}

/** Persisted UI preferences (last used preset, column widths, filter view...). */
export function getPref(key, fallback = null) {
  const store = readStorage();
  return store.general?.[key] ?? fallback;
}

export function setPref(key, value) {
  const store = readStorage();
  store.general ||= {};
  store.general[key] = String(value);
  delete store['#USER#'];
  writeStorage(store);
}

export const paths = { root: ROOT, publicDir: PUBLIC_DIR, dataDir, presetsDir, undoDir, logsDir, storagePath };
