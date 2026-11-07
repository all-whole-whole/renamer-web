// Preset persistence (.rnp files, JSON inside). Mirrors ReNamer's Presets folder:
// a preset is a named rule stack that can be loaded, saved and shared.
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { presetsDir } from './config.mjs';
import { createRules } from './renamer/rules/index.mjs';

const VERSION = 1;

function safeName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 80);
}

function fileFor(name) {
  const clean = safeName(name);
  if (!clean) throw new Error('预设名称无效');
  return join(presetsDir, `${clean}.rnp`);
}

export async function listPresets() {
  if (!existsSync(presetsDir)) return [];
  const names = await fs.readdir(presetsDir);
  const out = [];
  for (const file of names) {
    if (!file.toLowerCase().endsWith('.rnp')) continue;
    try {
      const payload = JSON.parse(await fs.readFile(join(presetsDir, file), 'utf8'));
      out.push({
        name: payload.name || file.replace(/\.rnp$/i, ''),
        file,
        rules: Array.isArray(payload.rules) ? payload.rules.length : 0,
        updatedAt: payload.updatedAt || null,
      });
    } catch {
      out.push({ name: file.replace(/\.rnp$/i, ''), file, rules: 0, updatedAt: null, corrupt: true });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function savePreset(name, rules) {
  const clean = safeName(name);
  if (!clean) throw new Error('预设名称无效');
  const payload = {
    version: VERSION,
    name: clean,
    updatedAt: new Date().toISOString(),
    rules: Array.isArray(rules) ? rules : [],
  };
  await fs.writeFile(fileFor(clean), JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, name: clean };
}

export async function loadPreset(name) {
  const file = fileFor(name);
  if (!existsSync(file)) throw new Error(`预设不存在: ${name}`);
  const payload = JSON.parse(await fs.readFile(file, 'utf8'));
  return { name: payload.name || name, rules: Array.isArray(payload.rules) ? payload.rules : [] };
}

/** Load a preset and hand back live rule instances (used by the CLI). */
export async function loadPresetRules(name) {
  const preset = await loadPreset(name);
  return createRules(preset.rules);
}

export async function deletePreset(name) {
  const file = fileFor(name);
  if (!existsSync(file)) throw new Error(`预设不存在: ${name}`);
  await fs.rm(file, { force: true });
  return { ok: true };
}
