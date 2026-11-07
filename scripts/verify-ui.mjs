#!/usr/bin/env node
// CDP acceptance probe for the local Web UI. No dependencies: uses Node 22+'s
// global WebSocket and the browser's DevTools Protocol endpoint.
//
// Usage:
//   node scripts/verify-ui.mjs --cdp http://127.0.0.1:9222 --out docs/ui.png
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (token.startsWith('--')) args.set(token.slice(2), process.argv[i + 1]);
}
const cdp = args.get('cdp') || 'http://127.0.0.1:9222';
const out = resolve(args.get('out') || 'docs/ui.png');
const outInspector = resolve(args.get('out-inspector') || 'docs/ui-inspector.png');
const preset = args.get('preset') || '';
const width = Math.max(900, Number(args.get('width') || 1440));
const height = Math.max(600, Number(args.get('height') || 900));

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
const events = [];
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
  events.push(message.method);
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
    }, 20000);
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, { timeout = 12000, label = expression } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await evaluate(`return Boolean(${expression});`);
    if (value) return;
    if (Date.now() - started > timeout) throw new Error(`等待超时: ${label}`);
    await sleep(100);
  }
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
await send('Page.reload', { ignoreCache: true });
await sleep(1200);
await waitFor("document.querySelector('#statusBadge')", { label: '页面完成渲染' });
await waitFor("Number(document.querySelector('#metrics .metric.total b')?.textContent) > 0", {
  timeout: 8000,
  label: '初始文件窗口',
});
await sleep(250);

const before = await evaluate(`
  const body = document.body;
  const main = document.querySelector('main');
  const rules = document.querySelector('.rules-panel').getBoundingClientRect();
  const files = document.querySelector('.files-panel').getBoundingClientRect();
  const grid = document.querySelector('#gridViewport');
  return {
    viewport: [window.innerWidth, window.innerHeight],
    bodyScroll: [body.scrollWidth, body.clientWidth, body.scrollHeight, body.clientHeight],
    docScroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    mainColumns: getComputedStyle(main).gridTemplateColumns,
    rules: [rules.x, rules.y, rules.width, rules.height],
    files: [files.x, files.y, files.width, files.height],
    rowHeight: getComputedStyle(document.querySelector('.grid-row') || document.querySelector('.grid-head')).height,
    gridOverflowX: grid ? grid.scrollWidth - grid.clientWidth : null,
    emptyVisible: !document.querySelector('#gridEmpty').hidden,
    ruleItems: document.querySelectorAll('.rule-item').length,
  };
`);

// Load the demo preset through the actual toolbar controls, not the API.
const loaded = await evaluate(`
  const select = document.querySelector('#presetSelect');
  const requested = ${JSON.stringify(preset)};
  const options = [...select.options].filter((item) => item.value);
  const option = requested ? options.find((item) => item.value === requested) : options[0];
  if (!option) return { ok: false, options: [] };
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('#btnLoadPreset').click();
  return { ok: true, preset: option.value };
`);
if (!loaded.ok) throw new Error('没有可载入的预设；请先在界面中保存一个预设');

await waitFor("document.querySelectorAll('.rule-item').length > 0", { label: '预设规则载入' });
await waitFor("document.querySelector('#statusBadge').textContent === '就绪'", { label: '预览完成' });
await sleep(500);

const after = await evaluate(`
  const stats = Object.fromEntries([...document.querySelectorAll('#metrics .metric')].map((item) => [
    item.querySelector('span').textContent,
    Number(item.querySelector('b').textContent),
  ]));
  const rows = [...document.querySelectorAll('#gridRows .grid-row')];
  const files = document.querySelector('.files-panel').getBoundingClientRect();
  const rules = document.querySelector('.rules-panel').getBoundingClientRect();
  return {
    metrics: stats,
    rowNodes: rows.length,
    scrollTop: document.querySelector('#gridViewport').scrollTop,
    delNodes: document.querySelectorAll('#gridRows del').length,
    insNodes: document.querySelectorAll('#gridRows ins').length,
    conflictRows: document.querySelectorAll('#gridRows .grid-row.conflict').length,
    readyRows: document.querySelectorAll('#gridRows .grid-row.ready').length,
    changedName: document.querySelector('#gridRows .grid-row .new')?.textContent || '',
    conflictTitle: document.querySelector('#gridRows .grid-row.conflict .st')?.title || '',
    conflictBadge: !document.querySelector('#btnFixConflicts').hidden,
    rulesX: rules.x, rulesWidth: rules.width,
    filesX: files.x, filesWidth: files.width,
    fileCount: document.querySelector('#fileCount').textContent,
    hasDrawer: Boolean(document.querySelector('#drawer')),
    gridOverflowX: document.querySelector('#gridViewport').scrollWidth - document.querySelector('#gridViewport').clientWidth,
    status: document.querySelector('#statusBadge').textContent,
  };
`);
if (!after.delNodes || !after.insNodes) throw new Error('新文件名没有 Diff 标记');
if (after.hasDrawer) throw new Error('旧抽屉仍在 DOM 中');
if (after.gridOverflowX > 0) throw new Error(`文件网格出现横向溢出 ${after.gridOverflowX}px`);
if (after.rulesX + after.rulesWidth > after.filesX + 1) throw new Error('左右面板重叠');

// Space on a focused row toggles selection through the same API path as the
// checkbox; restore it so the documentation screenshot is representative.
const spaceBefore = await evaluate(`return document.querySelector('#gridRows .grid-row input[type=checkbox]').checked;`);
await evaluate(`
  const row = document.querySelector('#gridRows .grid-row');
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  return true;
`);
await waitFor(`document.querySelector('#gridRows .grid-row input[type=checkbox]').checked === ${spaceBefore ? 'false' : 'true'}`, {
  label: 'Space 切换行选择',
});
const spaceAfter = await evaluate(`return document.querySelector('#gridRows .grid-row input[type=checkbox]').checked;`);
await evaluate(`
  const row = document.querySelector('#gridRows .grid-row');
  row.focus();
  row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  return true;
`);
await waitFor(`document.querySelector('#gridRows .grid-row input[type=checkbox]').checked === ${spaceBefore ? 'true' : 'false'}`, {
  label: 'Space 恢复行选择',
});
if (spaceAfter === spaceBefore) throw new Error('Space 没有切换行选择');

await evaluate(`document.activeElement?.blur(); document.querySelectorAll('.toast').forEach((item) => item.remove()); return true;`);
const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(out, Buffer.from(screenshot.data, 'base64'));
// Open the inline editor and confirm it stays inside the left column while the
// right-hand comparison grid remains visible and interactive.
await evaluate(`document.querySelector('.rule-item')?.click(); return true;`);
await waitFor("!document.querySelector('#ruleInspector').hidden", { label: '内联规则编辑器展开' });
await sleep(250);
const inspector = await evaluate(`
  const inspector = document.querySelector('#ruleInspector').getBoundingClientRect();
  const panel = document.querySelector('.rules-panel').getBoundingClientRect();
  const files = document.querySelector('.files-panel').getBoundingClientRect();
  return {
    inspector: [inspector.x, inspector.y, inspector.width, inspector.height],
    panel: [panel.x, panel.y, panel.width, panel.height],
    files: [files.x, files.y, files.width, files.height],
    visible: !document.querySelector('#ruleInspector').hidden,
    fields: document.querySelectorAll('#ruleFields .field').length,
    typeVisible: !document.querySelector('#inspectorTypeWrap').hidden,
    filesVisible: document.elementFromPoint(files.x + 80, files.y + 100) !== null,
  };
`);
if (!inspector.visible || !inspector.fields) throw new Error('内联编辑器没有渲染字段');
if (inspector.inspector.x + inspector.inspector.width > inspector.files.x + 1) throw new Error('内联编辑器越过左栏');
if (!inspector.filesVisible) throw new Error('右侧文件面板被编辑器遮挡');
await evaluate(`document.querySelectorAll('.toast').forEach((item) => item.remove()); return true;`);
const inspectorShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
writeFileSync(outInspector, Buffer.from(inspectorShot.data, 'base64'));

// Ctrl+N creates a fresh rule and focuses the first field; Escape closes it.
await evaluate(`
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true }));
  return true;
`);
await waitFor("!document.querySelector('#ruleInspector').hidden && document.querySelector('#inspectorKind').textContent === 'NEW'", {
  label: 'Ctrl+N 新建规则',
});
const hotkey = await evaluate(`
  const active = document.activeElement;
  return {
    open: !document.querySelector('#ruleInspector').hidden,
    kind: document.querySelector('#inspectorKind').textContent,
    activeTag: active?.tagName,
    activeId: active?.id || '',
  };
`);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
await waitFor("document.querySelector('#ruleInspector').hidden", { label: 'Escape 关闭编辑器' });

const beforeFix = await evaluate(`
  const metric = (label) => Number([...document.querySelectorAll('#metrics .metric')].find((item) => item.querySelector('span').textContent === label)?.querySelector('b').textContent || 0);
  return { conflicts: metric('冲突'), changed: metric('改变') };
`);
if (beforeFix.conflicts > 0) {
  await evaluate(`document.querySelector('#btnFixConflicts').click(); return true;`);
  await waitFor(`Number([...document.querySelectorAll('#metrics .metric')].find((item) => item.querySelector('span').textContent === '冲突')?.querySelector('b').textContent) === 0`, {
    label: '一键修复冲突',
  });
  await sleep(300);
}
const afterFix = await evaluate(`
  const metric = (label) => Number([...document.querySelectorAll('#metrics .metric')].find((item) => item.querySelector('span').textContent === label)?.querySelector('b').textContent || 0);
  return { conflicts: metric('冲突'), changed: metric('改变'), conflictRows: document.querySelectorAll('#gridRows .grid-row.conflict').length };
`);

const summary = {
  ok: true,
  preset: loaded.preset,
  before,
  after,
  space: { before: spaceBefore, after: spaceAfter },
  inspector,
  hotkey,
  beforeFix,
  afterFix,
  consoleErrors,
  screenshot: out,
  inspectorScreenshot: outInspector,
};
console.log(JSON.stringify(summary, null, 2));
ws.close();
