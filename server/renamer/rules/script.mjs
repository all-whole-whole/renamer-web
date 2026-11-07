import vm from 'node:vm';
import { BaseRule, joinName } from '../rule-base.mjs';

/**
 * TRulePascalScript replacement: a sandboxed JavaScript rule.
 *
 * The host surface mirrors what ReNamer exposes to Pascal Script (FileName /
 * FilePath / FileExt / Index plus a metadata bag), but execution goes through
 * `node:vm` with a hard timeout so a runaway loop cannot wedge the host.
 * No require/process/fs is reachable from the sandbox.
 */
export class ScriptRule extends BaseRule {
  constructor(config = {}) {
    super('script', config);
    this.source = String(config.source ?? '');
    this.timeout = Math.max(5, Math.min(2000, Number(config.timeoutMs) || 100));
    this._compiled = null;
    this._compiledFrom = null;
  }

  compile() {
    if (!this.source.trim()) throw new Error('脚本内容为空');
    if (this._compiled && this._compiledFrom === this.source) return this._compiled;
    try {
      this._compiled = new vm.Script(this.source, { filename: 'rule-script.js', displayErrors: true });
      this._compiledFrom = this.source;
      return this._compiled;
    } catch (err) {
      throw new Error(`脚本语法错误: ${err.message}`);
    }
  }

  apply(parts, item, context) {
    const script = this.compile();
    const sandbox = {
      FileName: joinName(parts.base, parts.ext),
      FilePath: item?.dir ?? '',
      FileExt: parts.ext,
      Index: context?.index ?? 0,
      Meta: item?.meta ?? {},
    };
    const ctx = vm.createContext(sandbox, { name: 'renamer-rule' });
    try {
      script.runInContext(ctx, { timeout: this.timeout });
    } catch (err) {
      throw new Error(`脚本执行失败: ${err.message}`);
    }
    const out = sandbox.FileName;
    if (typeof out !== 'string') throw new Error('脚本必须把 FileName 保持为字符串');
    return out;
  }

  describe() {
    const firstLine = this.source.split(/\r?\n/).find((l) => l.trim()) || '';
    return `Script: ${firstLine.slice(0, 60)}`;
  }
}

export default ScriptRule;
