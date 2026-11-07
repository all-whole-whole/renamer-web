// Shared rule contract. Every rename rule is a pure function over a name split into
// { base, ext }, mirroring ReNamer's TRule hierarchy (one class per rule type).
//
// apply() may return:
//   - { base, ext }  -> explicit split result
//   - "full name"    -> the engine re-splits it with the current extension policy
// Returning a string is the escape hatch for rules that legitimately change
// the extension boundary (e.g. the Extension rule, or a RegEx that rewrites the dot).

export class BaseRule {
  /**
   * @param {string} type   rule type id, e.g. 'replace'
   * @param {object} config rule parameters (also carries `enabled`)
   */
  constructor(type, config = {}) {
    this.type = type;
    this.enabled = config.enabled !== false;
    this.config = { ...config };
  }

  /** @returns {{base:string, ext:string}|string} */
  // eslint-disable-next-line no-unused-vars
  apply(nameParts, item, context) {
    throw new Error(`Rule "${this.type}" does not implement apply()`);
  }

  /** Human readable one-liner rendered in the rule stack. */
  describe() {
    return this.type;
  }
}

/**
 * Compound extensions that should stay attached to the "extension" side when
 * the caller opts into double-extension detection. Order matters: longest first.
 */
export const DOUBLE_EXTENSIONS = Object.freeze([
  '.tar.lzma',
  '.tar.bz2',
  '.tar.zst',
  '.tar.gz',
  '.tar.xz',
  '.tar.lz',
  '.d.mts',
  '.d.cts',
  '.d.ts',
]);

/**
 * Split a filename into stem + extension.
 * `firstDotIsExt` mirrors ReNamer's FirstDotAtFileNameStartIsExtension option:
 * ".gitignore" stays a name (leading dot never starts an extension) unless the
 * option is on and the dot is not the first character.
 *
 * `detectDoubleExt` treats the known compound suffixes above as one extension,
 * so `.tar.gz` is not mistaken for a file whose stem is `archive.tar`.
 */
export function splitName(fullName, options = {}) {
  const name = String(fullName ?? '');
  const firstDotIsExt = options.firstDotIsExt === true;
  if (!name) return { base: '', ext: '' };

  if (options.detectDoubleExt === true) {
    const lower = name.toLowerCase();
    for (const compound of DOUBLE_EXTENSIONS) {
      if (name.length > compound.length && lower.endsWith(compound)) {
        return { base: name.slice(0, -compound.length), ext: name.slice(-compound.length) };
      }
    }
  }

  if (firstDotIsExt) {
    const first = name.indexOf('.');
    if (first > 0) return { base: name.slice(0, first), ext: name.slice(first) };
    return { base: name, ext: '' };
  }

  const last = name.lastIndexOf('.');
  if (last <= 0 || last === name.length - 1) return { base: name, ext: '' };
  return { base: name.slice(0, last), ext: name.slice(last) };
}

export function joinName(base, ext) {
  return `${base ?? ''}${ext ?? ''}`;
}

/** Normalise whatever a rule returned into a { base, ext } pair. */
export function normalizeOutput(output, previous) {
  if (typeof output === 'string') return splitName(output);
  if (output && typeof output === 'object') {
    const base = typeof output.base === 'string' ? output.base : previous.base;
    const ext = typeof output.ext === 'string' ? output.ext : previous.ext;
    return { base, ext };
  }
  return { base: previous.base, ext: previous.ext };
}

/**
 * Error isolation boundary: a broken rule must fail only the current item and
 * must never let a non-Error throw escape with an empty message.
 */
export function applyRuleSafely(rule, nameParts, item, context) {
  try {
    return { ok: true, value: rule.apply(nameParts, item, context) };
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return { ok: false, error: normalized };
  }
}

/** Case transformation shared by the Case rule and a few helpers. */
export function applyCaseMode(text, mode) {
  switch (mode) {
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'title':
      return text.replace(/(^|[\s\-_.])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
    case 'sentence':
      return text.replace(/(^\s*\p{L})|([.!?]\s+\p{L})/gu, (m) => m.toUpperCase());
    case 'invert':
      return [...text]
        .map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()))
        .join('');
    default:
      return text;
  }
}
