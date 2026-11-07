import { BaseRule } from '../rule-base.mjs';
import { expandMetaTags } from '../metatags.mjs';

/** TRuleRearrange: split the stem on a separator and re-join the parts in a new order. */
export class RearrangeRule extends BaseRule {
  constructor(config = {}) {
    super('rearrange', config);
    this.separator = String(config.separator ?? ' - ');
    this.order = String(config.order ?? '2,1');
    this.joinWith = String(config.joinWith ?? ' ');
    this.removeEmpty = config.removeEmpty !== false;
  }

  apply(parts, item, context) {
    const separator = expandMetaTags(this.separator, { item, context, parts });
    const joinWith = expandMetaTags(this.joinWith, { item, context, parts });
    if (!separator) throw new Error('分隔符为空');
    const chunks = parts.base.split(separator);
    if (chunks.length < 2) return { base: parts.base, ext: parts.ext };

    const tokens = this.order
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 1);

    // Out-of-range indexes are ignored instead of producing `undefined`; if no
    // requested index exists, the original stem is the safe fallback.
    const selected = tokens.filter((n) => n <= chunks.length);
    const used = new Set(selected);
    if (!selected.length) return { base: parts.base, ext: parts.ext };

    const picked = selected.map((n) => chunks[n - 1]);
    const rest = chunks.filter((_, index) => !used.has(index + 1));
    const all = [...picked, ...rest];
    const joined = (this.removeEmpty ? all.filter((part) => part !== '') : all).join(joinWith);
    return { base: joined || parts.base, ext: parts.ext };
  }

  describe() {
    return `Rearrange: 按 "${this.separator}" 拆分，重排为 ${this.order}`;
  }
}

export default RearrangeRule;
