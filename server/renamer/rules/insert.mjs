import { BaseRule } from '../rule-base.mjs';
import { expandMetaTags } from '../metatags.mjs';

/** TRuleInsert: insert fixed text at the start, the end or an explicit index. */
export class InsertRule extends BaseRule {
  constructor(config = {}) {
    super('insert', config);
    this.text = String(config.text ?? '');
    const at = String(config.at || 'suffix');
    this.at = ['prefix', 'suffix', 'index'].includes(at) ? at : 'suffix';
    this.index = Math.max(1, Number(config.index) || 1);
    this.skipExtension = config.skipExtension !== false;
  }

  apply(parts, item, context) {
    const text = expandMetaTags(this.text, { item, context, parts });
    const target = this.skipExtension ? parts.base : `${parts.base}${parts.ext}`;
    const chars = [...target];
    let result;
    if (this.at === 'prefix') result = text + target;
    else if (this.at === 'suffix') result = target + text;
    else {
      const at = Math.min(Math.max(0, this.index - 1), chars.length);
      result = chars.slice(0, at).join('') + text + chars.slice(at).join('');
    }
    if (!this.skipExtension) return result;
    return { base: result, ext: parts.ext };
  }

  describe() {
    const where = { prefix: '开头', suffix: '结尾', index: `第 ${this.index} 位` }[this.at];
    return `Insert: 在${where}插入 "${this.text}"`;
  }
}

export default InsertRule;
