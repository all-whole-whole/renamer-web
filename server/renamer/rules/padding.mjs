import { BaseRule } from '../rule-base.mjs';

/** TRulePadding: pad the stem to a fixed width with a fill character. */
export class PaddingRule extends BaseRule {
  constructor(config = {}) {
    super('padding', config);
    this.length = Math.max(1, Number(config.length) || 4);
    this.char = String(config.char ?? '0').slice(0, 1) || '0';
    this.align = config.align === 'right' ? 'right' : 'left';
    this.skipExtension = config.skipExtension !== false;
  }

  apply(parts) {
    const target = this.skipExtension ? parts.base : `${parts.base}${parts.ext}`;
    const chars = [...target];
    if (chars.length >= this.length) return this.skipExtension ? { base: target, ext: parts.ext } : target;
    const gap = this.length - chars.length;
    const result = this.align === 'left' ? this.char.repeat(gap) + target : target + this.char.repeat(gap);
    if (!this.skipExtension) return result;
    return { base: result, ext: parts.ext };
  }

  describe() {
    return `Padding: 补至 ${this.length} 位 (${this.align === 'left' ? '左侧' : '右侧'}填 "${this.char}")`;
  }
}

export default PaddingRule;
