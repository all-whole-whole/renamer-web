/** 极简 classnames：条件拼接，避免为一行字符串引入依赖。 */
export type ClassValue = string | false | null | undefined | 0;

export function cx(...parts: ClassValue[]): string {
  let out = '';
  for (const part of parts) {
    if (part) out = out ? `${out} ${part}` : part;
  }
  return out;
}
