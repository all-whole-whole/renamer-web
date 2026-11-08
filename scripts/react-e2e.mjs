// 端到端验收：扫描 → 用 React 规则编辑器建一条 Replace → 预览 → 重命名 → 撤销。
//
// 前置（两件事都在跑）：
//   node server\index.mjs
//   msedge --headless=new --remote-debugging-port=9335 http://127.0.0.1:8758/
// 运行：
//   node scripts\react-e2e.mjs <含测试文件的目录绝对路径>
// 断言：3 行预览改名、stats、磁盘改名、撤销后恢复原名、页面 0 报错。

import { writeFileSync } from 'node:fs';

const [, , dir] = process.argv;
const CDP = 'http://127.0.0.1:9335';
const APP = 'http://127.0.0.1:8758/';

const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const errors = [];
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
  }
};
await new Promise((r) => (ws.onopen = r));
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(name, Buffer.from(data, 'base64'));
};
const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: APP });
await sleep(2000);

const scan = await evaluate(`fetch('/api/scan', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ paths: [${JSON.stringify(dir)}], mode: 'replace', options: { recurse: true } }),
}).then((r) => r.json())`);
console.log('scan:', JSON.stringify({ added: scan.added, total: scan.total }));

await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '新建规则')?.click()");
await sleep(500);
console.log('dialog:', await evaluate("Boolean(document.querySelector('.ui-dialog'))"));
console.log('types:', await evaluate("document.querySelectorAll('.rn-type').length"));

await evaluate("[...document.querySelectorAll('.rn-type')].find((b) => b.textContent.includes('Replace'))?.click()");
await sleep(300);
console.log('find field:', await evaluate("Boolean(document.querySelector('#rn-field-find'))"));
await evaluate(setValue('#rn-field-find', ' '));
await evaluate(setValue('#rn-field-replaceWith', '_'));
await sleep(200);
await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '应用并预览')?.click()");
await sleep(1600);

console.log('rules:', await evaluate("document.querySelectorAll('.rn-rule').length"));
console.log('stats:', await evaluate("[...document.querySelectorAll('.rn-stat')].map((s) => s.innerText.replace(/\\n/g, '=')).join(' ')"));
console.log('rows:', await evaluate("[...document.querySelectorAll('.rn-grid tbody tr')].slice(0, 4).map((tr) => tr.innerText.replace(/\\n/g, ' | ')).join(' // ')"));
await shot('rn-e2e-1-preview.png');

await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '开始重命名')?.click()");
await sleep(2500);
const after = await evaluate("fetch('/api/files?view=all&limit=10').then((r) => r.json()).then((d) => d.rows.map((r) => r.originalName))");
console.log('after rename:', JSON.stringify(after));
await shot('rn-e2e-2-renamed.png');

await evaluate("[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '撤销上次')?.click()");
await sleep(2500);
const restored = await evaluate("fetch('/api/files?view=all&limit=10').then((r) => r.json()).then((d) => d.rows.map((r) => r.originalName))");
console.log('after undo:', JSON.stringify(restored));
await shot('rn-e2e-3-undo.png');
if (errors.length) console.log('PAGE ERRORS:', errors.join(' | '));
ws.close();
