import { BaseRule } from '../rule-base.mjs';
import { expandMetaTags } from '../metatags.mjs';

/** TRuleRegEx: JavaScript regex replace with $1..$n back-references. */
export class RegExRule extends BaseRule {
  constructor(config = {}) {
    super('regex', config);
    this.pattern = String(config.pattern ?? '');
    this.replacement = String(config.replacement ?? '');
    this.flags = String(config.flags || 'g').replace(/[^gimsuy]/g, '');
    if (!this.flags.includes('g') && config.replaceAll !== false) this.flags += 'g';
    this.target = config.target === 'full' ? 'full' : 'base';
  }

  compile() {
    if (this.pattern === '') throw new Error('正则表达式为空');
    try {
      return new RegExp(this.pattern, this.flags);
    } catch (err) {
      throw new Error(`正则无效: ${err.message}`);
    }
  }

  apply(parts, item, context) {
    const re = this.compile();
    const replacement = expandMetaTags(this.replacement, { item, context, parts });
    if (this.target === 'full') {
      return `${parts.base}${parts.ext}`.replace(re, replacement);
    }
    return { base: parts.base.replace(re, replacement), ext: parts.ext };
  }

  describe() {
    return `RegEx: /${this.pattern}/${this.flags} → "${this.replacement}"`;
  }
}

export default RegExRule;
