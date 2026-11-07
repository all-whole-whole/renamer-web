#!/usr/bin/env node
// Headless mode: run a saved preset against a directory without the browser.
//
//   node bin/cli.mjs --preset photos --dir "D:\Camera" --dry-run
//   node bin/cli.mjs --preset photos --dir "D:\Camera" --yes
//   node bin/cli.mjs --rules '[{"type":"case","mode":"lower"}]' --dir . --yes
import { resolve } from 'node:path';
import { scanPaths } from '../server/renamer/scanner.mjs';
import { runPreview } from '../server/renamer/engine.mjs';
import { createRules } from '../server/renamer/rules/index.mjs';
import { RenameTransaction, undoBatch } from '../server/renamer/transaction.mjs';
import { loadPresetRules, listPresets } from '../server/presets.mjs';

function parseArgs(argv) {
  const args = { dirs: [], yes: false, recurse: true, json: false, preset: '', rules: '', masks: '', undo: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--undo':
        args.undo = argv[++i];
        break;
      case '--preset':
        args.preset = argv[++i];
        break;
      case '--rules':
        args.rules = argv[++i];
        break;
      case '--dir':
        args.dirs.push(argv[++i]);
        break;
      case '--masks':
        args.masks = argv[++i];
        break;
      case '--yes':
        args.yes = true;
        break;
      case '--dry-run':
        args.yes = false;
        break;
      case '--no-recurse':
        args.recurse = false;
        break;
      case '--json':
        args.json = true;
        break;
      case '--list-presets':
        args.list = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`未知参数: ${arg}`);
        args.dirs.push(arg);
    }
  }
  return args;
}

function usage() {
  console.log(`renamer-web CLI

用法:
  node bin/cli.mjs --preset <名称> --dir <目录> [--yes] [--json]
  node bin/cli.mjs --rules '<JSON>' --dir <目录> [--yes]
  node bin/cli.mjs --list-presets

选项:
  --preset <名称>   使用已保存的预设
  --rules <JSON>    直接给规则数组（与页面里的规则栈同构）
  --dir <路径>      目标文件或目录（可重复）
  --masks <掩码>    如 "*.jpg;*.png"
  --yes             实际执行（缺省仅预览）
  --no-recurse      不递归子目录
  --json            以 JSON 输出结果
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (args.undo) {
    const result = await undoBatch(args.undo);
    console.log(`已撤销批次 ${result.batchId}：恢复 ${result.restored}/${result.total} 个文件`);
    return undefined;
  }

  if (args.list) {
    const presets = await listPresets();
    if (!presets.length) return console.log('（没有已保存的预设）');
    for (const p of presets) console.log(`${p.name.padEnd(24)} ${p.rules} 条规则  ${p.updatedAt || ''}`);
    return undefined;
  }

  if (!args.dirs.length) {
    usage();
    process.exitCode = 1;
    return undefined;
  }

  let rules = [];
  if (args.preset) rules = await loadPresetRules(args.preset);
  else if (args.rules) rules = createRules(JSON.parse(args.rules));
  if (!rules.length) {
    console.error('没有可用规则：请用 --preset 或 --rules 指定');
    process.exitCode = 1;
    return undefined;
  }

  const paths = args.dirs.map((d) => resolve(d));
  const { items } = await scanPaths(paths, { recurse: args.recurse, masks: args.masks, includeHidden: true, includeSystem: true });
  if (!items.length) {
    console.log('没有匹配到文件');
    return undefined;
  }

  const { stats } = runPreview(items, rules, {});
  const changed = items.filter((i) => i.status === 'ready');

  if (args.json) {
    console.log(JSON.stringify({ stats, changes: changed.map((i) => ({ from: i.originalName, to: i.newName, dir: i.dir })) }, null, 2));
  } else {
    console.log(`\n扫描 ${stats.total} 个文件：改变 ${stats.changed}，冲突 ${stats.conflicts}，错误 ${stats.errors}\n`);
    for (const item of changed.slice(0, 200)) {
      console.log(`  ${item.originalName}  ->  ${item.newName}`);
    }
    if (changed.length > 200) console.log(`  …另有 ${changed.length - 200} 项`);
    for (const item of items.filter((i) => i.status === 'conflict' || i.status === 'error').slice(0, 20)) {
      console.log(`  [!] ${item.originalName}: ${item.errorMessage}`);
    }
  }

  if (!args.yes) {
    if (!args.json) console.log('\n（预览模式，未改动磁盘；加 --yes 执行）');
    return undefined;
  }

  const tx = new RenameTransaction();
  const result = await tx.execute(items, {});
  console.log(`\n已重命名 ${result.count} 个文件，批次 ${result.batchId}`);
  console.log(`撤销：node bin/cli.mjs --undo ${result.batchId}`);
  return undefined;
}

main().catch((err) => {
  console.error(`错误: ${err.message}`);
  process.exit(1);
});
