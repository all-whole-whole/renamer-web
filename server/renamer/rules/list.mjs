import { BaseRule } from '../rule-base.mjs';

/**
 * TRuleList: drive names from pasted lines.
 *
 * mapping:     old name -> new name, one pair per line
 * sequential:  line N is the new name for the Nth file in the preview
 *
 * The separator is configurable, but a few common separators are accepted as a
 * fallback so pasted CSV/TSV or `key=value` data works without extra settings.
 */
const AUTO_SEPARATORS = ['\t', '=>', '->', '=', '|', ','];
const FALLBACK_SEPARATORS = ['\t', '=>', '->', '=', '|', ','];

export class ListRule extends BaseRule {
  constructor(config = {}) {
    super('list', config);
    this.mode = config.mode === 'sequential' ? 'sequential' : 'mapping';
    this.separator = String(config.separator ?? '->');
    this.content = String(config.content ?? '');
    this.caseSensitive = config.caseSensitive === true;
    this.skipExtension = config.skipExtension !== false;
    this._map = null;
    this._lines = null;
  }

  lines() {
    if (!this._lines) {
      this._lines = this.content
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trim());
    }
    return this._lines;
  }

  entries() {
    if (this._map) return this._map;
    const map = new Map();
    for (const line of this.lines()) {
      if (!line) continue;
      const pair = splitPair(line, this.separator);
      if (!pair) continue;
      const key = this.caseSensitive ? pair.key : pair.key.toLowerCase();
      map.set(key, pair.value);
    }
    this._map = map;
    return map;
  }

  apply(parts, item, context) {
    if (this.mode === 'sequential') {
      if (item?.selected === false) return parts;
      const position = Number.isInteger(context?.selectedIndex) && context.selectedIndex >= 0
        ? context.selectedIndex
        : (context?.index ?? 0);
      const line = this.lines()[position];
      if (!line) return parts;
      return this.buildOutput(parts, line);
    }

    const map = this.entries();
    if (!map.size) return parts;
    const fullName = `${parts.base}${parts.ext}`;
    const candidates = [
      parts.base,
      fullName,
    ];
    for (const candidate of candidates) {
      const key = this.caseSensitive ? candidate : candidate.toLowerCase();
      if (map.has(key)) return this.buildOutput(parts, map.get(key));
    }
    return parts;
  }

  buildOutput(parts, value) {
    let output = String(value);
    if (this.skipExtension) {
      if (parts.ext && output.toLowerCase().endsWith(parts.ext.toLowerCase())) {
        output = output.slice(0, -parts.ext.length);
      }
      return { base: output, ext: parts.ext };
    }
    return output;
  }

  describe() {
    if (this.mode === 'sequential') return 'List: 按行号顺序替换文件名';
    const count = this.entries().size;
    return `List: 键值映射 (${count} 条)`;
  }
}

function splitPair(line, separator) {
  const configured = String(separator ?? '').trim();
  const separators = [configured, ...(configured ? FALLBACK_SEPARATORS : AUTO_SEPARATORS)].filter(
    (value, index, list) => value && list.indexOf(value) === index,
  );

  for (const delimiter of separators) {
    const at = line.indexOf(delimiter);
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + delimiter.length).trim();
    if (key && value) return { key, value };
  }
  return null;
}

export default ListRule;
