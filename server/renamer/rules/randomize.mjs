import { randomInt, randomUUID } from 'node:crypto';
import { BaseRule } from '../rule-base.mjs';

const CHARSETS = {
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  digits: '0123456789',
  hex: '0123456789abcdef',
};

const CHARSET_NAMES = new Set(['uuid', 'alphanumeric', 'digits', 'hex']);
const POSITIONS = new Set(['replace', 'prefix', 'suffix']);

/**
 * TRuleRandomize: replace or decorate a name with a cryptographically random
 * token. UUIDs come from `crypto.randomUUID()`; other modes draw every
 * character with `crypto.randomInt()` so modulo bias never enters the name.
 */
export class RandomizeRule extends BaseRule {
  constructor(config = {}) {
    super('randomize', config);
    this.charset = CHARSET_NAMES.has(config.charset) ? config.charset : 'alphanumeric';
    this.length = Math.max(1, Math.min(256, Number(config.length) || 8));
    this.position = POSITIONS.has(config.position) ? config.position : 'replace';
    this.skipExtension = config.skipExtension !== false;
  }

  token() {
    if (this.charset === 'uuid') return randomUUID();
    const alphabet = CHARSETS[this.charset] || CHARSETS.alphanumeric;
    let out = '';
    for (let i = 0; i < this.length; i += 1) out += alphabet[randomInt(0, alphabet.length)];
    return out;
  }

  apply(parts) {
    const value = this.token();
    const target = this.skipExtension ? parts.base : `${parts.base}${parts.ext}`;
    let output;
    if (this.position === 'prefix') output = `${value}_${target}`;
    else if (this.position === 'suffix') output = `${target}_${value}`;
    else output = value;

    if (!this.skipExtension) return output;
    return { base: output, ext: parts.ext };
  }

  describe() {
    const label = {
      uuid: 'UUID',
      alphanumeric: '字母数字',
      digits: '纯数字',
      hex: '十六进制',
    }[this.charset];
    return `Randomize: ${label}${this.charset === 'uuid' ? '' : ` ${this.length} 位`} (${this.position})`;
  }
}

export default RandomizeRule;
