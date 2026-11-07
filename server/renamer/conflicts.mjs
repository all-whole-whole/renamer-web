import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { splitName, joinName } from './rule-base.mjs';

/** Case-insensitive destination identity, matching NTFS semantics. */
export function destinationKey(dir, name) {
  return `${String(dir).toLowerCase()}|${String(name).toLowerCase()}`;
}

/**
 * ReNamer runs validation and conflict repair as two distinct actions
 * (Action_ValidateNewNames / Action_FixConflictingNewNames). This function does
 * both: it marks unrepaired collisions and, when asked, repairs them by
 * appending _1, _2 ... while staying clear of names already on disk.
 *
 * The repair uses one case-folded directory listing per directory plus a live
 * reservation map. That keeps the lookup O(1) and lets a pathological batch with
 * thousands of identical stems finish without a magic "guard < 500" ceiling.
 */
export function validateAndResolveConflicts(items, options = {}) {
  const autoFix = options.autoFixConflicts === true;
  const overwrite = options.overwriteWithNewName === true;
  const checkDisk = options.checkDisk !== false;

  const report = { duplicateGroups: 0, diskConflicts: 0, fixed: 0, conflictCount: 0 };

  // Names that will be vacated by this batch: renaming onto one of these is safe.
  const vacated = new Set();
  for (const item of items) {
    if (item.status !== 'error' && item.newName !== item.originalName) {
      vacated.add(destinationKey(item.dir, item.originalName));
    }
  }

  const claimed = new Map();
  for (const item of items) {
    // An unchanged row does not compete for a destination: it is already at
    // that name. It still counts as an on-disk occupant in the second pass.
    if (item.status === 'error' || item.newName === item.originalName) continue;
    const key = destinationKey(item.dir, item.newName);
    if (!claimed.has(key)) claimed.set(key, []);
    claimed.get(key).push(item);
  }

  const diskCache = new Map();
  function diskNames(dir) {
    if (diskCache.has(dir)) return diskCache.get(dir);
    let names = null;
    try {
      names = new Set(readdirSync(dir).map((name) => name.toLowerCase()));
    } catch {
      names = null; // let existsSync answer per name (e.g. access denied)
    }
    diskCache.set(dir, names);
    return names;
  }

  function existsOnDisk(dir, name) {
    const names = diskNames(dir);
    if (names) return names.has(String(name).toLowerCase());
    return existsSync(join(dir, name));
  }

  /** Is `name` unavailable as a destination for `item`? */
  const isTaken = (item, name) => {
    const key = destinationKey(item.dir, name);
    const list = claimed.get(key);
    if (list && list.some((other) => other !== item)) return true;
    if (!checkDisk || overwrite) return false;
    if (vacated.has(key)) return false;
    if (key === destinationKey(item.dir, item.originalName)) return false;
    return existsOnDisk(item.dir, name);
  };

  function moveClaim(item, newName) {
    const oldKey = destinationKey(item.dir, item.newName);
    const oldList = claimed.get(oldKey);
    if (oldList) {
      const left = oldList.filter((other) => other !== item);
      if (left.length) claimed.set(oldKey, left);
      else claimed.delete(oldKey);
    }
    item.newName = newName;
    const parts = splitName(newName);
    item.newBase = parts.base;
    item.newExt = parts.ext;
    item.newPath = join(item.dir, newName);
    const key = destinationKey(item.dir, newName);
    const list = claimed.get(key) || [];
    list.push(item);
    claimed.set(key, list);
  }

  // Per-prefix cursor: the next item with the same stem starts where the last
  // one stopped, so 500+ duplicates do not rescan suffixes from _1 every time.
  const nextSuffix = new Map();
  const findAvailableName = (item, baseName) => {
    const { base, ext } = splitName(baseName);
    const cursorKey = `${item.dir.toLowerCase()}|${baseName.toLowerCase()}`;
    let n = nextSuffix.get(cursorKey) || 1;
    for (;;) {
      const suffix = `_${n}`;
      let stem = base;
      const fullLength = () => stem.length + suffix.length + ext.length;
      if (fullLength() > 255) {
        let chars = [...stem];
        while (chars.length && fullLength() > 255) {
          chars.pop();
          stem = chars.join('');
        }
      }
      const candidate = joinName(`${stem}${suffix}`, ext);
      if (!isTaken(item, candidate)) {
        nextSuffix.set(cursorKey, n + 1);
        return candidate;
      }
      n += 1;
    }
  };

  // Snapshot the groups first: repairs add and remove keys while we iterate.
  const groups = [...claimed.values()].filter((group) => group.length > 1);
  for (const group of groups) {
    report.duplicateGroups += 1;

    if (!autoFix) {
      for (const item of group) {
        item.status = 'conflict';
        item.errorMessage = `目标文件名在批次内重复：${item.newName}`;
      }
      continue;
    }

    // Keep the first occurrence, repair the rest.
    for (let i = 1; i < group.length; i += 1) {
      const item = group[i];
      if (item.status !== 'ready') continue;
      const candidate = findAvailableName(item, item.newName);
      moveClaim(item, candidate);
      item.status = 'ready';
      item.errorMessage = null;
      report.fixed += 1;
    }
  }

  // Second pass: destinations that already exist on disk (or became occupied
  // after a repair). Auto-fix appends the next free numeric suffix.
  if (checkDisk && !overwrite) {
    for (const item of items) {
      if (item.status !== 'ready') continue;
      const key = destinationKey(item.dir, item.newName);
      if (key === destinationKey(item.dir, item.originalName)) continue;
      if (vacated.has(key)) continue;
      if (!existsOnDisk(item.dir, item.newName)) continue;

      if (autoFix) {
        const candidate = findAvailableName(item, item.newName);
        moveClaim(item, candidate);
        report.fixed += 1;
      } else {
        item.status = 'conflict';
        item.errorMessage = `目标已存在：${item.newName}`;
        report.diskConflicts += 1;
      }
    }
  }

  report.conflictCount = items.filter((i) => i.status === 'conflict').length;
  return report;
}
