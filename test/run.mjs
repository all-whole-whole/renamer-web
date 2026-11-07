#!/usr/bin/env node
// Self-contained test suite: rules, pipeline, conflicts, transaction, filters.
// No test framework, no dependencies — `node test/run.mjs`.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  symlinkSync,
  utimesSync,
} from 'node:fs';
import assert from 'node:assert/strict';

// Point the data directory at a throwaway location before any module reads it.
const DATA = mkdtempSync(join(tmpdir(), 'renamer-web-test-data-'));
process.env.RENAMER_WEB_DATA = DATA;

const { splitName } = await import('../server/renamer/rule-base.mjs');
const { createRule, RULE_META } = await import('../server/renamer/rules/index.mjs');
const { META_TAGS, expandMetaTags } = await import('../server/renamer/metatags.mjs');
const { runPreview, validateName } = await import('../server/renamer/engine.mjs');
const { validateAndResolveConflicts } = await import('../server/renamer/conflicts.mjs');
const { makeItem, scanPaths } = await import('../server/renamer/scanner.mjs');
const { RenameTransaction, undoBatch, listBatches, renameWithRetry, pruneUndoHistory } = await import(
  '../server/renamer/transaction.mjs'
);
const { isNameEligible, maskToRegExp } = await import('../server/renamer/filter.mjs');
const { diffChars } = await import('../public/diff.mjs');
const { isAllowedHost, isSameOrigin } = await import('../server/http-guard.mjs');
const { undoDir } = await import('../server/config.mjs');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'renamer-web-tx-'));
let passed = 0;
const failures = [];

async function run(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write('.');
  } catch (err) {
    failures.push({ name, err });
    process.stdout.write('F');
  }
}

const rule = (type, config) => createRule(type, config);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function applyRule(instance, fullName, ctx = {}) {
  const parts = splitName(fullName);
  const out = instance.apply(
    { ...parts, fullName },
    ctx.item ?? {},
    { index: ctx.index ?? 0, selectedIndex: ctx.selectedIndex, state: ctx.state ?? { counters: new Map() } },
  );
  if (typeof out === 'string') return out;
  return `${out.base ?? parts.base}${out.ext ?? parts.ext}`;
}

function write(name, content) {
  const full = join(work, name);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

/* ------------------------------ name model ------------------------------ */

await run('splitName: 普通 / 多点 / 点开头 / 无扩展名', () => {
  assert.deepEqual(splitName('a.txt'), { base: 'a', ext: '.txt' });
  assert.deepEqual(splitName('archive.tar.gz'), { base: 'archive.tar', ext: '.gz' });
  assert.deepEqual(splitName('.gitignore'), { base: '.gitignore', ext: '' });
  assert.deepEqual(splitName('noext'), { base: 'noext', ext: '' });
  assert.deepEqual(splitName('a.b.c', { firstDotIsExt: true }), { base: 'a', ext: '.b.c' });
});

await run('splitName: 双扩展名识别', () => {
  assert.deepEqual(splitName('archive.tar.gz', { detectDoubleExt: true }), { base: 'archive', ext: '.tar.gz' });
  assert.deepEqual(splitName('types.d.ts', { detectDoubleExt: true }), { base: 'types', ext: '.d.ts' });
  assert.deepEqual(splitName('photo.2024.jpg', { detectDoubleExt: true }), { base: 'photo.2024', ext: '.jpg' });
  assert.deepEqual(splitName('.tar.gz', { detectDoubleExt: true }), { base: '.tar', ext: '.gz' });
  assert.deepEqual(splitName('ARCHIVE.TAR.GZ', { detectDoubleExt: true }), { base: 'ARCHIVE', ext: '.TAR.GZ' });
});

await run('scan: 递归三级子目录并跟随 junction', async () => {
  const root = join(work, 'scan-deep');
  const outside = join(work, 'scan-outside');
  write('scan-deep/root.txt', 'root');
  write('scan-deep/level1/level1.txt', 'one');
  write('scan-deep/level1/level2/level2.txt', 'two');
  write('scan-outside/linked.txt', 'linked');
  symlinkSync(outside, join(root, 'linked'), 'junction');

  const { items, truncated, skippedDirs } = await scanPaths([root], {
    recurse: true,
    includeHidden: true,
    includeSystem: true,
  });
  assert.equal(truncated, false);
  assert.equal(skippedDirs, 0);
  assert.deepEqual(items.map((item) => item.originalName).sort(), ['level1.txt', 'level2.txt', 'linked.txt', 'root.txt']);
  assert.ok(items.some((item) => item.dir.includes('linked')), 'junction 下的文件必须被扫描');
});

/* --------------------------------- diff --------------------------------- */

function rebuild(ops, side) {
  return ops
    .filter((op) => op.type === 'same' || op.type === (side === 'old' ? 'del' : 'ins'))
    .map((op) => op.text)
    .join('');
}

await run('diff: 字符级 LCS 正确还原新旧文件名', () => {
  const cases = [
    ['IMG_001.JPG', 'photo_001.JPG'],
    ['a.txt', 'a.txt'],
    ['', 'new.txt'],
    ['remove-me.txt', ''],
    ['café.txt', 'cafe.txt'],
    ['photo_01.jpg', 'photo_02.jpg'],
    ['😀 old.txt', '😀 new.txt'],
  ];
  for (const [before, after] of cases) {
    const ops = diffChars(before, after);
    assert.equal(rebuild(ops, 'old'), before, `旧名还原失败: ${before} -> ${after}`);
    assert.equal(rebuild(ops, 'new'), after, `新名还原失败: ${before} -> ${after}`);
    assert.ok(ops.every((op) => op.text !== 'undefined'));
  }
  const changed = diffChars('photo_01.jpg', 'photo_02.jpg');
  assert.ok(changed.some((op) => op.type === 'del' && op.text === '1'));
  assert.ok(changed.some((op) => op.type === 'ins' && op.text === '2'));
});

await run('diff: 10k 短文件名比对性能预算', () => {
  const started = performance.now();
  for (let i = 0; i < 10000; i += 1) diffChars(`IMG_${i}.JPG`, `photo_${i}.JPG`);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 800, `10k diff 耗时 ${elapsed.toFixed(1)}ms，超出预算`);
});

/* -------------------------------- rules --------------------------------- */

await run('rules: 18 条元数据均具备双语标签、帮助、案例与字段提示', () => {
  assert.equal(RULE_META.length, 18);
  for (const meta of RULE_META) {
    assert.match(meta.label, /^[A-Za-z]+\s*\(.+\)$/, `${meta.type} 缺少双语标签`);
    assert.ok(meta.summary && meta.summary.length >= 6, `${meta.type} 缺少 summary`);
    assert.ok(meta.help && meta.help.length >= 20, `${meta.type} 缺少 help`);
    assert.ok(Array.isArray(meta.examples) && meta.examples.length >= 2, `${meta.type} 缺少 examples`);
    for (const field of meta.fields) {
      assert.ok(field.hint && field.hint.length >= 4, `${meta.type}.${field.key} 缺少 hint`);
      assert.match(field.label, /\([^)]*[A-Za-z][^)]*\)/, `${meta.type}.${field.key} 字段标签缺少英文`);
      if (field.kind === 'select') {
        for (const option of field.options || []) {
          assert.match(option.label, /\([^)]*[A-Za-z][^)]*\)/, `${meta.type}.${field.key} 选项缺少英文`);
        }
      }
    }
  }
  assert.ok(META_TAGS.length >= 10, '元标签目录过少');
  const taggedFields = RULE_META.flatMap((meta) =>
    meta.fields.filter((field) => field.metaTags).map((field) => `${meta.type}.${field.key}`),
  );
  for (const required of ['replace.find', 'replace.replaceWith', 'insert.text', 'regex.replacement']) {
    assert.ok(taggedFields.includes(required), `${required} 应支持元标签`);
  }
});

await run('case: 全大写只作用于主名', () => {
  assert.equal(applyRule(rule('case', { mode: 'upper' }), 'hello.txt'), 'HELLO.txt');
  assert.equal(applyRule(rule('case', { mode: 'upper', scope: 'both' }), 'hello.txt'), 'HELLO.TXT');
});

await run('replace: 默认忽略大小写', () => {
  assert.equal(applyRule(rule('replace', { find: 'IMG', replaceWith: 'PHOTO' }), 'img_1.jpg'), 'PHOTO_1.jpg');
  assert.equal(applyRule(rule('replace', { find: 'IMG', replaceWith: 'X', caseSensitive: true }), 'img_1.jpg'), 'img_1.jpg');
});

await run('replace: 通配符与全词', () => {
  assert.equal(applyRule(rule('replace', { find: 'a*b', replaceWith: 'X', wildcard: true }), 'a__b.txt'), 'X.txt');
  assert.equal(applyRule(rule('replace', { find: 'cat', replaceWith: 'dog', wholeWord: true }), 'cat copy.txt'), 'dog copy.txt');
  assert.equal(applyRule(rule('replace', { find: 'cat', replaceWith: 'dog', wholeWord: true }), 'concat.txt'), 'concat.txt');
});

await run('regex: 分组引用', () => {
  const r = rule('regex', { pattern: '\\[(.*?)\\]', replacement: '$1' });
  assert.equal(applyRule(r, 'photo [2024] big.jpg'), 'photo 2024 big.jpg');
});

await run('insert: 前缀 / 后缀 / 指定位置', () => {
  assert.equal(applyRule(rule('insert', { text: 'X_', at: 'prefix' }), 'a.txt'), 'X_a.txt');
  assert.equal(applyRule(rule('insert', { text: '_end', at: 'suffix' }), 'a.txt'), 'a_end.txt');
  assert.equal(applyRule(rule('insert', { text: '-', at: 'index', index: 2 }), 'abc.txt'), 'a-bc.txt');
});

await run('delete: 从开头 / 从结尾', () => {
  assert.equal(applyRule(rule('delete', { from: 'start', index: 1, count: 3 }), 'abcdef.txt'), 'def.txt');
  assert.equal(applyRule(rule('delete', { from: 'end', index: 4, count: 4 }), 'abcdef.txt'), 'ab.txt');
});

await run('padding: 左侧补零', () => {
  assert.equal(applyRule(rule('padding', { length: 5, char: '0' }), '42.txt'), '00042.txt');
});

await run('serialize: 递增并补零', () => {
  const r = rule('serialize', { start: 1, step: 1, padding: 2, separator: '_', position: 'suffix' });
  const state = { counters: new Map() };
  assert.equal(applyRule(r, 'a.jpg', { state }), 'a_01.jpg');
  assert.equal(applyRule(r, 'b.jpg', { state }), 'b_02.jpg');
  assert.equal(applyRule(r, 'c.jpg', { state }), 'c_03.jpg');
});

await run('strip: 清除数字与符号', () => {
  assert.equal(applyRule(rule('strip', { digits: true }), 'a1b2.txt'), 'ab.txt');
  assert.equal(applyRule(rule('strip', { symbols: true }), 'a-b_c.txt'), 'abc.txt');
});

await run('cleanup: 合并空格并去首尾', () => {
  assert.equal(applyRule(rule('cleanup', {}), '  a   b  .txt'), 'a b.txt');
  assert.equal(applyRule(rule('cleanup', {}), 'x..y.txt'), 'x.y.txt');
});

await run('translit: 西里尔转写', () => {
  assert.equal(applyRule(rule('translit', { mode: 'cyrillic' }), 'Привет.txt'), 'Privet.txt');
  assert.equal(applyRule(rule('translit', { mode: 'ascii' }), 'café.txt'), 'cafe.txt');
});

await run('rearrange: 按分隔符换位', () => {
  assert.equal(applyRule(rule('rearrange', { separator: ' - ', order: '2,1', joinWith: ' ' }), 'Artist - Title.txt'), 'Title Artist.txt');
});

await run('rearrange: 越界索引被忽略且不丢失片段', () => {
  assert.equal(applyRule(rule('rearrange', { separator: ' - ', order: '1,3,2', joinWith: ' ' }), 'A - B.txt'), 'A B.txt');
  assert.equal(applyRule(rule('rearrange', { separator: ' - ', order: '9', joinWith: ' ' }), 'A - B.txt'), 'A - B.txt');
  assert.equal(applyRule(rule('rearrange', { separator: ' - ', order: '2,2', joinWith: ' ' }), 'A - B.txt'), 'B B A.txt');
  assert.equal(applyRule(rule('rearrange', { separator: ' - ', order: '2,1', joinWith: ' ' }), 'A - B.JPG'), 'B A.JPG');
});

await run('remove: 全部 / 仅首个 / 区间', () => {
  assert.equal(applyRule(rule('remove', { text: 'x' }), 'xaxbx.txt'), 'ab.txt');
  assert.equal(applyRule(rule('remove', { text: 'x', occurrence: 'first' }), 'xaxbx.txt'), 'axbx.txt');
  assert.equal(applyRule(rule('remove', { mode: 'between', open: '(', close: ')' }), 'a(1)b(2).txt'), 'ab.txt');
});

await run('extension: 设置 / 移除 / 转小写', () => {
  assert.equal(applyRule(rule('extension', { mode: 'set', value: 'png' }), 'a.jpg'), 'a.png');
  assert.equal(applyRule(rule('extension', { mode: 'remove' }), 'a.jpg'), 'a');
  assert.equal(applyRule(rule('extension', { mode: 'lower' }), 'a.JPG'), 'a.jpg');
});

await run('extension: 双扩展名防御', () => {
  assert.equal(applyRule(rule('extension', { mode: 'remove' }), 'archive.tar.gz'), 'archive');
  assert.equal(applyRule(rule('extension', { mode: 'remove', detectDoubleExt: false }), 'archive.tar.gz'), 'archive.tar');
  assert.equal(applyRule(rule('extension', { mode: 'set', value: 'zip' }), 'archive.tar.gz'), 'archive.zip');
  assert.equal(applyRule(rule('extension', { mode: 'lower' }), 'TYPES.D.TS'), 'TYPES.d.ts');
  assert.equal(applyRule(rule('extension', { mode: 'remove' }), 'types.d.ts'), 'types');
  assert.equal(applyRule(rule('extension', { mode: 'remove' }), 'photo.2024.jpg'), 'photo.2024');
  assert.equal(applyRule(rule('extension', { mode: 'ensure', value: '.md' }), 'README'), 'README.md');
});

await run('script: 读写 FileName', () => {
  const r = rule('script', { source: "FileName = FileName.replace('IMG', 'PHOTO');" });
  assert.equal(applyRule(r, 'IMG_001.JPG'), 'PHOTO_001.JPG');
});

await run('reformatdate: 文件名日期重排与自动识别', () => {
  const explicit = rule('reformatdate', {
    source: 'name',
    sourceFormat: 'YYYYMMDD',
    targetFormat: 'YYYY-MM-DD',
  });
  assert.equal(applyRule(explicit, '20260320.jpg'), '2026-03-20.jpg');
  assert.equal(applyRule(rule('reformatdate', { source: 'name', targetFormat: 'YYYY-MM-DD' }), 'IMG_20260320.jpg'), 'IMG_2026-03-20.jpg');
  assert.equal(applyRule(rule('reformatdate', { source: 'name', targetFormat: 'YYYY/MM/DD' }), 'DSC_2026.03.20.jpg'), 'DSC_2026/03/20.jpg');
  assert.equal(
    applyRule(rule('reformatdate', { source: 'name', targetFormat: 'YYYYMMDD_HHmmss' }), 'IMG_2026-03-20_101500.jpg'),
    'IMG_20260320_101500.jpg',
  );
});

await run('reformatdate: 修改时间回填', () => {
  const full = write('dates/mtime.txt', 'date');
  const stamp = new Date(2021, 4, 6, 7, 8, 9);
  utimesSync(full, stamp, stamp);
  const item = makeItem(full);
  const r = rule('reformatdate', { source: 'modified', targetFormat: 'YYYY-MM-DD' });
  assert.equal(applyRule(r, 'mtime.txt', { item }), '2021-05-06.txt');
});

await run('list: mapping 字典替换与 sequential 行号替换', () => {
  const mapping = rule('list', {
    mode: 'mapping',
    separator: '->',
    content: 'IMG_001 -> Photo One\nIMG_002 -> Photo Two',
  });
  assert.equal(applyRule(mapping, 'IMG_001.jpg'), 'Photo One.jpg');
  assert.equal(applyRule(mapping, 'IMG_002.jpg'), 'Photo Two.jpg');
  assert.equal(applyRule(mapping, 'IMG_003.jpg'), 'IMG_003.jpg');

  const sequential = rule('list', { mode: 'sequential', content: 'first\nsecond' });
  assert.equal(applyRule(sequential, 'a.jpg', { index: 0 }), 'first.jpg');
  assert.equal(applyRule(sequential, 'b.jpg', { index: 1 }), 'second.jpg');
  assert.equal(applyRule(sequential, 'c.jpg', { index: 2 }), 'c.jpg');
  assert.equal(applyRule(sequential, 'b.jpg', { index: 9, selectedIndex: 1 }), 'second.jpg');
  assert.equal(applyRule(sequential, 'b.jpg', { item: { selected: false }, selectedIndex: 3 }), 'b.jpg');
});

await run('list: sequential 只按选中文件计数', () => {
  const items = [makeItem(join(work, 'seq-a.jpg')), makeItem(join(work, 'seq-b.jpg')), makeItem(join(work, 'seq-c.jpg'))];
  items[1].selected = false;
  runPreview(items, [rule('list', { mode: 'sequential', content: 'first\nsecond' })], { checkDisk: false });
  assert.equal(items[0].newName, 'first.jpg');
  assert.equal(items[1].newName, 'seq-b.jpg');
  assert.equal(items[2].newName, 'second.jpg');
});

await run('list: 等号/Tab/竖线分隔符与扩展名保留', () => {
  assert.equal(applyRule(rule('list', { mode: 'mapping', content: 'a=b' }), 'a.txt'), 'b.txt');
  assert.equal(applyRule(rule('list', { mode: 'mapping', content: 'a\tb' }), 'a.txt'), 'b.txt');
  assert.equal(applyRule(rule('list', { mode: 'mapping', content: 'a|b' }), 'a.txt'), 'b.txt');
  assert.equal(applyRule(rule('list', { mode: 'mapping', content: 'a,b' }), 'a.txt'), 'b.txt');
  assert.equal(applyRule(rule('list', { mode: 'mapping', content: 'a=renamed.txt' }), 'a.txt'), 'renamed.txt');
});

await run('randomize: UUID 格式与固定长度随机串', () => {
  const uuid = applyRule(rule('randomize', { charset: 'uuid' }), 'secret.pdf');
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/);

  const digits = applyRule(rule('randomize', { charset: 'digits', length: 12 }), 'x.txt');
  assert.match(digits, /^\d{12}\.txt$/);
  const alpha = applyRule(rule('randomize', { charset: 'alphanumeric', length: 16, position: 'suffix' }), 'name.txt');
  assert.match(alpha, /^name_[A-Za-z0-9]{16}\.txt$/);
  const hex = applyRule(rule('randomize', { charset: 'hex', length: 24 }), 'x.bin');
  assert.match(hex, /^[0-9a-f]{24}\.bin$/);
});

await run('userinput: 文件夹/原名/体积/序号模板', () => {
  const item = { dir: join(work, 'Trip'), size: 12 * 1024 * 1024 };
  assert.equal(
    applyRule(rule('userinput', { template: '[:folder:]_[:name:]' }), 'photo.jpg', { item }),
    'Trip_photo.jpg',
  );
  assert.equal(
    applyRule(rule('userinput', { template: '[:name:]_[:size:]' }), 'clip.mp4', { item }),
    'clip_12MB.mp4',
  );
  assert.equal(
    applyRule(rule('userinput', { template: '[:index:]_[:name:][:ext:]' }), 'a.jpg', { index: 2 }),
    '3_a.jpg',
  );
  assert.equal(
    applyRule(rule('userinput', { template: '[:index:]_[:name:]' }), 'a.jpg', { index: 9, selectedIndex: 0 }),
    '1_a.jpg',
  );
  const sized = write('userinput/size.bin', 'x'.repeat(1536));
  assert.equal(
    applyRule(rule('userinput', { template: '[:name:]_[:size:]' }), 'size.bin', { item: makeItem(sized) }),
    'size_1.5KB.bin',
  );
});

await run('metatags: 插入/替换使用文件夹、时间、体积标签', () => {
  const item = {
    dir: join(work, 'Trip'),
    originalName: 'photo.jpg',
    size: 12 * 1024 * 1024,
    mtime: new Date(2021, 4, 6, 7, 8, 9).getTime(),
  };
  assert.equal(
    applyRule(rule('insert', { text: '[:File_FolderName:]_', at: 'prefix' }), 'photo.jpg', { item }),
    'Trip_photo.jpg',
  );
  assert.equal(
    applyRule(rule('insert', { text: '[:File_Size:]_', at: 'prefix' }), 'photo.jpg', { item }),
    '12MB_photo.jpg',
  );
  assert.equal(
    applyRule(rule('replace', { find: 'photo', replaceWith: '[:File_FolderName:]' }), 'photo.jpg', { item }),
    'Trip.jpg',
  );
  assert.equal(
    applyRule(
      rule('insert', { text: '[:File_DateModified:]_', at: 'prefix' }),
      'photo.jpg',
      { item },
    ),
    '2021-05-06_070809_photo.jpg',
  );
  assert.match(
    applyRule(rule('insert', { text: '[:Date_Now:]_', at: 'prefix' }), 'a.txt'),
    /^\d{4}-\d{2}-\d{2}_\d{6}_a\.txt$/,
  );
  assert.equal(
    expandMetaTags('x_[:File_Name:]_[:File_Extension:]', { item, parts: { base: 'photo', ext: '.jpg' } }),
    'x_photo.jpg_.jpg',
  );
  assert.equal(expandMetaTags('[:Not_A_Real_Tag:]', { item }), '[:Not_A_Real_Tag:]');
});

await run('script: 死循环被超时中断', () => {
  const r = rule('script', { source: 'while (true) {}', timeoutMs: 30 });
  assert.throws(() => applyRule(r, 'a.txt'), /脚本执行失败|timed out/i);
});

await run('engine: 单条规则抛错被隔离为非 Error 错误', () => {
  const items = [makeItem(join(work, 'isolate.txt'))];
  const bomb = { type: 'bomb', enabled: true, apply() { throw 'boom'; } };
  const { stats } = runPreview(items, [bomb], { checkDisk: false });
  assert.equal(items[0].status, 'error');
  assert.match(items[0].errorMessage, /bomb/);
  assert.equal(stats.errors, 1);
  assert.equal(items[0].newName, 'isolate.txt', '错误项应回退原名');
});

/* ------------------------------- pipeline -------------------------------- */

await run('engine: 规则按顺序叠加且从原名重算', () => {
  const items = [makeItem(join(work, 'IMG_001.JPG'))];
  runPreview(items, [rule('case', { mode: 'lower' }), rule('replace', { find: 'img', replaceWith: 'photo' })], {});
  assert.equal(items[0].newName, 'photo_001.JPG', 'case 只作用于主名，扩展名保持原样');
  assert.equal(items[0].status, 'ready');

  runPreview(items, [], {});
  assert.equal(items[0].newName, 'IMG_001.JPG', '清空规则后必须从原名重算');
  assert.equal(items[0].status, 'unchanged');
});

await run('engine: 非法字符与保留设备名进入 error', () => {
  const bad = [makeItem(join(work, 'a.txt'))];
  runPreview(bad, [rule('replace', { find: 'a', replaceWith: 'x/y' })], {});
  assert.equal(bad[0].status, 'error');
  assert.match(bad[0].errorMessage, /非法字符/);

  const reserved = [makeItem(join(work, 'b.txt'))];
  runPreview(reserved, [rule('replace', { find: 'b', replaceWith: 'CON' })], {});
  assert.equal(reserved[0].status, 'error');
});

await run('engine: 扩展名尾部点/空格也按 Win32 规则拒绝', () => {
  assert.equal(validateName('photo', '.txt'), null);
  assert.match(validateName('photo', '.txt '), /点或空格结尾/);
  assert.match(validateName('photo', '.txt.'), /点或空格结尾/);
  assert.match(validateName('photo', ' '), /点或空格结尾/);

  const trailing = [makeItem(join(work, 'c.txt'))];
  runPreview(trailing, [rule('regex', { pattern: '\\.txt$', replacement: '.txt ', target: 'full' })], {});
  assert.equal(trailing[0].status, 'error');
  assert.match(trailing[0].errorMessage, /点或空格结尾/);
});

await run('engine: 未变化标记为 unchanged', () => {
  const items = [makeItem(join(work, 'same.txt'))];
  runPreview(items, [rule('case', { mode: 'lower' })], {});
  assert.equal(items[0].status, 'unchanged');
});

/* ------------------------------- conflicts ------------------------------- */

await run('conflicts: 批次内重名标记冲突', () => {
  const dir = join(work, 'c1');
  const a = makeItem(join(dir, 'one.txt'));
  const b = makeItem(join(dir, 'two.txt'));
  a.newName = 'same.txt';
  b.newName = 'same.txt';
  const report = validateAndResolveConflicts([a, b], { autoFixConflicts: false, checkDisk: false });
  assert.equal(a.status, 'conflict');
  assert.equal(b.status, 'conflict');
  assert.equal(report.duplicateGroups, 1);
});

await run('conflicts: 自动修复追加 _1/_2', () => {
  const dir = join(work, 'c2');
  const items = ['one', 'two', 'three'].map((n) => makeItem(join(dir, `${n}.txt`)));
  for (const item of items) item.newName = 'same.txt';
  const report = validateAndResolveConflicts(items, { autoFixConflicts: true, checkDisk: false });
  assert.equal(report.fixed, 2);
  assert.equal(items[0].newName, 'same.txt');
  assert.equal(items[1].newName, 'same_1.txt');
  assert.equal(items[2].newName, 'same_2.txt');
  assert.equal(items[1].newBase, 'same_1.txt'.slice(0, -4));
  assert.equal(items[1].newExt, '.txt');
});

await run('conflicts: 600 个同名目标无 500 上限死循环', () => {
  const dir = join(work, 'c600');
  const items = [];
  for (let i = 0; i < 600; i += 1) {
    const item = makeItem(join(dir, `source-${i}.txt`));
    item.newName = 'same.txt';
    items.push(item);
  }
  const report = validateAndResolveConflicts(items, { autoFixConflicts: true, checkDisk: false });
  assert.equal(report.fixed, 599);
  assert.equal(report.conflictCount, 0);
  assert.equal(items[0].newName, 'same.txt');
  assert.equal(items[1].newName, 'same_1.txt');
  assert.equal(items[599].newName, 'same_599.txt');
  assert.equal(new Set(items.map((item) => item.newName)).size, 600);
});

await run('conflicts: 自动修复磁盘同名（避开已有 _1）', () => {
  const dir = join(work, 'c-disk-fix');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'same.txt'), 'x', 'utf8');
  writeFileSync(join(dir, 'same_1.txt'), 'x', 'utf8');
  const item = makeItem(join(dir, 'source.txt'));
  item.newName = 'same.txt';
  const report = validateAndResolveConflicts([item], { autoFixConflicts: true, checkDisk: true });
  assert.equal(report.fixed, 1);
  assert.equal(item.status, 'ready');
  assert.equal(item.newName, 'same_2.txt');
  assert.equal(item.newBase, 'same_2');
  assert.equal(item.newExt, '.txt');
});

await run('conflicts: 极端长文件名修复不越过 255 字符', () => {
  const dir = join(work, 'c-long');
  const longBase = 'L'.repeat(250);
  const items = [0, 1, 2].map((i) => {
    const item = makeItem(join(dir, `source-${i}.txt`));
    item.newName = `${longBase}.txt`;
    return item;
  });
  validateAndResolveConflicts(items, { autoFixConflicts: true, checkDisk: false });
  assert.equal(items[0].status, 'ready');
  assert.ok(items.every((item) => item.newName.length <= 255), '修复后的名称必须符合 Windows 255 字符上限');
  assert.equal(new Set(items.map((item) => item.newName)).size, 3);
});

await run('conflicts: 撞到磁盘已存在文件', () => {
  const dir = join(work, 'c3');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'exists.txt'), 'x', 'utf8');
  const item = makeItem(join(dir, 'source.txt'));
  item.newName = 'exists.txt';
  validateAndResolveConflicts([item], { autoFixConflicts: false, checkDisk: true });
  assert.equal(item.status, 'conflict');
  assert.match(item.errorMessage, /已存在/);
});

await run('conflicts: 无变化文件占位只标记改名项', () => {
  const dir = join(work, 'c-unchanged');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'photo.jpg'), 'x', 'utf8');
  const unchanged = makeItem(join(dir, 'photo.jpg'));
  unchanged.status = 'unchanged';
  const changing = makeItem(join(dir, 'IMG.jpg'));
  changing.newName = 'photo.jpg';
  const report = validateAndResolveConflicts([unchanged, changing], { autoFixConflicts: false, checkDisk: true });
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(changing.status, 'conflict');
  assert.match(changing.errorMessage, /目标已存在：photo\.jpg/);
  assert.equal(report.conflictCount, 1);

  const autoChanging = makeItem(join(dir, 'DSC.jpg'));
  autoChanging.newName = 'photo.jpg';
  const fixed = validateAndResolveConflicts([unchanged, autoChanging], { autoFixConflicts: true, checkDisk: true });
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(autoChanging.status, 'ready');
  assert.equal(autoChanging.newName, 'photo_1.jpg');
  assert.equal(fixed.fixed, 1);
});

/* ------------------------------ transaction ------------------------------ */

await run('transaction: 两阶段落盘并保留内容', async () => {
  write('t1/a1.txt', 'A1');
  write('t1/a2.txt', 'A2');
  const items = [makeItem(join(work, 't1/a1.txt')), makeItem(join(work, 't1/a2.txt'))];
  items[0].newName = 'b1.txt';
  items[1].newName = 'b2.txt';
  const tx = new RenameTransaction('t-roundtrip');
  const result = await tx.execute(items, {});
  assert.equal(result.count, 2);
  assert.ok(existsSync(join(work, 't1/b1.txt')));
  assert.equal(readFileSync(join(work, 't1/b1.txt'), 'utf8'), 'A1');
  assert.equal(readFileSync(join(work, 't1/b2.txt'), 'utf8'), 'A2');
});

await run('undo: 依据日志完整恢复', async () => {
  const result = await undoBatch('t-roundtrip');
  assert.equal(result.restored, 2);
  assert.ok(existsSync(join(work, 't1/a1.txt')));
  assert.equal(readFileSync(join(work, 't1/a1.txt'), 'utf8'), 'A1');
  const batches = await listBatches(5);
  assert.equal(batches.some((b) => b.batchId === 't-roundtrip'), false, '撤销后日志应被移除');
});

await run('transaction: 仅大小写变更也能生效', async () => {
  write('t2/Case.txt', 'C');
  const items = [makeItem(join(work, 't2/Case.txt'))];
  items[0].newName = 'case.txt';
  const tx = new RenameTransaction('t-case');
  await tx.execute(items, {});
  assert.ok(existsSync(join(work, 't2/case.txt')));
  const names = (await import('node:fs')).readdirSync(join(work, 't2'));
  assert.deepEqual(names, ['case.txt']);
});

await run('transaction: A/B 互换不死锁', async () => {
  write('t3/s1.txt', 'S1');
  write('t3/s2.txt', 'S2');
  const a = makeItem(join(work, 't3/s1.txt'));
  const b = makeItem(join(work, 't3/s2.txt'));
  a.newName = 's2.txt';
  b.newName = 's1.txt';
  const tx = new RenameTransaction('t-swap');
  await tx.execute([a, b], {});
  assert.equal(readFileSync(join(work, 't3/s1.txt'), 'utf8'), 'S2');
  assert.equal(readFileSync(join(work, 't3/s2.txt'), 'utf8'), 'S1');
});

await run('transaction: Windows EPERM/EBUSY 微重试后成功', async () => {
  let calls = 0;
  const result = await renameWithRetry('from', 'to', {
    retries: 3,
    delayMs: 1,
    rename: async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error('sharing violation'), { code: calls === 1 ? 'EPERM' : 'EBUSY' });
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.attempts, 3);
});

await run('transaction: 重试耗尽后抛错且只重试可恢复错误', async () => {
  let retryableCalls = 0;
  await assert.rejects(
    renameWithRetry('from', 'to', {
      retries: 3,
      delayMs: 1,
      rename: async () => {
        retryableCalls += 1;
        throw Object.assign(new Error('locked'), { code: 'EPERM' });
      },
    }),
    /locked/,
  );
  assert.equal(retryableCalls, 4, '首次尝试 + 3 次重试');

  let hardCalls = 0;
  await assert.rejects(
    renameWithRetry('from', 'to', {
      retries: 3,
      delayMs: 1,
      rename: async () => {
        hardCalls += 1;
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    }),
    /missing/,
  );
  assert.equal(hardCalls, 1, 'ENOENT 不应重试');
});

await run('undo: 按数量与 30 天窗口回收历史日志', async () => {
  for (const name of readdirSync(undoDir)) {
    if (name.endsWith('.json')) rmSync(join(undoDir, name), { force: true });
  }
  const now = Date.now();
  const names = ['prune-a', 'prune-b', 'prune-c', 'prune-d'];
  for (let i = 0; i < names.length; i += 1) {
    const file = join(undoDir, `${names[i]}.json`);
    writeFileSync(file, JSON.stringify({ batchId: names[i], createdAt: new Date(now).toISOString(), count: 1, entries: [] }), 'utf8');
    const stamp = now - i * 24 * 60 * 60 * 1000;
    utimesSync(file, new Date(stamp), new Date(stamp));
  }
  const old = join(undoDir, 'prune-ancient.json');
  writeFileSync(old, JSON.stringify({ batchId: 'prune-ancient', createdAt: '2000-01-01', count: 1, entries: [] }), 'utf8');
  const ancient = now - 40 * 24 * 60 * 60 * 1000;
  utimesSync(old, new Date(ancient), new Date(ancient));

  const result = await pruneUndoHistory({ max: 2, maxAgeDays: 30, now });
  assert.ok(result.removed >= 2);
  assert.equal(existsSync(join(undoDir, 'prune-a.json')), true, '最新记录应保留');
  assert.equal(existsSync(join(undoDir, 'prune-b.json')), true, '次新记录应保留');
  assert.equal(existsSync(join(undoDir, 'prune-c.json')), false, '超过数量上限应回收');
  assert.equal(existsSync(old), false, '超过 30 天应回收');
  assert.ok(readdirSync(undoDir).filter((name) => name.endsWith('.json')).length <= 2);
});

/* -------------------------------- filters -------------------------------- */

await run('filter: 掩码包含/排除', () => {
  assert.equal(maskToRegExp('*.jpg').test('a.jpg'), true);
  assert.equal(maskToRegExp('*.jpg').test('a.jpeg'), false);
  assert.equal(isNameEligible('a.jpg', '*.jpg;*.png', ''), true);
  assert.equal(isNameEligible('a.gif', '*.jpg;*.png', ''), false);
  assert.equal(isNameEligible('a.tmp', '', '*.tmp'), false);
  assert.equal(isNameEligible('anything.bin', '', ''), true);
});

/* ------------------------------- http guard ------------------------------ */

await run('http guard: Host 与 Origin 必须精确匹配', () => {
  const bind = { host: '127.0.0.1', port: 8758 };
  assert.equal(isAllowedHost('127.0.0.1:8758', bind), true);
  assert.equal(isAllowedHost('localhost:8758', bind), true);
  assert.equal(isAllowedHost('127.0.0.1:9999', bind), false);
  assert.equal(isAllowedHost('evil.test:8758', bind), false);
  assert.equal(isAllowedHost('', bind), false);

  assert.equal(isSameOrigin(undefined, '127.0.0.1:8758', bind), true);
  assert.equal(isSameOrigin('http://127.0.0.1:8758', '127.0.0.1:8758', bind), true);
  assert.equal(isSameOrigin('http://localhost:8758', 'localhost:8758', bind), true);
  assert.equal(isSameOrigin('http://evil.test', '127.0.0.1:8758', bind), false);
  assert.equal(isSameOrigin('http://127.0.0.1:8758.evil.test', '127.0.0.1:8758', bind), false);
  assert.equal(isSameOrigin('https://127.0.0.1:8758', '127.0.0.1:8758', bind), false);
});

/* --------------------------- HTTP integration --------------------------- */

await run('http: append 扫描立即失效 view 缓存，跨源写请求被拒绝', async () => {
  const fixture = join(work, 'http-fixture');
  mkdirSync(fixture, { recursive: true });
  writeFileSync(join(fixture, 'one.txt'), 'one', 'utf8');

  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));

  const child = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      RENAMER_WEB_PORT: String(port),
      RENAMER_WEB_DATA: DATA,
      RENAMER_WEB_NO_IDLE: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });
  const base = `http://127.0.0.1:${port}`;
  const request = async (path, init = {}) => {
    const response = await fetch(`${base}${path}`, init);
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: response.status, body };
  };
  const post = (path, payload, origin) =>
    request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(origin ? { origin } : {}),
      },
      body: JSON.stringify(payload),
    });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const ping = await request('/api/ping');
        if (ping.status === 200 && ping.body?.app === 'renamer-web') {
          ready = true;
          break;
        }
      } catch {
        /* host is still starting */
      }
      await sleep(100);
    }
    assert.equal(ready, true, `宿主未启动: ${stderr.slice(0, 400)}`);

    await post('/api/clear', {});
    const first = await post('/api/scan', {
      paths: [fixture],
      mode: 'replace',
      autoPreview: false,
      options: { recurse: false },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.added, 1);

    const draft = await post('/api/preview', {
      transient: true,
      rules: [{ type: 'insert', enabled: true, text: 'X_', at: 'prefix' }],
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.stats.changed, 1);
    const blockedRename = await post('/api/rename', {});
    assert.equal(blockedRename.status, 409, '草稿预览期间必须拒绝改名');

    const committed = await post('/api/preview', { rules: [] });
    assert.equal(committed.status, 200);
    const restored = await request('/api/files?view=all&offset=0&limit=10');
    assert.equal(restored.body.rows[0].newName, 'one.txt', '退出草稿后必须恢复已提交规则的预览');

    const before = await request('/api/files?view=all&offset=0&limit=10');
    assert.equal(before.body.total, 1, '第一次查询应建立 view=all 缓存');

    writeFileSync(join(fixture, 'two.txt'), 'two', 'utf8');
    const second = await post('/api/scan', {
      paths: [join(fixture, 'two.txt')],
      mode: 'append',
      autoPreview: false,
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.added, 1);
    assert.equal(second.body.total, 2);

    const after = await request('/api/files?view=all&offset=0&limit=10');
    assert.equal(after.body.total, 2, 'append 后缓存必须失效，不能只返回旧总数');
    assert.equal(after.body.rows.length, 2);

    const foreign = await post('/api/clear', {}, `http://127.0.0.1:${port}.evil.test`);
    assert.equal(foreign.status, 403, '子串包含式 Origin 校验必须被拒绝');
    const stillThere = await request('/api/files?view=all&offset=0&limit=1');
    assert.equal(stillThere.body.total, 2, '被拒绝的跨源请求不能改动状态');
  } finally {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    await post('/api/shutdown', {}).catch(() => {});
    await Promise.race([exited, sleep(2000)]);
    if (child.exitCode === null) child.kill();
  }
});

/* ------------------------------- throughput ------------------------------ */

await run('performance: 10k 项预览在 500ms 内完成', () => {
  const items = [];
  for (let i = 0; i < 10000; i += 1) items.push(makeItem(join(work, 'bulk', `IMG_${String(i).padStart(5, '0')}.JPG`)));
  const rules = [rule('case', { mode: 'lower' }), rule('replace', { find: 'img', replaceWith: 'photo' }), rule('serialize', { padding: 4 })];
  const started = Date.now();
  const { stats } = runPreview(items, rules, {});
  const elapsed = Date.now() - started;
  assert.equal(stats.total, 10000);
  assert.ok(elapsed < 500, `10k 预览耗时 ${elapsed}ms，超出预算`);
});

/* -------------------------------- report --------------------------------- */

console.log('');
if (failures.length) {
  console.log(`\n${passed} 通过，${failures.length} 失败\n`);
  for (const f of failures) {
    console.log(`✗ ${f.name}`);
    console.log(`  ${String(f.err && f.err.message).split('\n')[0]}`);
  }
  rmSync(work, { recursive: true, force: true });
  rmSync(DATA, { recursive: true, force: true });
  process.exit(1);
}
console.log(`\n全部 ${passed} 项通过\n`);
rmSync(work, { recursive: true, force: true });
rmSync(DATA, { recursive: true, force: true });
process.exit(0);
