import { BaseRule } from '../rule-base.mjs';

/** TRuleCleanUp: normalise noisy names (spaces, dots, duplicated separators). */
export class CleanUpRule extends BaseRule {
  constructor(config = {}) {
    super('cleanup', config);
    this.collapseSpaces = config.collapseSpaces !== false;
    this.trim = config.trim !== false;
    this.underscoresToSpaces = config.underscoresToSpaces === true;
    this.spacesToUnderscores = config.spacesToUnderscores === true;
    this.removeEmptyBrackets = config.removeEmptyBrackets === true;
    this.fixBrackets = config.fixBrackets === true;
    // A stem may not end with a dot or space on Windows; cleanup always repairs that.
    this.alwaysRepairTrailing = config.alwaysRepairTrailing !== false;
  }

  apply(parts) {
    let base = parts.base;

    if (this.underscoresToSpaces) base = base.replace(/_+/g, ' ');
    if (this.spacesToUnderscores) base = base.replace(/\s+/g, '_');
    if (this.removeEmptyBrackets) base = base.replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, '');
    if (this.fixBrackets) base = balanceBrackets(base);
    if (this.collapseSpaces) base = base.replace(/[ \t]{2,}/g, ' ').replace(/\.{2,}/g, '.');
    if (this.trim) base = base.trim().replace(/^[.\s]+|[.\s]+$/g, '');
    if (this.alwaysRepairTrailing) base = base.replace(/[. ]+$/g, '');

    return { base, ext: parts.ext };
  }

  describe() {
    return 'CleanUp: 规范化空格/括号/首尾点';
  }
}

/** Appends the closing characters in the order they were opened. */
function balanceBrackets(text) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const closers = new Set(Object.values(pairs));
  const stack = [];
  let out = '';
  for (const ch of text) {
    if (pairs[ch]) {
      stack.push(pairs[ch]);
      out += ch;
    } else if (closers.has(ch)) {
      if (stack.length && stack[stack.length - 1] === ch) {
        stack.pop();
        out += ch;
      }
      // Unmatched closer is dropped rather than left dangling.
    } else {
      out += ch;
    }
  }
  while (stack.length) out += stack.pop();
  return out;
}

export default CleanUpRule;
