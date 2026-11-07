import { promises as fs, existsSync } from 'node:fs';
import { join, dirname, basename, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, undoDir } from '../config.mjs';

const WIN = process.platform === 'win32';
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY']);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Windows Explorer's preview pane, indexers and antivirus scanners can hold a
 * handle for a few milliseconds. A hard `fs.rename` failure would roll the whole
 * batch back, so retry only the transient sharing violations.
 *
 * The implementation is injectable so the retry policy can be tested without
 * racing a real file lock.
 */
export async function renameWithRetry(from, to, options = {}) {
  const retries = Math.max(0, Number(options.retries ?? config.renameRetryCount ?? 3));
  const delayMs = Math.max(0, Number(options.delayMs ?? config.renameRetryDelayMs ?? 50));
  const rename = options.rename || fs.rename;
  let attempt = 0;
  for (;;) {
    try {
      await rename(from, to);
      return { attempts: attempt + 1 };
    } catch (err) {
      if (!RETRYABLE_RENAME_CODES.has(err.code) || attempt >= retries) throw err;
      attempt += 1;
      await delay(delayMs);
    }
  }
}

/**
 * Long-path prefix. Node passes the string straight to the Win32 API, so a
 * deep path over MAX_PATH fails unless it is prefixed with \\?\ .
 */
export function toLongPath(p) {
  if (!WIN || typeof p !== 'string') return p;
  if (p.startsWith('\\\\?\\')) return p;
  if (!isAbsolute(p)) return p;
  if (p.length < (config.longPathThreshold || 250)) return p;
  return p.startsWith('\\\\') ? `\\\\?\\UNC\\${p.slice(2)}` : `\\\\?\\${p}`;
}

/**
 * Two-phase rename transaction.
 *
 * Phase 1 moves every source to a unique temporary name inside the same
 * directory (same volume => rename() stays atomic). Phase 2 moves each
 * temporary to its destination. Splitting it this way is what makes
 * case-only renames and A<->B swaps work on NTFS, where a direct
 * rename("a.txt","A.TXT") is a no-op and a swap deadlocks.
 */
export class RenameTransaction {
  constructor(batchId = Date.now().toString(36)) {
    this.batchId = batchId;
    this.records = []; // { src, dst, temp, step }
    this.logFile = join(undoDir, `${batchId}.json`);
  }

  static isActionable(item) {
    return item && item.selected !== false && item.status === 'ready' && item.newName && item.newName !== item.originalName;
  }

  async execute(items, options = {}) {
    const queue = items.filter((item) => RenameTransaction.isActionable(item));
    if (queue.length === 0) return { ok: true, count: 0, batchId: this.batchId, records: [] };

    // ---- phase 1: vacate every source name
    for (const item of queue) {
      const src = toLongPath(join(item.dir, item.originalName));
      const dst = toLongPath(join(item.dir, item.newName));
      const temp = toLongPath(join(item.dir, `.__rn_tmp_${randomUUID().slice(0, 8)}`));
      try {
        await renameWithRetry(src, temp);
        this.records.push({ item, src, dst, temp, step: 1 });
      } catch (err) {
        await this.rollback();
        throw new Error(`无法暂存 "${item.originalName}": ${err.message}`);
      }
      item.status = 'renaming';
    }

    // ---- phase 2: place at destination
    for (const record of this.records) {
      try {
        if (options.overwrite) await fs.rm(record.dst, { force: true });
        await renameWithRetry(record.temp, record.dst);
        record.step = 2;
        record.item.status = 'success';
        record.item.newPath = record.dst;
      } catch (err) {
        await this.rollback();
        throw new Error(`落盘失败 "${record.item.newName}": ${err.message}`);
      }
    }

    await this.persistUndoLog();
    return { ok: true, count: this.records.length, batchId: this.batchId, records: this.records };
  }

  /** Best-effort restore. Two passes so swaps cannot collide. */
  async rollback() {
    const reverse = [...this.records].reverse();
    for (const record of reverse) {
      if (record.step !== 2) continue;
      try {
        await renameWithRetry(record.dst, record.temp);
        record.step = 1;
      } catch {
        /* already gone or locked; the second pass still tries */
      }
    }
    for (const record of reverse) {
      if (record.step !== 1) continue;
      try {
        await renameWithRetry(record.temp, record.src);
        record.step = 0;
        record.item.status = 'ready';
      } catch {
        record.item.status = 'error';
        record.item.errorMessage = '回滚失败，请手工检查该文件';
      }
    }
  }

  async persistUndoLog() {
    const payload = {
      batchId: this.batchId,
      createdAt: new Date().toISOString(),
      count: this.records.length,
      entries: this.records.map((r) => ({ src: r.src, dst: r.dst })),
    };
    await fs.writeFile(this.logFile, JSON.stringify(payload, null, 2), 'utf8');
    await pruneUndoHistory().catch(() => {});
    return this.logFile;
  }
}

/** Reverse a completed batch using its undo log. */
export async function undoBatch(batchId) {
  const file = join(undoDir, `${batchId}.json`);
  if (!existsSync(file)) throw new Error(`找不到撤销记录: ${batchId}`);
  const payload = JSON.parse(await fs.readFile(file, 'utf8'));
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const staged = [];

  for (const entry of entries) {
    const dst = toLongPath(entry.dst);
    const temp = toLongPath(join(dirname(entry.dst), `.__rn_undo_${randomUUID().slice(0, 8)}`));
    try {
      await renameWithRetry(dst, temp);
      staged.push({ temp, src: toLongPath(entry.src) });
    } catch {
      /* target already moved/removed by the user; skip this entry */
    }
  }
  let restored = 0;
  for (const entry of staged) {
    try {
      await renameWithRetry(entry.temp, entry.src);
      restored += 1;
    } catch {
      /* leave the temp in place rather than destroying data */
    }
  }
  await fs.rm(file, { force: true });
  return { ok: true, batchId, restored, total: entries.length };
}

/**
 * Bound the undo directory by both count and age. Newest logs win. Corrupt or
 * unreadable logs are removed once they fall outside the window; a stat failure
 * on one file never blocks the rest of the cleanup.
 */
export async function pruneUndoHistory(options = {}) {
  const max = Math.max(1, Number(options.max ?? config.maxUndoHistory ?? 50));
  const maxAgeDays = Math.max(1, Number(options.maxAgeDays ?? config.undoRetentionDays ?? 30));
  const now = Number(options.now ?? Date.now());
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;

  let names;
  try {
    names = await fs.readdir(undoDir);
  } catch {
    return { removed: 0, kept: 0, scanned: 0 };
  }

  const entries = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = join(undoDir, name);
    try {
      const stat = await fs.stat(full);
      entries.push({ full, mtimeMs: stat.mtimeMs });
    } catch {
      /* A concurrent undo may have removed it; that is already pruned. */
    }
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  let removed = 0;
  for (let i = 0; i < entries.length; i += 1) {
    if (i < max && entries[i].mtimeMs >= cutoff) continue;
    try {
      await fs.rm(entries[i].full, { force: true });
      removed += 1;
    } catch {
      /* keep going: one locked log must not abort retention */
    }
  }
  return { removed, kept: entries.length - removed, scanned: entries.length };
}

/** Recent batches, newest first (drives the "撤销上次" affordance). */
export async function listBatches(limit = 20) {
  try {
    const names = await fs.readdir(undoDir);
    const files = names.filter((n) => n.endsWith('.json'));
    const out = [];
    for (const name of files) {
      try {
        const payload = JSON.parse(await fs.readFile(join(undoDir, name), 'utf8'));
        out.push({ batchId: payload.batchId, createdAt: payload.createdAt, count: payload.count });
      } catch {
        /* corrupt log: ignore */
      }
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
  } catch {
    return [];
  }
}

export { basename };
