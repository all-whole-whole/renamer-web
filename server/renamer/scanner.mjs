import { stat, opendir, realpath } from 'node:fs/promises';
import { join, basename, extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isNameEligible, isHiddenLike, collectAttributeSet } from './filter.mjs';
import { splitName } from './rule-base.mjs';

/** Build the canonical item record the engine and the grid both use. */
export function makeItem(fullPath) {
  const dir = resolve(fullPath, '..');
  const name = basename(fullPath);
  const { base, ext } = splitName(name);
  return {
    id: randomUUID(),
    dir,
    originalName: name,
    originalBase: base,
    originalExt: ext,
    newName: name,
    newBase: base,
    newExt: ext,
    status: 'ready',
    errorMessage: null,
    selected: true,
    size: 0,
    mtime: 0,
    birthtime: 0,
    ctime: 0,
    meta: null,
  };
}

/**
 * Walk the given paths and produce items.
 * Attributes are only queried when the caller actually excludes hidden/system
 * entries; the default (include everything) costs zero extra processes.
 */
export async function scanPaths(paths, options = {}, { onProgress, maxEntries } = {}) {
  const recurse = options.recurse !== false;
  const includeMasks = options.masks ?? '';
  const excludeMasks = options.excludeMasks ?? '';
  const includeHidden = options.includeHidden !== false;
  const includeSystem = options.includeSystem !== false;
  const limit = maxEntries ?? options.maxEntries ?? 200000;
  const needAttributes = !includeHidden || !includeSystem;

  const items = [];
  const seen = new Set();
  const visitedDirs = new Set();
  let attributes = null;
  let skipped = 0;
  let skippedDirs = 0;
  let scanned = 0;

  const report = () => onProgress?.({ scanned, kept: items.length, skipped });

  const eligible = (fullPath, name) => {
    if (seen.has(fullPath.toLowerCase())) return false;
    if (!includeMasks && isHiddenLike(name) && !includeHidden) return false;
    if (!isNameEligible(name, includeMasks, excludeMasks)) return false;
    if (needAttributes && attributes) {
      const key = fullPath.toLowerCase();
      if (!includeHidden && attributes.hidden.has(key)) return false;
      if (!includeSystem && attributes.system.has(key)) return false;
    }
    return true;
  };

  const push = (fullPath, name) => {
    if (items.length >= limit) {
      skipped += 1;
      return;
    }
    if (!eligible(fullPath, name)) {
      skipped += 1;
      return;
    }
    seen.add(fullPath.toLowerCase());
    items.push(makeItem(fullPath));
    scanned += 1;
    if (scanned % 500 === 0) report();
  };

  const walk = async (dir) => {
    // Junctions and symlinked directories are common in Windows profile trees
    // (OneDrive, "Documents and Settings", package managers). Node reports
    // them as symlinks, not directories, so a plain `entry.isDirectory()` walk
    // silently drops every file below that level. Resolve the real path and
    // keep a visited set so a junction loop cannot recurse forever.
    let realDir;
    try {
      realDir = (await realpath(dir)).toLowerCase();
    } catch {
      realDir = dir.toLowerCase();
    }
    if (visitedDirs.has(realDir)) return;
    visitedDirs.add(realDir);

    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      skippedDirs += 1;
      return; // unreadable directory: counted and reported
    }
    for await (const entry of handle) {
      const full = join(dir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDir && !isFile && entry.isSymbolicLink()) {
        try {
          const target = await stat(full);
          isDir = target.isDirectory();
          isFile = target.isFile();
        } catch {
          skipped += 1;
          continue;
        }
      }
      if (isDir) {
        if (!recurse) continue;
        if (!includeHidden && isHiddenLike(entry.name)) {
          skipped += 1;
          continue;
        }
        await walk(full);
      } else if (isFile) {
        push(full, entry.name);
      }
      if (items.length >= limit) return;
    }
  };

  for (const rawPath of paths || []) {
    if (typeof rawPath !== 'string' || !rawPath.trim()) continue;
    const abs = resolve(rawPath.trim());
    let info;
    try {
      info = await stat(abs);
    } catch {
      skipped += 1;
      continue;
    }
    if (info.isDirectory()) {
      if (needAttributes && !attributes) {
        attributes = await collectAttributeSet(abs);
        if (attributes.degraded) attributes = null; // fail open rather than hide files
      }
      await walk(abs);
    } else if (info.isFile()) {
      push(abs, basename(abs));
    }
    if (items.length >= limit) break;
  }

  report();
  return { items, truncated: items.length >= limit, skipped, skippedDirs };
}

/** True when the path is a directory (used by the drop handler to decide recursion). */
export async function isDirectoryPath(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export { splitName, extname };
