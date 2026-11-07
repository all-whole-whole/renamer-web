import { BaseRule } from '../rule-base.mjs';

const CLASSES = {
  digits: '[\\p{Nd}]',
  letters: '[\\p{L}]',
  symbols: '[\\p{P}\\p{S}]',
  spaces: '[\\s]',
  control: '[\\p{Cc}\\p{Cf}]',
  nonAscii: '[^\\x20-\\x7E]',
  brackets: '[()\\[\\]{}]',
};

/** TRuleStrip: delete whole character classes from the stem. */
export class StripRule extends BaseRule {
  constructor(config = {}) {
    super('strip', config);
    this.selected = Object.keys(CLASSES).filter((key) => config[key] === true);
    this.skipExtension = config.skipExtension !== false;
  }

  build() {
    if (this.selected.length === 0) throw new Error('未选择任何要清除的字符类别');
    const body = this.selected.map((key) => CLASSES[key]).join('|');
    return new RegExp(`(?:${body})+`, 'gu');
  }

  apply(parts) {
    const re = this.build();
    if (this.skipExtension) return { base: parts.base.replace(re, ''), ext: parts.ext };
    return `${parts.base}${parts.ext}`.replace(re, '');
  }

  describe() {
    const labels = {
      digits: '数字',
      letters: '字母',
      symbols: '符号',
      spaces: '空格',
      control: '控制符',
      nonAscii: '非 ASCII',
      brackets: '括号',
    };
    return `Strip: 清除 ${this.selected.map((k) => labels[k]).join('/')}`;
  }
}

export default StripRule;
