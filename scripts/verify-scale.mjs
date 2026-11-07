#!/usr/bin/env node
// 10k-row UI stress probe over CDP. It appends a scale fixture to the running
// host, previews it through the real toolbar, then measures virtual scrolling
// and the preview latency. Node 22+ only; no dependencies.
//
// Usage:
//   node scripts/verify-scale.mjs --path E:\path\to\10k-folder
import { resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (token.startsWith('--')) args.set(token.slice(2), process.argv[i + 1]);
}
const cdp = args.get('cdp') || 'http://127.0.0.1:9222';
const fixture = resolve(args.get('path') || '..\\renamer-scale');
const preset = args.get('preset') || '';
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const targets = await (await fetch(`${cdp}/json/list`)).json();
const target = targets.find((item) => item.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(item.url));
if (!target) throw new Error('没有找到本地页面 target');

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolveOpen, rejectOpen) => {
  ws.addEventListener('open', resolveOpen, { once: true });
  ws.addEventListener('error', rejectOpen, { once: true });
});

let nextId = 0;
const pending = new Map();
const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    consoleErrors.push(message.params.exceptionDetails?.exception?.description || 'runtime exception');
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
  }
});

function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveSend, rejectSend) => {
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      rejectSend(new Error(`CDP timeout: ${method}`));
    }, 30000);
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, { timeout = 30000, label = expression } = {}) {
  const started = Date.now();
  for (;;) {
    if (await evaluate(`return Boolean(${expression});`)) return;
    if (Date.now() - started > timeout) throw new Error(`等待超时: ${label}`);
    await sleep(100);
  }
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.reload', { ignoreCache: true });
await sleep(1200);
await waitFor("document.querySelector('#statusBadge')", { label: '页面完成渲染' });
await sleep(300);

const loaded = await evaluate(`
  const select = document.querySelector('#presetSelect');
  const requested = ${JSON.stringify(preset)};
  const options = [...select.options].filter((item) => item.value);
  const option = requested ? options.find((item) => item.value === requested) : options[0];
  if (!option) return { ok: false };
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#btnLoadPreset').click();
  return { ok: true, preset: option.value };
`);
if (!loaded.ok) throw new Error('没有可载入的预设；请先在界面中保存一个预设');
await waitFor("document.querySelectorAll('.rule-item').length > 0", { label: '预设规则载入' });
await waitFor("document.querySelector('#statusBadge').textContent === '就绪'", { label: '初始预览完成' });

await evaluate(`
  await fetch('/api/clear', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return true;
`);

const scanStart = Date.now();
const scanned = await evaluate(`
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paths: [${JSON.stringify(fixture)}], mode: 'append', autoPreview: false }),
  });
  const data = await res.json();
  return { ok: data.ok, added: data.added, total: data.total, error: data.error || null };
`);
if (!scanned.ok) throw new Error(`扫描失败: ${scanned.error}`);
const scanMs = Date.now() - scanStart;

// Preview through the actual button and time the full UI round trip.
const previewStart = Date.now();
await evaluate(`document.querySelector('#btnPreview').click(); return true;`);
await waitFor("Number(document.querySelector('#metrics .metric.total b')?.textContent) === 10000", {
  timeout: 30000,
  label: '10k 预览统计',
});
await waitFor("document.querySelector('#statusBadge').textContent === '就绪'", { timeout: 30000, label: '10k 预览完成' });
const previewMs = Date.now() - previewStart;

await evaluate(`document.querySelector('#viewTabs .tab[data-view="all"]').click(); return true;`);
await waitFor("document.querySelectorAll('#gridRows .grid-row').length > 0", { label: '全部视图' });
await sleep(300);

const initialScale = await evaluate(`
  const vp = document.querySelector('#gridViewport');
  const spacer = document.querySelector('#gridSpacer');
  const rows = [...document.querySelectorAll('#gridRows .grid-row')];
  return {
    total: Number(document.querySelector('#metrics .metric.total b').textContent),
    rowNodes: rows.length,
    spacerHeight: Number.parseFloat(spacer.style.height),
    expectedHeight: Number(document.querySelector('#metrics .metric.total b').textContent) * 36,
    firstDataset: rows[0]?.dataset.index || null,
    gridOverflowX: vp.scrollWidth - vp.clientWidth,
  };
`);
if (initialScale.total !== 10000) throw new Error(`预期 10000 项，实际 ${initialScale.total}`);
if (Math.abs(initialScale.spacerHeight - initialScale.expectedHeight) > 1) throw new Error('虚拟滚动撑高不一致');
if (initialScale.gridOverflowX > 0) throw new Error(`10k 列表出现横向溢出 ${initialScale.gridOverflowX}px`);
if (initialScale.rowNodes > 60) throw new Error(`初始虚拟窗口节点过多: ${initialScale.rowNodes}`);
if (previewMs > 500) throw new Error(`10k 预览端到端耗时 ${previewMs}ms，超出 500ms 预算`);

const diffPerformance = await evaluate(`
  const { diffChars } = await import('/diff.mjs');
  const pairs = Array.from({ length: 27 }, (_, i) => [
    'IMG_' + String(i).padStart(5, '0') + '.JPG',
    'photo_' + String(i).padStart(5, '0') + '.jpg',
  ]);
  const started = performance.now();
  for (let round = 0; round < 200; round += 1) {
    for (const [before, after] of pairs) diffChars(before, after);
  }
  const elapsed = performance.now() - started;
  return { windows: 200, windowMs: elapsed / 200, rows: pairs.length };
`);
if (diffPerformance.windowMs >= 1) {
  throw new Error(`可见窗口 Diff 切片 ${diffPerformance.windowMs.toFixed(3)}ms，超出 1ms 预算`);
}

// Jump deep into the list and confirm only a viewport window exists.
await evaluate(`
  const vp = document.querySelector('#gridViewport');
  vp.scrollTop = 34 + 5000 * 36;
  return true;
`);
await sleep(500);
const deep = await evaluate(`
  const vp = document.querySelector('#gridViewport');
  const rows = [...document.querySelectorAll('#gridRows .grid-row')];
  return {
    rowNodes: rows.length,
    first: Number(rows[0]?.dataset.index || -1),
    last: Number(rows.at(-1)?.dataset.index || -1),
    scrollTop: vp.scrollTop,
    spacerHeight: Number.parseFloat(document.querySelector('#gridSpacer').style.height),
    gridOverflowX: vp.scrollWidth - vp.clientWidth,
  };
`);
if (deep.first < 4990 || deep.last > 5050) throw new Error(`虚拟窗口偏移异常: ${deep.first}..${deep.last}`);
if (deep.rowNodes > 60) throw new Error(`虚拟滚动保留节点过多: ${deep.rowNodes}`);

// Drive 60 animation frames while scrolling; measure the worst frame interval.
const frames = await evaluate(`
  const vp = document.querySelector('#gridViewport');
  const intervals = [];
  let last = performance.now();
  let count = 0;
  await new Promise((resolve) => {
    function step(now) {
      intervals.push(now - last);
      last = now;
      count += 1;
      vp.scrollTop += 480;
      if (count >= 60) resolve();
      else requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  const sorted = [...intervals].sort((a, b) => a - b);
  return {
    frames: intervals.length,
    avgMs: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted[sorted.length - 1],
    over25ms: intervals.filter((value) => value > 25).length,
    rowNodes: document.querySelectorAll('#gridRows .grid-row').length,
    spacerHeight: Number.parseFloat(document.querySelector('#gridSpacer').style.height),
  };
`);
if (frames.rowNodes > 60) throw new Error(`滚动后节点数异常: ${frames.rowNodes}`);
if (frames.over25ms > 6) throw new Error(`滚动帧率不稳: ${frames.over25ms} 帧超过 25ms`);

// Search debounce should settle on the final query, not an earlier response.
await evaluate(`
  const input = document.querySelector('#searchBox');
  input.value = 'BULK_09999.TXT';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.value = 'BULK_05000.TXT';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
`);
await waitFor(`document.querySelectorAll('#gridRows .grid-row').length === 1 && document.querySelector('#gridRows .grid-row .name')?.textContent === 'BULK_05000.TXT'`, {
  timeout: 10000,
  label: '搜索防抖',
});
await sleep(200);
const search = await evaluate(`
  const rows = [...document.querySelectorAll('#gridRows .grid-row')];
  return {
    rows: rows.length,
    names: rows.map((row) => row.querySelector('.name')?.textContent).filter(Boolean),
    empty: !document.querySelector('#gridEmpty').hidden,
  };
`);
if (search.rows !== 1 || search.names[0] !== 'BULK_05000.TXT') throw new Error(`搜索竞争防护失败: ${JSON.stringify(search)}`);

const summary = {
  ok: true,
  preset: loaded.preset,
  fixture,
  scanMs,
  previewMs,
  diffPerformance,
  total: initialScale.total,
  initialScale,
  deep,
  frames,
  search,
  consoleErrors,
};
console.log(JSON.stringify(summary, null, 2));
ws.close();
