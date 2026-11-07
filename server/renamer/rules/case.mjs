import { BaseRule, applyCaseMode } from '../rule-base.mjs';

const MODES = new Set(['lower', 'upper', 'title', 'sentence', 'invert']);

/** TRuleCase: change letter case of the stem, the extension or both. */
export class CaseRule extends BaseRule {
  constructor(config = {}) {
    super('case', config);
    this.mode = MODES.has(config.mode) ? config.mode : 'lower';
    this.scope = config.scope === 'ext' || config.scope === 'both' ? config.scope : 'base';
  }

  apply(parts) {
    let { base, ext } = parts;
    if (this.scope === 'base' || this.scope === 'both') base = applyCaseMode(base, this.mode);
    if (this.scope === 'ext' || this.scope === 'both') ext = applyCaseMode(ext, this.mode);
    return { base, ext };
  }

  describe() {
    const label = { lower: '小写', upper: '大写', title: '词首大写', sentence: '句首大写', invert: '反转大小写' }[this.mode];
    const sc = { base: '主名', ext: '扩展名', both: '全部' }[this.scope];
    return `Case: ${label} (${sc})`;
  }
}

export default CaseRule;
