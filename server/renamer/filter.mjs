// Path masks and attribute filters (ReNamer's Masks / MasksExclude / hidden-system options).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Turn a shell-style mask ("*.jpg", "IMG_????.png", "a;b;c") into a RegExp. */
export function maskToRegExp(mask) {
  const escaped = String(mask)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** "*.jpg;*.png, *.bmp" -> [{ source, re }] */
export function parseMaskList(masks) {
  const list = Array.isArray(masks) ? masks : String(masks ?? '').split(';');
  return list
    .flatMap((m) => String(m).split(/[;,]/))
    .map((m) => m.trim())
    .filter(Boolean)
    .map((source) => ({ source, re: maskToRegExp(source) }));
}

export function matchMasks(name, maskList) {
  if (!maskList || maskList.length === 0) return false;
  return maskList.some((m) => m.re.test(name));
}

/**
 * Include/exclude decision for one file name.
 * includeMasks empty => everything is eligible.
 */
export function isNameEligible(name, includeMasks, excludeMasks) {
  const includes = parseMaskList(includeMasks);
  const excludes = parseMaskList(excludeMasks);
  if (excludes.length && matchMasks(name, excludes)) return false;
  if (includes.length === 0) return true;
  return matchMasks(name, includes);
}

/** Cheap, always-available hidden heuristic (dot-files). Real Win32 attributes need the pre-pass. */
export function isHiddenLike(name) {
  return String(name ?? '').startsWith('.');
}

/**
 * Collect the absolute paths of hidden/system entries under `root` in one shot.
 *
 * Node has no API for Win32 file attributes, and calling attrib per file would
 * dominate scan time. One PowerShell pre-pass keeps the cost at a single process
 * launch; if it fails we degrade to "no attribute filtering" instead of guessing.
 *
 * @returns {Promise<{hidden:Set<string>, system:Set<string>, degraded:boolean}>}
 */
export async function collectAttributeSet(root) {
  const hidden = new Set();
  const system = new Set();
  if (process.platform !== 'win32') return { hidden, system, degraded: false };

  const script = [
    '$ErrorActionPreference = "SilentlyContinue"',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$root = $args[0]',
    'Get-ChildItem -LiteralPath $root -Force -Recurse | ForEach-Object {',
    '  $a = $_.Attributes.ToString()',
    '  if ($a -match "Hidden") { $_.FullName }',
    '} ',
  ].join('\r\n');

  const scriptSystem = script.replace('"Hidden"', '"System"');

  try {
    const [hiddenOut, systemOut] = await Promise.all([
      execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, root], {
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
      }),
      execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', scriptSystem, root], {
        windowsHide: true,
        maxBuffer: 32 * 1024 * 1024,
        encoding: 'utf8',
      }),
    ]);
    for (const line of hiddenOut.stdout.split(/\r?\n/)) if (line.trim()) hidden.add(line.trim().toLowerCase());
    for (const line of systemOut.stdout.split(/\r?\n/)) if (line.trim()) system.add(line.trim().toLowerCase());
  } catch {
    return { hidden, system, degraded: true };
  }
  return { hidden, system, degraded: false };
}
