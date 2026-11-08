// HTTP + SSE gateway and the single source of truth for the working set.
//
// Design (方案 A): the item array lives here, never in the browser. The grid
// asks for a window (/api/files?offset=&limit=) and the server answers with at
// most a few dozen rows, so a million-file list costs the frontend nothing.
import http from 'node:http';
import { promises as fs, readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve, sep, basename, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config, PUBLIC_DIR, APP_VERSION, presetsDir, undoDir, getPref, setPref } from './config.mjs';
import { scanPaths } from './renamer/scanner.mjs';
import { runPreview, computeStats } from './renamer/engine.mjs';
import { RenameTransaction, undoBatch, listBatches, toLongPath } from './renamer/transaction.mjs';
import { createRules, RULE_META, defaultConfig, ruleMeta } from './renamer/rules/index.mjs';
import { META_TAGS } from './renamer/metatags.mjs';
import { getMetadata } from './renamer/metadata.mjs';
import * as presets from './presets.mjs';
import { pick, pickerAvailable } from './picker.mjs';
import { isAllowedHost, isSameOrigin } from './http-guard.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const state = {
  items: [],
  rules: [],
  revision: 0,
  viewCache: new Map(),
  clients: new Set(),
  job: null,
  lastActivity: Date.now(),
  lastBatch: null,
  lastScan: null,
  draftPreview: false,
};

/* ------------------------------- helpers -------------------------------- */

function bump() {
  state.revision += 1;
  state.viewCache.clear();
}

function touch() {
  state.lastActivity = Date.now();
}

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function fail(res, status, message, extra = {}) {
  json(res, status, { ok: false, error: message, ...extra });
}

async function readBody(req, limit = 16 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

function broadcast(type, payload) {
  const frame = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const res of state.clients) {
    try {
      res.write(frame);
    } catch {
      state.clients.delete(res);
    }
  }
}

function stats() {
  return computeStats(state.items);
}

function rowOf(item) {
  return {
    id: item.id,
    dir: item.dir,
    originalName: item.originalName,
    newName: item.newName,
    status: item.status,
    errorMessage: item.errorMessage,
    selected: item.selected !== false,
    size: item.size || 0,
  };
}

/**
 * View indexes are cached per revision: building them is O(n), and the grid
 * hits this on every scroll frame.
 */
function viewIndexes(view) {
  const key = `${view}:${state.revision}`;
  const cached = state.viewCache.get(key);
  if (cached) return cached;

  const out = [];
  if (view === 'issues') {
    for (let i = 0; i < state.items.length; i += 1) {
      const s = state.items[i].status;
      if (s === 'conflict' || s === 'error') out.push(i);
    }
  } else if (view === 'changed') {
    for (let i = 0; i < state.items.length; i += 1) if (state.items[i].status === 'ready') out.push(i);
  } else if (view === 'focus') {
    // Exception-driven default: every problem, plus the first 100 real changes.
    let sample = 0;
    for (let i = 0; i < state.items.length; i += 1) {
      const s = state.items[i].status;
      if (s === 'conflict' || s === 'error') out.push(i);
    }
    for (let i = 0; i < state.items.length && sample < 100; i += 1) {
      if (state.items[i].status === 'ready') {
        out.push(i);
        sample += 1;
      }
    }
  } else {
    for (let i = 0; i < state.items.length; i += 1) out.push(i);
  }
  state.viewCache.set(key, out);
  return out;
}

function previewNow(options = {}) {
  const rules = createRules(state.rules);
  const result = runPreview(state.items, rules, {
    autoFixConflicts: options.autoFixConflicts === true,
    overwriteWithNewName: options.overwriteWithNewName === true,
    firstDotIsExt: options.firstDotIsExt === true,
  });
  state.draftPreview = false;
  bump();
  return result;
}

/* ------------------------------- routing -------------------------------- */

async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method || 'GET';

  if (path === '/api/ping' && method === 'GET') {
    return json(res, 200, {
      app: 'renamer-web',
      version: APP_VERSION,
      pid: process.pid,
      clients: state.clients.size,
      items: state.items.length,
      platform: process.platform,
      picker: pickerAvailable(),
    });
  }

  if (path === '/api/rule-types' && method === 'GET') {
    return json(res, 200, { types: RULE_META, metaTags: META_TAGS });
  }

  if (path === '/api/meta' && method === 'GET') {
    const id = url.searchParams.get('id');
    const item = state.items.find((i) => i.id === id);
    if (!item) return fail(res, 404, '条目不存在');
    const full = join(item.dir, item.originalName);
    const meta = await getMetadata(full);
    item.meta = meta;
    item.size = meta.size;
    item.mtime = meta.mtime;
    if (meta.birthtime) item.birthtime = meta.birthtime;
    if (meta.ctime) item.ctime = meta.ctime;
    return json(res, 200, { ok: true, meta });
  }

  if (path === '/api/pick' && method === 'GET') {
    const kind = url.searchParams.get('kind') || 'files';
    try {
      const result = await pick(kind);
      return json(res, 200, result);
    } catch (err) {
      return fail(res, 500, err.message);
    }
  }

  if (path === '/api/scan' && method === 'POST') {
    if (state.job) return fail(res, 409, '已有任务在执行');
    const body = await readBody(req);
    const paths = Array.isArray(body.paths) ? body.paths : [];
    if (paths.length === 0) return fail(res, 400, '未提供路径');
    const mode = body.mode === 'append' ? 'append' : 'replace';
    const options = body.options || {};
    state.draftPreview = false;

    state.job = { kind: 'scan', startedAt: Date.now() };
    try {
      if (mode === 'replace') {
        state.items = [];
        bump();
      }
      const { items, truncated, skipped, skippedDirs } = await scanPaths(paths, options, {
        maxEntries: config.maxScanEntries,
        onProgress: ({ scanned, kept }) => broadcast('progress', { phase: 'scan', scanned, kept }),
      });
      const known = new Set(state.items.map((i) => join(i.dir, i.originalName).toLowerCase()));
      let added = 0;
      for (const item of items) {
        const key = join(item.dir, item.originalName).toLowerCase();
        if (known.has(key)) continue;
        known.add(key);
        state.items.push(item);
        added += 1;
      }
      // Appending invalidates the cached view indexes even when auto-preview is
      // off; without this bump a built `view=all` cache keeps serving the old
      // total until some unrelated action happens to invalidate it.
      if (added > 0) bump();
      state.lastScan = { at: Date.now(), truncated, skipped, skippedDirs, added };
      // Always recompute, even with an empty rule stack: a fresh scan must mark
      // unchanged rows as unchanged instead of leaving scanner defaults "ready".
      if (body.autoPreview !== false) previewNow(body.options || {});
      state.lastActivity = Date.now();
      return json(res, 200, {
        ok: true,
        added,
        total: state.items.length,
        truncated,
        skipped,
        skippedDirs,
        stats: stats(),
      });
    } finally {
      state.job = null;
    }
  }

  if (path === '/api/preview' && method === 'POST') {
    const body = await readBody(req);
    const transient = body.transient === true;
    const previousRules = state.rules;
    if (Array.isArray(body.rules)) state.rules = body.rules;
    const started = Date.now();
    let result;
    try {
      result = previewNow(body.options || {});
      if (transient) state.draftPreview = true;
    } finally {
      // The inline inspector previews an unsaved draft. Keep that draft out of
      // the rename state so closing the editor cannot rename with a rule the
      // user never applied. `draftPreview` blocks a direct /api/rename until a
      // normal preview recomputes the committed stack.
      if (transient) state.rules = previousRules;
    }
    return json(res, 200, {
      ok: true,
      stats: result.stats,
      conflictReport: result.conflictReport,
      revision: state.revision,
      elapsedMs: Date.now() - started,
    });
  }

  if (path === '/api/files' && method === 'GET') {
    const view = url.searchParams.get('view') || 'focus';
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    let indexes = viewIndexes(view);

    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (q) {
      indexes = indexes.filter((i) => {
        const it = state.items[i];
        return it.originalName.toLowerCase().includes(q) || it.newName.toLowerCase().includes(q);
      });
    }

    const slice = indexes.slice(offset, offset + limit);
    return json(res, 200, {
      ok: true,
      view,
      offset,
      limit,
      total: indexes.length,
      grandTotal: state.items.length,
      revision: state.revision,
      rows: slice.map((i) => rowOf(state.items[i])),
      stats: stats(),
    });
  }

  if (path === '/api/selection' && method === 'POST') {
    const body = await readBody(req);
    const ids = Array.isArray(body.ids) ? new Set(body.ids) : null;
    const selected = body.selected !== false;
    if (ids) for (const item of state.items) if (ids.has(item.id)) item.selected = selected;
    else for (const item of state.items) item.selected = selected;
    bump();
    return json(res, 200, { ok: true, stats: stats() });
  }

  if (path === '/api/clear' && method === 'POST') {
    state.items = [];
    state.draftPreview = false;
    bump();
    return json(res, 200, { ok: true, stats: stats() });
  }

  if (path === '/api/rename' && method === 'POST') {
    if (state.job) return fail(res, 409, '已有任务在执行');
    if (state.draftPreview) return fail(res, 409, '规则编辑器正在预览未应用的草稿');
    const body = await readBody(req);
    const overwrite = body.overwrite === true;
    const onlyIds = Array.isArray(body.ids) && body.ids.length ? new Set(body.ids) : null;

    const queue = state.items.filter(
      (item) =>
        (!onlyIds || onlyIds.has(item.id)) &&
        item.selected !== false &&
        item.status === 'ready' &&
        item.newName !== item.originalName,
    );
    if (queue.length === 0) return fail(res, 400, '没有可执行的重命名项');

    // Re-validate right before touching the disk: a file may have appeared or
    // vanished while the preview sat on screen.
    const tx = new RenameTransaction();
    state.job = { kind: 'rename', startedAt: Date.now(), total: queue.length };
    broadcast('progress', { phase: 'rename', done: 0, total: queue.length });

    try {
      const result = await tx.execute(queue, { overwrite });

      // Reflect the new on-disk names in the working set.
      for (const record of result.records) {
        const item = record.item;
        item.originalName = item.newName;
        item.originalBase = item.newBase;
        item.originalExt = item.newExt;
        item.newName = item.originalName;
        item.status = 'unchanged';
        item.errorMessage = null;
      }
      state.lastBatch = { batchId: result.batchId, count: result.count, at: Date.now() };
      previewNow({});
      broadcast('renamed', { batchId: result.batchId, count: result.count });
      return json(res, 200, {
        ok: true,
        batchId: result.batchId,
        count: result.count,
        revision: state.revision,
        stats: stats(),
      });
    } catch (err) {
      broadcast('error', { phase: 'rename', message: err.message });
      return fail(res, 500, err.message, { stats: stats() });
    } finally {
      state.job = null;
    }
  }

  if (path === '/api/undo' && method === 'POST') {
    const body = await readBody(req);
    let batchId = body.batchId;
    if (!batchId) {
      const batches = await listBatches(1);
      if (!batches.length) return fail(res, 400, '没有可撤销的批次');
      batchId = batches[0].batchId;
    }

    const logPath = join(undoDir, `${batchId}.json`);
    let entries = [];
    try {
      entries = JSON.parse(await fs.readFile(logPath, 'utf8')).entries || [];
    } catch {
      /* undoBatch reports the missing log */
    }

    try {
      const result = await undoBatch(batchId);
      // Map the restored names back onto the working set.
      const byTarget = new Map(state.items.map((i) => [join(i.dir, i.originalName).toLowerCase(), i]));
      for (const entry of entries) {
        const item = byTarget.get(String(entry.dst).toLowerCase());
        if (!item) continue;
        const restored = basename(entry.src);
        item.originalName = restored;
        item.newName = restored;
        const dot = restored.lastIndexOf('.');
        item.originalBase = dot > 0 ? restored.slice(0, dot) : restored;
        item.originalExt = dot > 0 ? restored.slice(dot) : '';
        item.status = 'unchanged';
      }
      state.lastBatch = null;
      previewNow({});
      broadcast('log', { level: 'info', message: `已撤销 ${result.restored} 个文件` });
      return json(res, 200, { ...result, revision: state.revision, stats: stats() });
    } catch (err) {
      return fail(res, 500, err.message);
    }
  }

  if (path === '/api/batches' && method === 'GET') {
    return json(res, 200, { ok: true, batches: await listBatches(10) });
  }

  if (path === '/api/presets' && method === 'GET') {
    return json(res, 200, { ok: true, presets: await presets.listPresets(), lastUsed: getPref('lastPreset', '') });
  }

  if (path === '/api/presets' && method === 'POST') {
    const body = await readBody(req);
    if (body.action === 'delete') {
      const result = await presets.deletePreset(body.name);
      return json(res, 200, result);
    }
    if (body.action === 'load') {
      const preset = await presets.loadPreset(body.name);
      state.rules = preset.rules;
      setPref('lastPreset', preset.name);
      previewNow({});
      return json(res, 200, { ok: true, ...preset, stats: stats() });
    }
    const result = await presets.savePreset(body.name, body.rules || state.rules);
    setPref('lastPreset', body.name);
    return json(res, 200, { ...result, presets: await presets.listPresets() });
  }

  if (path === '/api/export' && method === 'GET') {
    const format = url.searchParams.get('format') || 'csv';
    const rows = state.items.filter((i) => i.status === 'ready' || i.status === 'unchanged');
    if (format === 'json') {
      return json(res, 200, { ok: true, items: rows.map(rowOf) });
    }
    const lines = ['original,new,dir,status'];
    for (const r of rows) {
      const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
      lines.push([esc(r.originalName), esc(r.newName), esc(r.dir), esc(r.status)].join(','));
    }
    const body = Buffer.from(`\ufeff${lines.join('\r\n')}`, 'utf8');
    res.writeHead(200, {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="renamer-preview.csv"',
      'content-length': body.length,
    });
    return res.end(body);
  }

  if (path === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'hello', pid: process.pid, revision: state.revision })}\n\n`);
    state.clients.add(res);
    req.on('close', () => state.clients.delete(res));
    return undefined;
  }

  if (path === '/api/shutdown' && method === 'POST') {
    json(res, 200, { ok: true });
    setTimeout(() => shutdown('api'), 50);
    return undefined;
  }

  return fail(res, 404, `未知接口: ${path}`);
}

/* ------------------------------- static --------------------------------- */

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = resolve(PUBLIC_DIR, `.${rel}`);
  if (!full.startsWith(PUBLIC_DIR + sep) && full !== PUBLIC_DIR) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const data = await fs.readFile(full);
    const type = MIME[extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'cache-control': 'no-store' });
    res.end(data);
  } catch {
    // SPA-ish fallback keeps deep links working while never masking API 404s.
    if (!extname(full)) {
      try {
        const html = await fs.readFile(join(PUBLIC_DIR, 'index.html'));
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        return res.end(html);
      } catch {
        /* fall through */
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}

/* ------------------------------- server --------------------------------- */

const server = http.createServer(async (req, res) => {
  touch();
  const host = req.headers.host || '';
  if (!isAllowedHost(host, config)) return fail(res, 403, '不受信任的 Host');
  const url = new URL(req.url, `http://${host}`);

  // Same-origin guard: a foreign page must not drive a local renamer. Match the
  // exact origin, never a substring (`127.0.0.1:8758.evil.test` is not us).
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin !== undefined && !isSameOrigin(origin, host, config)) {
    return fail(res, 403, '跨源请求被拒绝');
  }

  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    if (!res.headersSent) fail(res, 500, err.message);
    else res.end();
    return undefined;
  }
});

server.keepAliveTimeout = 5000;

let shuttingDown = false;
function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const res of state.clients) {
    try {
      res.write(`data: ${JSON.stringify({ type: 'bye', reason })}\n\n`);
      res.end();
    } catch {
      /* ignore */
    }
  }
  state.clients.clear();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

const idleMs = Math.max(10, Number(config.idleTimeoutSec) || 120) * 1000;
setInterval(() => {
  if (process.env.RENAMER_WEB_NO_IDLE === '1') return;
  if (state.clients.size > 0 || state.job) return;
  if (Date.now() - state.lastActivity < idleMs) return;
  shutdown('idle');
}, 5000).unref();

// Heartbeat so proxies and sleeping laptops do not silently drop the stream.
setInterval(() => {
  for (const res of state.clients) {
    try {
      res.write(': ping\n\n');
    } catch {
      state.clients.delete(res);
    }
  }
}, 20000).unref();

server.listen(config.port, config.host, () => {
  process.stdout.write(`renamer-web listening on http://${config.host}:${config.port}\n`);
});

process.on('SIGINT', () => shutdown('signal'));
process.on('SIGTERM', () => shutdown('signal'));
