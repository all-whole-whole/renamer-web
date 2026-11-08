import type { Rule, RuleType } from '../types';

export function bytes(n: number | null | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function ruleDefaults(type: RuleType, id: string): Rule {
  const rule: Rule = { id, type: type.type, enabled: true };
  for (const field of type.fields) {
    rule[field.key] = field.default ?? (field.kind === 'bool' ? false : field.kind === 'number' ? 0 : '');
  }
  return rule;
}

const SHORT_KEYS: Record<string, string[]> = {
  replace: ['find', 'replaceWith'],
  regex: ['pattern', 'replaceWith'],
  insert: ['text'],
  delete: ['from', 'to'],
  remove: ['chars'],
  rearrange: ['pattern'],
  extension: ['newExt'],
  strip: ['chars'],
  case: ['mode'],
  serialize: ['template'],
  cleanup: ['mode'],
  padding: ['length'],
  translit: ['mode'],
  script: ['script'],
  reformatdate: ['sourceFormat', 'targetFormat'],
  list: ['list'],
  randomize: ['length'],
  userinput: ['prompt'],
};

/** 规则栈上的一行摘要：类型 + 最关键的 1–2 个参数。 */
export function describeRule(rule: Rule, types: RuleType[]): string {
  const meta = types.find((type) => type.type === rule.type);
  const label = meta?.label ?? rule.type;
  const keys = SHORT_KEYS[rule.type] ?? [];
  const bits: string[] = [];
  for (const key of keys) {
    const value = rule[key];
    if (value === undefined || value === null || value === '') continue;
    const text = String(value).replace(/\s+/g, ' ');
    bits.push(text.trim() === '' ? '" "' : text.length > 22 ? `${text.slice(0, 22)}…` : text);
  }
  return bits.length ? `${label} · ${bits.join(' → ')}` : label;
}
