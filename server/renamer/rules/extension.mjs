import { BaseRule, applyCaseMode, joinName, splitName } from '../rule-base.mjs';

/** TRuleExtension: force, drop or re-case the extension. */
export class ExtensionRule extends BaseRule {
  constructor(config = {}) {
    super('extension', config);
    const mode = String(config.mode || 'set');
    this.mode = ['set', 'remove', 'lower', 'upper', 'ensure'].includes(mode) ? mode : 'set';
    this.value = String(config.value ?? '').trim();
    if (this.value && !this.value.startsWith('.')) this.value = `.${this.value}`;
    // Defensive default: `.tar.gz` and `.d.ts` are one extension for this rule.
    this.detectDoubleExt = config.detectDoubleExt !== false;
  }

  /** Re-split the current name so compound suffixes survive every mode. */
  effective(parts) {
    if (!this.detectDoubleExt) return { base: parts.base, ext: parts.ext };
    return splitName(joinName(parts.base, parts.ext), { detectDoubleExt: true });
  }

  apply(parts) {
    const current = this.effective(parts);
    switch (this.mode) {
      case 'remove':
        return { base: current.base, ext: '' };
      case 'lower':
        return { base: current.base, ext: applyCaseMode(current.ext, 'lower') };
      case 'upper':
        return { base: current.base, ext: applyCaseMode(current.ext, 'upper') };
      case 'ensure':
        return current.ext ? current : { base: current.base, ext: this.value };
      case 'set':
      default:
        return { base: current.base, ext: this.value };
    }
  }

  describe() {
    const labels = { set: '设为', remove: '移除', lower: '转小写', upper: '转大写', ensure: '缺省补' };
    return `Extension: ${labels[this.mode]}${this.mode === 'remove' ? '' : ` "${this.value || ''}"`}`;
  }
}

export default ExtensionRule;
