import { splitName, joinName, applyRuleSafely } from './rule-base.mjs';
import { validateAndResolveConflicts } from './conflicts.mjs';

// Characters Windows refuses in a file name, plus the reserved device names.
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001F]/;
const RESERVED_DEVICE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/** @returns {string|null} a human-readable reason, or null when the name is usable. */
export function validateName(base, ext) {
  const full = joinName(base, ext);
  if (!full) return '结果文件名为空';
  if (full === '.' || full === '..') return '结果文件名无效';
  const bad = ILLEGAL.exec(full);
  if (bad) return `包含非法字符 "${bad[0]}"`;
  if (RESERVED_DEVICE.test(base.trim())) return `"${base}" 是系统保留设备名`;
  // Win32 strips trailing dots/spaces from the whole name, including a rule
  // that appended them to the extension (e.g. ".txt "), so validate `full`.
  if (/[. ]$/.test(full)) return '文件名不能以点或空格结尾';
  if (full.length > 255) return '文件名超过 255 个字符';
  return null;
}

export function computeStats(items) {
  const stats = { total: items.length, changed: 0, unchanged: 0, conflicts: 0, errors: 0, selected: 0 };
  for (const item of items) {
    if (item.status === 'conflict') stats.conflicts += 1;
    else if (item.status === 'error') stats.errors += 1;
    else if (item.status === 'unchanged') stats.unchanged += 1;
    else if (item.status === 'ready') stats.changed += 1;
    if (item.selected !== false) stats.selected += 1;
  }
  stats.issues = stats.conflicts + stats.errors;
  stats.actionable = stats.changed;
  // "Ready" is every row that is not blocked by a validation problem. It
  // includes unchanged files, matching the UI's 就绪 capsule.
  stats.ready = Math.max(0, stats.total - stats.conflicts - stats.errors);
  return stats;
}

/**
 * Preview pipeline: apply the enabled rule stack, in order, to every item.
 * Always recomputed from the ORIGINAL name so toggling a rule never compounds.
 *
 * `options.firstDotIsExt` mirrors FirstDotAtFileNameStartIsExtension; the
 * counters map mirrors the per-run state Serialize needs.
 */
export function runPreview(items, rules, options = {}) {
  const active = (rules || []).filter((r) => r && r.enabled !== false);
  const firstDotIsExt = options.firstDotIsExt === true;
  const state = { counters: new Map() };
  const context = { total: items.length, state, options, now: new Date() };
  let selectedCursor = 0;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const selectedIndex = item.selected === false ? -1 : selectedCursor++;
    let base = item.originalBase;
    let ext = item.originalExt;

    item.status = 'ready';
    item.errorMessage = null;

    for (const rule of active) {
      const result = applyRuleSafely(rule, { base, ext, fullName: joinName(base, ext) }, item, {
        ...context,
        index,
        selectedIndex,
      });
      if (!result.ok) {
        item.status = 'error';
        item.errorMessage = `[${rule.type}] ${result.error.message}`;
        break;
      }
      const next = normalize(result.value, { base, ext }, firstDotIsExt);
      base = next.base;
      ext = next.ext;
    }

    if (item.status !== 'error') {
      const problem = validateName(base, ext);
      if (problem) {
        item.status = 'error';
        item.errorMessage = problem;
      }
    }

    item.newName = item.status === 'error' ? item.originalName : joinName(base, ext);
    item.newBase = item.status === 'error' ? item.originalBase : base;
    item.newExt = item.status === 'error' ? item.originalExt : ext;
    item.newPath = joinPath(item.dir, item.newName);

    if (item.status === 'ready' && item.newName === item.originalName) item.status = 'unchanged';
  }

  const conflictReport = validateAndResolveConflicts(items, {
    autoFixConflicts: options.autoFixConflicts === true,
    overwriteWithNewName: options.overwriteWithNewName === true,
    checkDisk: options.checkDisk !== false,
  });

  return { items, stats: computeStats(items), conflictReport };
}

function normalize(output, previous, firstDotIsExt) {
  if (typeof output === 'string') return splitName(output, { firstDotIsExt });
  if (output && typeof output === 'object') {
    return {
      base: typeof output.base === 'string' ? output.base : previous.base,
      ext: typeof output.ext === 'string' ? output.ext : previous.ext,
    };
  }
  return { base: previous.base, ext: previous.ext };
}

function joinPath(dir, name) {
  const sep = dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\';
  return `${dir}${sep}${name}`;
}
