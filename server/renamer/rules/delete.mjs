import { BaseRule } from '../rule-base.mjs';

/** TRuleDelete: cut N characters at a position, counted from either end. */
export class DeleteRule extends BaseRule {
  constructor(config = {}) {
    super('delete', config);
    this.from = config.from === 'end' ? 'end' : 'start';
    this.index = Math.max(1, Number(config.index) || 1);
    this.count = Math.max(1, Number(config.count) || 1);
    this.skipExtension = config.skipExtension !== false;
  }

  apply(parts) {
    const target = this.skipExtension ? parts.base : `${parts.base}${parts.ext}`;
    const chars = [...target]; // code-point aware so emoji/UTF-16 pairs are not split

    const start = this.from === 'start' ? this.index - 1 : Math.max(0, chars.length - this.index);
    const cut = chars.slice(0, start).concat(chars.slice(start + this.count));
    const result = cut.join('');

    if (!this.skipExtension) return result;
    return { base: result, ext: parts.ext };
  }

  describe() {
    const where = this.from === 'start' ? `从第 ${this.index} 个字符` : `从倒数第 ${this.index} 个字符`;
    return `Delete: ${where}起删除 ${this.count} 个字符`;
  }
}

export default DeleteRule;
