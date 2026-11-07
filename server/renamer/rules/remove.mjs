import { BaseRule } from '../rule-base.mjs';
import { expandMetaTags } from '../metatags.mjs';

/** TRuleRemove: delete a literal substring, or everything between two delimiters. */
export class RemoveRule extends BaseRule {
  constructor(config = {}) {
    super('remove', config);
    this.mode = config.mode === 'between' ? 'between' : 'literal';
    this.text = String(config.text ?? '');
    this.open = String(config.open ?? '(');
    this.close = String(config.close ?? ')');
    this.occurrence = ['all', 'first', 'last'].includes(config.occurrence) ? config.occurrence : 'all';
    this.caseSensitive = config.caseSensitive === true;
  }

  apply(parts, item, context) {
    const expand = (value) => expandMetaTags(value, { item, context, parts });
    if (this.mode === 'between') {
      const open = expand(this.open);
      const close = expand(this.close);
      if (!open || !close) throw new Error('分隔符不能为空');
      const base = removeBetween(parts.base, open, close);
      return { base, ext: parts.ext };
    }
    const text = expand(this.text);
    if (text === '') throw new Error('要移除的文本为空');
    return { base: removeOccurrences(parts.base, text, this.occurrence, this.caseSensitive), ext: parts.ext };
  }

  describe() {
    if (this.mode === 'between') return `Remove: 移除 ${this.open}…${this.close} 之间内容`;
    const occ = { all: '全部', first: '首个', last: '末个' }[this.occurrence];
    return `Remove: 移除"${this.text}" (${occ})`;
  }
}

function removeOccurrences(text, needle, occurrence, caseSensitive) {
  const hay = caseSensitive ? text : text.toLowerCase();
  const pin = caseSensitive ? needle : needle.toLowerCase();

  if (occurrence === 'all') {
    let out = '';
    let from = 0;
    for (;;) {
      const at = hay.indexOf(pin, from);
      if (at === -1) return out + text.slice(from);
      out += text.slice(from, at);
      from = at + needle.length;
    }
  }
  if (occurrence === 'first') {
    const at = hay.indexOf(pin);
    return at === -1 ? text : text.slice(0, at) + text.slice(at + needle.length);
  }
  const at = hay.lastIndexOf(pin);
  return at === -1 ? text : text.slice(0, at) + text.slice(at + needle.length);
}

/** Removes every balanced open..close span, delimiters included. */
function removeBetween(text, open, close) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(open, i);
    if (start === -1) return out + text.slice(i);
    const end = text.indexOf(close, start + open.length);
    if (end === -1) return out + text.slice(i);
    out += text.slice(i, start);
    i = end + close.length;
  }
  return out;
}

export default RemoveRule;
