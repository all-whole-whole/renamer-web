import { BaseRule } from '../rule-base.mjs';
import { expandMetaTags } from '../metatags.mjs';

/** TRuleReplace: literal / wildcard substitution with case and whole-word options. */
export class ReplaceRule extends BaseRule {
  constructor(config = {}) {
    super('replace', config);
    this.find = String(config.find ?? '');
    this.replaceWith = String(config.replaceWith ?? '');
    this.caseSensitive = config.caseSensitive === true;
    this.wholeWord = config.wholeWord === true;
    this.wildcard = config.wildcard === true;
    this.occurrence = config.occurrence === 'first' ? 'first' : 'all';
  }

  /** Build the search RegExp; throws on empty needle so the row shows a real error. */
  compile(find = this.find) {
    if (find === '') throw new Error('查找内容为空');
    const source = this.wildcard
      ? find.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
      : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = this.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source;
    const flags = `${this.caseSensitive ? '' : 'i'}${this.occurrence === 'all' ? 'g' : ''}u`;
    try {
      return new RegExp(body, flags);
    } catch (err) {
      throw new Error(`查找模式无效: ${err.message}`);
    }
  }

  apply(parts, item, context) {
    const find = expandMetaTags(this.find, { item, context, parts });
    const replaceWith = expandMetaTags(this.replaceWith, { item, context, parts });
    const re = this.compile(find);
    return { base: parts.base.replace(re, replaceWith), ext: parts.ext };
  }

  describe() {
    const opts = [this.caseSensitive ? '区分大小写' : '', this.wholeWord ? '全词' : '', this.wildcard ? '通配符' : '']
      .filter(Boolean)
      .join(', ');
    return `Replace: "${this.find}" → "${this.replaceWith}"${opts ? ` (${opts})` : ''}`;
  }
}

export default ReplaceRule;
