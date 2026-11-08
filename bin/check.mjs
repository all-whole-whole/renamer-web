#!/usr/bin/env node
// Environment doctor: tells you exactly what is missing before you file a bug.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];

function record(name, ok, detail, hint) {
  results.push({ name, ok, detail, hint });
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  const ok = major >= 20;
  record('Node.js', ok, process.versions.node, ok ? '' : '需要 Node.js 20 或更高版本（22 LTS 推荐）');
}

function checkPlatform() {
  const ok = process.platform === 'win32';
  record('平台', ok, `${process.platform} ${process.arch}`, ok ? '' : '原生文件对话框与长路径支持仅在 Windows 上可用');
}

async function checkPowerShell() {
  if (process.platform !== 'win32') return record('PowerShell', false, '非 Windows', '跳过');
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    const version = stdout.trim();
    const major = Number(version.split('.')[0]);
    record('PowerShell', major >= 5, version, major >= 5 ? '' : '需要 Windows PowerShell 5.1（WinForms 对话框依赖）');
  } catch (err) {
    record('PowerShell', false, err.message, 'powershell.exe 不可用，原生文件选择将失效');
  }
}

async function checkDataDir() {
  const dir = process.env.RENAMER_WEB_DATA || join(process.env.APPDATA || '', 'renamer-web');
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = join(dir, `.probe-${Date.now()}`);
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.rm(probe, { force: true });
    record('数据目录', true, dir, '');
  } catch (err) {
    record('数据目录', false, dir, `不可写：${err.message}`);
  }
}

function checkAssets() {
  const required = ['public/index.html', 'public/diff.mjs', 'server/index.mjs', 'web/src/main.tsx'];
  const missing = required.filter((rel) => !existsSync(join(ROOT, rel)));
  record('静态资源', missing.length === 0, missing.length ? `缺少 ${missing.join(', ')}` : '齐全', missing.length ? '重新解压完整目录' : '');
}

async function checkPort() {
  let port = 8758;
  try {
    const cfg = JSON.parse(await fs.readFile(join(ROOT, 'config.json'), 'utf8'));
    port = Number(cfg.port) || port;
  } catch {
    /* default */
  }
  const free = await new Promise((resolveFree) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolveFree(false);
    });
    socket.on('error', () => resolveFree(true));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolveFree(true);
    });
  });
  record('端口', free, `${port} ${free ? '空闲' : '被占用'}`, free ? '' : '修改 config.json 里的 port，或关闭占用该端口的程序');
}

function checkRuntimeDeps() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {});
  record('第三方依赖', deps.length === 0, deps.length ? deps.join(', ') : '零依赖', deps.length ? '本工程不应引入运行时依赖' : '');
}

async function main() {
  checkNode();
  checkPlatform();
  await checkPowerShell();
  await checkDataDir();
  checkAssets();
  await checkPort();
  checkRuntimeDeps();

  const width = Math.max(...results.map((r) => r.name.length)) + 2;
  let failures = 0;
  console.log('\nrenamer-web 环境体检\n');
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    if (!r.ok) failures += 1;
    console.log(`  ${mark} ${r.name.padEnd(width)} ${r.detail}`);
    if (!r.ok && r.hint) console.log(`    ${' '.repeat(width)} → ${r.hint}`);
  }
  console.log('');
  if (failures === 0) {
    console.log('环境就绪。双击 start.cmd 即可启动。');
    process.exit(0);
  }
  console.log(`${failures} 项需要处理，详见上面的提示。`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
