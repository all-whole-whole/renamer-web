import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { BaseRule } from '../rule-base.mjs';
import { expandMetaTags } from '../metatags.mjs';

/**
 * TRuleUserInput: rebuild a name from a small template language.
 *
 * Tokens:
 *   [:name:]    stem without extension
 *   [:ext:]     extension including the leading dot
 *   [:folder:]  immediate parent folder name
 *   [:size:]    formatted file size (B / KB / MB / GB)
 *   [:index:]   1-based position in the current preview
 *
 * Unknown tokens are left untouched so a typo is visible instead of silently
 * deleting user text.
 */
export class UserInputRule extends BaseRule {
  constructor(config = {}) {
    super('userinput', config);
    this.template = String(config.template ?? '[:folder:]_[:name:]');
    this.skipExtension = config.skipExtension !== false;
  }

  apply(parts, item, context) {
    const selectedIndex = Number.isInteger(context?.selectedIndex) && context.selectedIndex >= 0
      ? context.selectedIndex
      : (context?.index ?? 0);
    const values = {
      name: parts.base,
      ext: parts.ext,
      folder: item?.dir ? basename(item.dir) : '',
      size: formatSize(fileSize(item)),
      index: String(selectedIndex + 1),
    };

    const template = expandMetaTags(this.template, { item, context, parts });
    const output = template.replace(/\[:([a-z][a-z0-9_]*):\]/gi, (whole, key) => {
      const value = values[String(key).toLowerCase()];
      return value === undefined ? whole : value;
    });

    if (!this.skipExtension) return output;
    let base = output;
    if (parts.ext && base.toLowerCase().endsWith(parts.ext.toLowerCase())) {
      base = base.slice(0, -parts.ext.length);
    }
    return { base, ext: parts.ext };
  }

  describe() {
    return `UserInput: ${this.template}`;
  }
}

export function formatSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  return `${text}${units[unit]}`;
}

function fileSize(item) {
  const metaSize = Number(item?.meta?.size);
  if (Number.isFinite(metaSize) && metaSize > 0) return metaSize;
  const itemSize = Number(item?.size);
  if (Number.isFinite(itemSize) && itemSize > 0) return itemSize;
  const path = item?.path || (item?.dir && item?.originalName ? join(item.dir, item.originalName) : '');
  if (!path) return itemSize || 0;
  try {
    return statSync(path).size;
  } catch {
    return itemSize || 0;
  }
}

export default UserInputRule;
