import { BaseRule } from '../rule-base.mjs';

// Compact transliteration tables. ReNamer ships a Translits\ folder of full
// mapping files; this port bundles the widely used scripts and strips Latin
// diacritics via NFD. CJK needs a pinyin dictionary that is intentionally NOT
// bundled (it would dwarf the app) — `cjk` therefore defaults to "keep".
const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y',
  ь: '', э: 'e', ю: 'yu', я: 'ya',
  і: 'i', ї: 'yi', є: 'ye', ґ: 'g',
};

const GREEK = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k',
  λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't',
  υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o',
};

function mapByTable(text, table) {
  return [...text]
    .map((ch) => {
      const lower = ch.toLowerCase();
      const mapped = table[lower];
      if (mapped === undefined) return ch;
      return ch === lower ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
    })
    .join('');
}

/** TRuleTranslit: reduce a name to a safe ASCII-friendly form. */
export class TranslitRule extends BaseRule {
  constructor(config = {}) {
    super('translit', config);
    const mode = String(config.mode || 'ascii');
    this.mode = ['ascii', 'cyrillic', 'greek'].includes(mode) ? mode : 'ascii';
    this.cjk = config.cjk === 'drop' ? 'drop' : 'keep';
    this.skipExtension = config.skipExtension !== false;
  }

  convert(text) {
    let out = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); // strip combining marks
    if (this.mode === 'cyrillic') out = mapByTable(out, CYRILLIC);
    if (this.mode === 'greek') out = mapByTable(out, GREEK);
    if (this.cjk === 'drop') out = out.replace(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/gu, '');
    return out;
  }

  apply(parts) {
    if (this.skipExtension) return { base: this.convert(parts.base), ext: parts.ext };
    return this.convert(`${parts.base}${parts.ext}`);
  }

  describe() {
    const labels = { ascii: '去变音符', cyrillic: '西里尔转写', greek: '希腊转写' };
    return `Translit: ${labels[this.mode]}${this.cjk === 'drop' ? ' + 去 CJK' : ''}`;
  }
}

export default TranslitRule;
