import { BaseRule } from '../rule-base.mjs';

/**
 * TRuleSerialize: append a running number.
 * The counter lives in the run context (`state.counters`) so a preview and a
 * rename produce identical numbers, and so "reset per folder" is possible.
 */
export class SerializeRule extends BaseRule {
  constructor(config = {}) {
    super('serialize', config);
    this.start = Number(config.start ?? 1) || 1;
    this.step = Number(config.step ?? 1) || 1;
    this.padding = Math.max(0, Number(config.padding) || 0);
    this.position = ['prefix', 'suffix', 'index'].includes(config.position) ? config.position : 'suffix';
    this.index = Math.max(1, Number(config.index) || 1);
    this.resetPerFolder = config.resetPerFolder === true;
    this.separator = String(config.separator ?? '');
  }

  apply(parts, item, context) {
    const state = context?.state;
    const counterKey = this.resetPerFolder ? `dir:${item?.dir ?? ''}` : '__global__';

    let value;
    if (state?.counters) {
      value = state.counters.get(counterKey) ?? this.start;
      state.counters.set(counterKey, value + this.step);
    } else {
      value = this.start + (context?.index ?? 0) * this.step;
    }

    const num = this.padding > 0 ? String(value).padStart(this.padding, '0') : String(value);
    const text = `${this.separator}${num}`;

    if (this.position === 'prefix') return { base: `${num}${this.separator}${parts.base}`, ext: parts.ext };
    if (this.position === 'index') {
      const chars = [...parts.base];
      const at = Math.min(Math.max(0, this.index - 1), chars.length);
      const base = chars.slice(0, at).join('') + text + chars.slice(at).join('');
      return { base, ext: parts.ext };
    }
    return { base: `${parts.base}${text}`, ext: parts.ext };
  }

  describe() {
    const where = { prefix: '前缀', suffix: '后缀', index: `第 ${this.index} 位` }[this.position];
    return `Serialize: ${where}递增 (起 ${this.start}, 步 ${this.step}, 补 ${this.padding} 位)`;
  }
}

export default SerializeRule;
