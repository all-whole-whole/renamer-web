// Rule registry: maps ReNamer's TRule* classes onto JS implementations and
// publishes the parameter schema the drawer renders (single source of truth,
// so the UI never drifts from the engine).
import CaseRule from './case.mjs';
import CleanUpRule from './cleanup.mjs';
import DeleteRule from './delete.mjs';
import ExtensionRule from './extension.mjs';
import InsertRule from './insert.mjs';
import ListRule from './list.mjs';
import PaddingRule from './padding.mjs';
import RandomizeRule from './randomize.mjs';
import ReformatDateRule from './reformatdate.mjs';
import RegExRule from './regex.mjs';
import RemoveRule from './remove.mjs';
import RearrangeRule from './rearrange.mjs';
import ReplaceRule from './replace.mjs';
import ScriptRule from './script.mjs';
import SerializeRule from './serialize.mjs';
import StripRule from './strip.mjs';
import TranslitRule from './translit.mjs';
import UserInputRule from './userinput.mjs';

export const RULE_CLASSES = {
  replace: ReplaceRule,
  regex: RegExRule,
  insert: InsertRule,
  delete: DeleteRule,
  remove: RemoveRule,
  rearrange: RearrangeRule,
  extension: ExtensionRule,
  strip: StripRule,
  case: CaseRule,
  serialize: SerializeRule,
  cleanup: CleanUpRule,
  padding: PaddingRule,
  translit: TranslitRule,
  script: ScriptRule,
  reformatdate: ReformatDateRule,
  list: ListRule,
  randomize: RandomizeRule,
  userinput: UserInputRule,
};

const OPT = (...values) => values.map((v) => ({ value: v[0], label: v[1] }));
const F = (key, label, kind, value, hint, extra = {}) => ({ key, label, kind, default: value, hint, ...extra });

export const RULE_META = [
  {
    type: 'replace',
    label: 'Replace (替换)',
    renamerClass: 'TRuleReplace',
    summary: '查找替换文本，支持通配符、全词与大小写匹配。',
    help:
      '最常用的规则。默认忽略大小写并替换所有命中；勾选「全词匹配」可避免把 cat 替换到 concat 里，' +
      '勾选「通配符」后 * 匹配任意长度、? 匹配单个字符。只作用于主文件名，扩展名不受影响。' +
      '查找与替换文本都可点击「🏷 插入元标签」，例如 [:File_FolderName:]、[:Date_Now:]。',
    examples: [
      { input: 'IMG_001.JPG', config: { find: 'IMG', replaceWith: 'PHOTO' }, output: 'PHOTO_001.JPG' },
      { input: 'my photo.txt', config: { find: ' ', replaceWith: '_' }, output: 'my_photo.txt' },
      {
        input: 'cat copy.txt',
        config: { find: 'cat', replaceWith: 'dog', wholeWord: true },
        output: 'dog copy.txt',
      },
    ],
    fields: [
      F('find', '查找内容 (Find)', 'text', '', '要查找的字面文本；勾选通配符后可用 * 和 ?', { metaTags: true }),
      F('replaceWith', '替换为 (Replace With)', 'text', '', '命中后写入的新文本，留空表示删除命中内容', { metaTags: true }),
      F('caseSensitive', '区分大小写 (Case Sensitive)', 'bool', false, '开启后 IMG 与 img 视为不同文本'),
      F('wholeWord', '全词匹配 (Whole Word)', 'bool', false, '只匹配完整单词，避免命中单词内部片段'),
      F('wildcard', '通配符 (Wildcard)', 'bool', false, '把 * 当作任意长度、? 当作单个字符'),
      {
        key: 'occurrence',
        label: '替换次数 (Occurrence)',
        kind: 'select',
        default: 'all',
        hint: '选择替换全部命中还是只替换第一个',
        options: OPT(['all', '全部 (All)'], ['first', '仅首个 (First)']),
      },
    ],
  },
  {
    type: 'regex',
    label: 'RegEx (正则表达式)',
    renamerClass: 'TRuleRegEx',
    summary: '使用正则表达式进行强大模式匹配与分组引用。',
    help:
      '适合处理带固定模式的名字，例如删除方括号内容、提取日期或重排编号。替换文本可用 $1、$2 引用捕获组；' +
      '标志默认 g（全部替换），可加入 i（忽略大小写）。目标为「完整名」时正则能看到扩展名。' +
      '替换文本支持「🏷 插入元标签」，但正则表达式本身不展开标签，避免转义歧义。',
    examples: [
      {
        input: 'photo [2024] big.jpg',
        config: { pattern: '\\[(.*?)\\]', replacement: '$1' },
        output: 'photo 2024 big.jpg',
      },
      {
        input: 'IMG_001.JPG',
        config: { pattern: '(IMG)_(\\d+)', replacement: '$2-$1' },
        output: '001-IMG.JPG',
      },
      {
        input: 'report.final.pdf',
        config: { pattern: '\\.final$', replacement: '', target: 'full' },
        output: 'report.pdf',
      },
    ],
    fields: [
      F('pattern', '正则表达式 (Pattern)', 'text', '\\[.*?\\]', 'JavaScript 正则，不含首尾斜杠'),
      F('replacement', '替换为 (Replacement)', 'text', '', '可用 $1、$2 引用捕获组，留空表示删除', { metaTags: true }),
      F('flags', '标志 (Flags)', 'text', 'g', '常用 g（全部）、i（忽略大小写）、m（多行）'),
      {
        key: 'target',
        label: '作用范围 (Target)',
        kind: 'select',
        default: 'base',
        hint: '主名不包含扩展名；完整名可匹配扩展名',
        options: OPT(['base', '主名 (Base)'], ['full', '完整名 (Full)']),
      },
    ],
  },
  {
    type: 'insert',
    label: 'Insert (插入)',
    renamerClass: 'TRuleInsert',
    summary: '在开头、结尾或指定位置插入固定文本。',
    help:
      '常用于给文件添加统一项目前缀（如 [2026] ）、版本后缀或在特定位置注入标记。可选择跳过扩展名。' +
      '文本框支持「🏷 插入元标签」，例如 [:File_FolderName:]、[:File_DateModified:]、[:File_Size:]。',
    examples: [
      { input: 'photo.jpg', config: { text: 'DSC_', at: 'prefix' }, output: 'DSC_photo.jpg' },
      { input: 'report.pdf', config: { text: '_v2', at: 'suffix' }, output: 'report_v2.pdf' },
      { input: 'ABCDEF.txt', config: { text: '-', at: 'index', index: 3 }, output: 'AB-CDEF.txt' },
    ],
    fields: [
      F('text', '插入内容 (Text)', 'text', '', '要插入的文本内容，支持任意字符', { metaTags: true }),
      {
        key: 'at',
        label: '插入位置 (Position)',
        kind: 'select',
        default: 'suffix',
        hint: '选择开头、结尾或按字符偏移插入',
        options: OPT(['prefix', '开头 (Prefix)'], ['suffix', '结尾 (Suffix)'], ['index', '指定位置 (Index)']),
      },
      F('index', '字符位置 (Offset)', 'number', 1, '从 1 开始计数，代表插入点前的字符数'),
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后插入内容不会进入 .jpg 等扩展名'),
    ],
  },
  {
    type: 'delete',
    label: 'Delete (删除)',
    renamerClass: 'TRuleDelete',
    summary: '从开头或末尾按位置删除指定数量字符。',
    help:
      '按「起始位置 + 数量」精确裁剪文件名，而不是按文本内容匹配。位置从 1 开始，' +
      '从末尾计数时 1 表示最后一个字符。适合去掉固定长度的相机前缀或尾部编号。',
    examples: [
      { input: 'abcdef.txt', config: { from: 'start', index: 1, count: 3 }, output: 'def.txt' },
      { input: 'abcdef.txt', config: { from: 'end', index: 4, count: 4 }, output: 'ab.txt' },
      { input: 'DSC_0001.jpg', config: { from: 'start', index: 1, count: 4 }, output: '0001.jpg' },
    ],
    fields: [
      {
        key: 'from',
        label: '删除方向 (Direction)',
        kind: 'select',
        default: 'start',
        hint: '选择从开头还是从末尾计数',
        options: OPT(['start', '从开头 (Start)'], ['end', '从结尾 (End)']),
      },
      F('index', '起始位置 (Start)', 'number', 1, '从 1 开始计数，表示删除起点'),
      F('count', '删除数量 (Count)', 'number', 1, '要删除的字符数；Emoji 也按一个字符计算'),
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后只裁剪主文件名'),
    ],
  },
  {
    type: 'remove',
    label: 'Remove (移除)',
    renamerClass: 'TRuleRemove',
    summary: '移除匹配的文本片段或移除区间内内容。',
    help:
      '文本模式按字面内容删除，可控制全部/首个/末个命中与大小写；区间模式会删除一对分隔符之间的所有内容，' +
      '包括分隔符本身。区间模式适合批量去掉 (1)、(Official) 之类的括号备注。',
    examples: [
      { input: 'xaxbx.txt', config: { text: 'x' }, output: 'ab.txt' },
      { input: 'a(1)b(2).txt', config: { mode: 'between', open: '(', close: ')' }, output: 'ab.txt' },
      { input: 'Track [Remix].mp3', config: { mode: 'between', open: '[', close: ']' }, output: 'Track .mp3' },
    ],
    fields: [
      {
        key: 'mode',
        label: '移除模式 (Mode)',
        kind: 'select',
        default: 'literal',
        hint: '文本模式删除指定片段，区间模式删除一对分隔符之间的内容',
        options: OPT(['literal', '移除文本 (Text)'], ['between', '移除区间 (Between)']),
      },
      F('text', '要移除的文本 (Text)', 'text', '', '文本模式下要删除的完整片段', { metaTags: true }),
      F('open', '起始分隔符 (Open)', 'text', '(', '区间模式下开始删除的位置', { metaTags: true }),
      F('close', '结束分隔符 (Close)', 'text', ')', '区间模式下停止删除的位置', { metaTags: true }),
      {
        key: 'occurrence',
        label: '匹配次数 (Occurrence)',
        kind: 'select',
        default: 'all',
        hint: '文本模式下选择删除全部、首个或末个命中',
        options: OPT(['all', '全部 (All)'], ['first', '仅首个 (First)'], ['last', '仅末个 (Last)']),
      },
      F('caseSensitive', '区分大小写 (Case Sensitive)', 'bool', false, '文本模式下是否区分大小写'),
    ],
  },
  {
    type: 'rearrange',
    label: 'Rearrange (重排)',
    renamerClass: 'TRuleRearrange',
    summary: '按指定分隔符切分文件名并重新排列顺序。',
    help:
      '把「艺术家 - 标题」之类的名字按分隔符切开，再按新顺序拼接。顺序用逗号分隔的 1 起编号，' +
      '例如 2,1 表示第二段在前；未列出的片段会自动保留在末尾，越界编号会被忽略。',
    examples: [
      {
        input: 'Artist - Title.txt',
        config: { separator: ' - ', order: '2,1', joinWith: ' ' },
        output: 'Title Artist.txt',
      },
      {
        input: '2026-03-20_photo.jpg',
        config: { separator: '_', order: '2,1', joinWith: '_' },
        output: 'photo_2026-03-20.jpg',
      },
    ],
    fields: [
      F('separator', '拆分符 (Delimiter)', 'text', ' - ', '用于把主文件名切成多段，区分大小写与空格', { metaTags: true }),
      F('order', '新顺序 (Order)', 'text', '2,1', '逗号分隔的 1 起编号，如 2,1；越界编号会被忽略'),
      F('joinWith', '连接符 (Join With)', 'text', ' ', '重排后各片段之间的连接文本', { metaTags: true }),
    ],
  },
  {
    type: 'extension',
    label: 'Extension (扩展名)',
    renamerClass: 'TRuleExtension',
    summary: '更改、移除、强制大小写或补全文件扩展名。',
    help:
      '专门处理最后一个点之后的部分。默认把 .tar.gz、.d.ts 等复合后缀视为一个扩展名；' +
      '「缺省补」只在没有扩展名时补上，不会覆盖已有的 .jpg。',
    examples: [
      { input: 'a.jpg', config: { mode: 'set', value: 'png' }, output: 'a.png' },
      { input: 'a.jpg', config: { mode: 'remove' }, output: 'a' },
      { input: 'README', config: { mode: 'ensure', value: '.md' }, output: 'README.md' },
    ],
    fields: [
      {
        key: 'mode',
        label: '动作 (Action)',
        kind: 'select',
        default: 'set',
        hint: '选择设置、移除、转大小写或仅在缺失时补全',
        options: OPT(
          ['set', '设为 (Set)'],
          ['remove', '移除 (Remove)'],
          ['lower', '转小写 (Lower)'],
          ['upper', '转大写 (Upper)'],
          ['ensure', '缺省补 (Ensure)'],
        ),
      },
      F('value', '新扩展名 (New Ext)', 'text', '', '可写 png 或 .png；设为/缺省补模式使用'),
      F(
        'detectDoubleExt',
        '识别双扩展名 (Detect Double Ext)',
        'bool',
        true,
        '把 .tar.gz、.d.ts 等复合后缀当作一个扩展名',
      ),
    ],
  },
  {
    type: 'strip',
    label: 'Strip (清除字符)',
    renamerClass: 'TRuleStrip',
    summary: '批量剔除数字、符号、空格、控制符或括号等字符类。',
    help:
      '按字符类别清洗文件名，可多选组合。常用于去掉下载文件里的数字前缀、下划线、不可见控制符，' +
      '或把非 ASCII 字符从英文文件名中清除。只处理主文件名。',
    examples: [
      { input: 'a1b2.txt', config: { digits: true }, output: 'ab.txt' },
      { input: 'a-b_c.txt', config: { symbols: true }, output: 'abc.txt' },
      { input: '【报告】 2026.txt', config: { brackets: true, spaces: true }, output: '【报告】2026.txt' },
    ],
    fields: [
      F('digits', '数字 (Digits)', 'bool', false, '删除 0-9 数字字符'),
      F('letters', '字母 (Letters)', 'bool', false, '删除英文字母'),
      F('symbols', '符号 (Symbols)', 'bool', false, '删除标点与符号（不含空格）'),
      F('spaces', '空格 (Spaces)', 'bool', false, '删除所有空白字符'),
      F('control', '控制符 (Control)', 'bool', false, '删除换行、制表符等不可见控制字符'),
      F('nonAscii', '非 ASCII (Non-ASCII)', 'bool', false, '删除中文、日文、重音字母等非 ASCII 字符'),
      F('brackets', '括号 (Brackets)', 'bool', false, '删除 () [] {} 及中文括号'),
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后不会误删扩展名中的字符'),
    ],
  },
  {
    type: 'case',
    label: 'Case (大小写)',
    renamerClass: 'TRuleCase',
    summary: '转换全大写、全小写、词首大写或反转大小写。',
    help:
      '按单词或整句转换大小写。词首大写会把空格、横线、下划线、点后的首字母大写；' +
      '可只作用于主名、只作用于扩展名，或两者同时处理。',
    examples: [
      { input: 'hello world.TXT', config: { mode: 'upper' }, output: 'HELLO WORLD.TXT' },
      { input: 'HELLO WORLD.TXT', config: { mode: 'lower', scope: 'both' }, output: 'hello world.txt' },
      { input: 'my-file_name.txt', config: { mode: 'title' }, output: 'My-File_Name.txt' },
    ],
    fields: [
      {
        key: 'mode',
        label: '转换模式 (Mode)',
        kind: 'select',
        default: 'lower',
        hint: '选择要应用的大小写转换方式',
        options: OPT(
          ['lower', '全小写 (Lower)'],
          ['upper', '全大写 (Upper)'],
          ['title', '词首大写 (Title)'],
          ['sentence', '句首大写 (Sentence)'],
          ['invert', '反转大小写 (Invert)'],
        ),
      },
      {
        key: 'scope',
        label: '作用范围 (Scope)',
        kind: 'select',
        default: 'base',
        hint: '选择只改主名、只改扩展名或两者都改',
        options: OPT(['base', '主名 (Base)'], ['ext', '扩展名 (Ext)'], ['both', '全部 (Both)']),
      },
    ],
  },
  {
    type: 'serialize',
    label: 'Serialize (序列化/编号)',
    renamerClass: 'TRuleSerialize',
    summary: '批量添加自增序号，支持步长、补零和按目录重置。',
    help:
      '按文件在列表中的顺序生成连续编号，可设置起始值、步长和补零位数。编号可放在前缀、后缀或指定字符位置；' +
      '开启「每目录重置」后，每个文件夹都会从起始值重新计数。',
    examples: [
      {
        input: 'photo.jpg',
        config: { start: 1, step: 1, padding: 2, separator: '_', position: 'suffix' },
        output: 'photo_01.jpg',
      },
      {
        input: 'photo.jpg',
        config: { start: 100, step: 10, padding: 4, separator: '-', position: 'prefix' },
        output: '0100-photo.jpg',
      },
    ],
    fields: [
      F('start', '起始值 (Start)', 'number', 1, '第一个文件使用的编号'),
      F('step', '步长 (Step)', 'number', 1, '每个文件递增的数量'),
      F('padding', '补零位数 (Padding)', 'number', 2, '编号不足位数时在前面补 0'),
      F('separator', '连接符 (Separator)', 'text', '_', '编号与原名之间的连接文本'),
      {
        key: 'position',
        label: '插入位置 (Position)',
        kind: 'select',
        default: 'suffix',
        hint: '编号放在主名前面、后面或指定字符位置',
        options: OPT(['prefix', '前缀 (Prefix)'], ['suffix', '后缀 (Suffix)'], ['index', '指定位置 (Index)']),
      },
      F('index', '字符位置 (Offset)', 'number', 1, '指定位置模式下，从 1 开始计数的插入点'),
      F('resetPerFolder', '每目录重置 (Reset per Folder)', 'bool', false, '每个父文件夹单独从起始值计数'),
    ],
  },
  {
    type: 'cleanup',
    label: 'CleanUp (清理)',
    renamerClass: 'TRuleCleanUp',
    summary: '规范化多余空格、连续点号并自动配对括号。',
    help:
      '一次处理常见的「脏文件名」：合并连续空格、把连续点号压成一个、去掉首尾空白与点，' +
      '还可以把下划线转空格、删除空括号或补齐缺失的右括号。',
    examples: [
      { input: '  a   b  .txt', config: {}, output: 'a b.txt' },
      { input: 'x..y.txt', config: {}, output: 'x.y.txt' },
      { input: 'report_(final.txt', config: { fixBrackets: true }, output: 'report_(final).txt' },
    ],
    fields: [
      F('collapseSpaces', '合并连续空格 (Collapse Spaces)', 'bool', true, '把多个空格或制表符合并为一个空格'),
      F('trim', '去除首尾空白/点 (Trim)', 'bool', true, '删除主文件名首尾的空格和点'),
      F('underscoresToSpaces', '下划线转空格 (Underscores → Spaces)', 'bool', false, '把 _ 替换为空格'),
      F('spacesToUnderscores', '空格转下划线 (Spaces → Underscores)', 'bool', false, '把空格替换为 _'),
      F('removeEmptyBrackets', '移除空括号 (Remove Empty Brackets)', 'bool', false, '删除 ()、[]、{} 空对'),
      F('fixBrackets', '修复括号配对 (Fix Brackets)', 'bool', false, '自动补上缺失的右括号，丢弃多余右括号'),
    ],
  },
  {
    type: 'padding',
    label: 'Padding (补齐对齐)',
    renamerClass: 'TRulePadding',
    summary: '填充字符将文件名长度补齐到固定宽度。',
    help:
      '按字符数把主文件名补齐到指定宽度，常用于让 1、2、10 这样的编号在列表中对齐。' +
      '左侧填充就是在前面补零，右侧填充则把填充字符追加到末尾；已超过目标长度时保持不变。',
    examples: [
      { input: '42.txt', config: { length: 5, char: '0' }, output: '00042.txt' },
      { input: 'photo.jpg', config: { length: 8, char: '-', align: 'right' }, output: 'photo---.jpg' },
    ],
    fields: [
      F('length', '目标长度 (Target Length)', 'number', 4, '主文件名至少要达到的字符数'),
      F('char', '填充字符 (Fill Char)', 'text', '0', '用于补齐的单个字符，如 0 或 -'),
      {
        key: 'align',
        label: '对齐方式 (Align)',
        kind: 'select',
        default: 'left',
        hint: '左侧填充会在开头补字符，右侧填充会在末尾补',
        options: OPT(['left', '左侧填充 (Left)'], ['right', '右侧填充 (Right)']),
      },
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后只补齐主文件名'),
    ],
  },
  {
    type: 'translit',
    label: 'Translit (音译/去音标)',
    renamerClass: 'TRuleTranslit',
    summary: '西里尔/希腊字符转写或去除拉丁字符音标。',
    help:
      '把非 ASCII 名字转换为更通用的拉丁形式：去音标模式把 café 变成 cafe，西里尔/希腊模式按字符表转写。' +
      '中文没有内置拼音词典，默认保留；可选择移除 CJK 字符。',
    examples: [
      { input: 'Привет.txt', config: { mode: 'cyrillic' }, output: 'Privet.txt' },
      { input: 'café.txt', config: { mode: 'ascii' }, output: 'cafe.txt' },
      { input: 'Αθήνα.txt', config: { mode: 'greek' }, output: 'Athina.txt' },
    ],
    fields: [
      {
        key: 'mode',
        label: '转写模式 (Mode)',
        kind: 'select',
        default: 'ascii',
        hint: '选择去音标、西里尔转写或希腊转写',
        options: OPT(
          ['ascii', '去音标 (ASCII)'],
          ['cyrillic', '西里尔 (Cyrillic)'],
          ['greek', '希腊 (Greek)'],
        ),
      },
      {
        key: 'cjk',
        label: 'CJK 处理 (CJK)',
        kind: 'select',
        default: 'keep',
        hint: '中文/日文/韩文没有内置拼音，选择保留或直接移除',
        options: OPT(['keep', '保留 (Keep)'], ['drop', '移除 (Drop)']),
      },
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后只转写主文件名'),
    ],
  },
  {
    type: 'script',
    label: 'Script (脚本)',
    renamerClass: 'TRulePascalScript',
    summary: '使用原生 JavaScript 编写自定义逻辑进行重命名。',
    help:
      '在隔离的 node:vm 沙箱中执行 JavaScript，可读写 FileName、FilePath、FileExt、Index 和 Meta。' +
      '必须把最终结果赋回 FileName；死循环会被超时中断，只影响当前文件而不会拖死宿主。',
    examples: [
      {
        input: 'IMG_001.JPG',
        config: { source: "FileName = FileName.replace('IMG', 'PHOTO');" },
        output: 'PHOTO_001.JPG',
      },
      {
        input: 'photo.jpg',
        config: { source: "FileName = FileName.replace(/\\.jpg$/i, '.jpeg');" },
        output: 'photo.jpeg',
      },
    ],
    fields: [
      F(
        'source',
        'JavaScript 脚本 (Script)',
        'textarea',
        "// FileName / FilePath / FileExt / Index / Meta 可用\nFileName = FileName.toUpperCase();",
        '可用变量：FileName / FilePath / FileExt / Index / Meta；最后必须赋值给 FileName',
      ),
      F('timeoutMs', '超时 (Timeout ms)', 'number', 100, '单文件执行上限，范围 5-2000 毫秒'),
    ],
  },
  {
    type: 'reformatdate',
    label: 'ReformatDate (日期重排)',
    renamerClass: 'TRuleReformatDate',
    summary: '检测并重构文件名中的日期，或提取 EXIF/修改时间。',
    help:
      '从文件名、修改时间、创建时间或照片 EXIF 中取得日期，再按目标格式重写。文件名来源会优先按「源格式」匹配，' +
      '失败后自动识别 20260320、2026-03-20、20.03.2026 等常见写法；替换模式只替换日期片段，保留前后文字。' +
      '目标格式支持 YYYY、YY、MM、M、DD、D、HH、H、mm、m、ss、s。',
    examples: [
      {
        input: '20260320.jpg',
        config: { source: 'name', sourceFormat: 'YYYYMMDD', targetFormat: 'YYYY-MM-DD' },
        output: '2026-03-20.jpg',
      },
      {
        input: 'IMG_2026-03-20_101500.jpg',
        config: { source: 'name', targetFormat: 'YYYYMMDD_HHmmss' },
        output: 'IMG_20260320_101500.jpg',
      },
      {
        input: 'DSC_2026.03.20.jpg',
        config: { source: 'name', targetFormat: 'YYYY-MM-DD' },
        output: 'DSC_2026-03-20.jpg',
      },
    ],
    fields: [
      {
        key: 'source',
        label: '日期来源 (Source)',
        kind: 'select',
        default: 'name',
        hint: '选择从当前文件名、文件时间或 EXIF 拍摄时间取日期',
        options: OPT(
          ['name', '从当前文件名识别 (Name)'],
          ['modified', '文件修改时间 (mtime)'],
          ['created', '文件创建时间 (ctime)'],
          ['exif', 'EXIF 拍摄时间 (EXIF Date)'],
        ),
      },
      F('sourceFormat', '源格式/模式 (Source Format)', 'text', 'YYYY-MM-DD', '来源为文件名时优先按此格式匹配，失败会自动识别常见日期'),
      F('targetFormat', '目标格式 (Target Format)', 'text', 'YYYYMMDD_HHmmss', '支持 YYYY、MM、DD、HH、mm、ss 等占位符'),
      {
        key: 'position',
        label: '放置位置 (Placement)',
        kind: 'select',
        default: 'replace',
        hint: '替换只改日期片段；前缀/后缀会把格式化日期追加到原名',
        options: OPT(
          ['replace', '替换日期/完全替换 (Replace)'],
          ['prefix', '作为前缀追加 (Prefix)'],
          ['suffix', '作为后缀追加 (Suffix)'],
        ),
      },
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后日期规则不触碰扩展名'),
    ],
  },
  {
    type: 'list',
    label: 'List (列表映射)',
    renamerClass: 'TRuleList',
    summary: '根据文本行或 CSV/TSV 映射表进行逐行批量重命名。',
    help:
      '两种用法：键值映射把「旧名称 -> 新名称」逐行粘贴，命中后替换；顺序替换则让第 N 行对应第 N 个文件。' +
      '分隔符可填 ->、=、| 或 Tab，留空或未命中时会自动尝试常见分隔符。映射默认忽略大小写，并保留原扩展名。',
    examples: [
      {
        input: 'IMG_001.jpg',
        config: { mode: 'mapping', separator: '=', content: 'IMG_001=Photo One\nIMG_002=Photo Two' },
        output: 'Photo One.jpg',
      },
      {
        input: 'a.jpg',
        config: { mode: 'sequential', content: 'first\nsecond' },
        output: 'first.jpg',
      },
      {
        input: 'old name.txt',
        config: { mode: 'mapping', separator: '|', content: 'old name|new name' },
        output: 'new name.txt',
      },
    ],
    fields: [
      {
        key: 'mode',
        label: '映射模式 (Mode)',
        kind: 'select',
        default: 'mapping',
        hint: '键值映射按原名查找；顺序替换按行号对齐文件顺序',
        options: OPT(
          ['mapping', '键值映射 (Old Name -> New Name)'],
          ['sequential', '顺序替换 (Row Order)'],
        ),
      },
      F('separator', '键值分隔符 (Delimiter)', 'text', '->', '用于拆分每行的旧名称与新名称，如 "->"、"="、"|"、"," 或 Tab'),
      F('content', '列表内容 (Lines)', 'textarea', '', '每行一条记录。顺序模式下第 N 行对应第 N 个文件'),
      F('caseSensitive', '区分大小写 (Case Sensitive)', 'bool', false, '键值映射匹配原名时是否区分大小写'),
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '映射值默认只替换主名，扩展名保持不变'),
    ],
  },
  {
    type: 'randomize',
    label: 'Randomize (随机化)',
    renamerClass: 'TRuleRandomize',
    summary: '生成随机数字、随机字符串或 UUID/GUID 覆盖或追加。',
    help:
      '用密码学安全的随机源生成不可预测的名字，适合隐藏原始文件名或避免重名。UUID 模式生成标准 8-4-4-4-12 格式；' +
      '其他模式按指定字符集和长度逐字符生成。可覆盖主名，也可作为前缀/后缀追加。',
    examples: [
      {
        input: 'secret.pdf',
        config: { charset: 'uuid', position: 'replace' },
        output: '550e8400-e29b-41d4-a716-446655440000.pdf',
      },
      {
        input: 'photo.jpg',
        config: { charset: 'alphanumeric', length: 8, position: 'prefix' },
        output: 'aB3xK9Qm_photo.jpg（每次运行不同）',
      },
      {
        input: 'data.csv',
        config: { charset: 'digits', length: 6, position: 'suffix' },
        output: 'data_123456.csv（每次运行不同）',
      },
    ],
    fields: [
      {
        key: 'charset',
        label: '随机类型 (Type)',
        kind: 'select',
        default: 'alphanumeric',
        hint: '选择 UUID、字母数字、纯数字或十六进制字符',
        options: OPT(
          ['uuid', '标准 UUID (UUID 8-4-4-4-12)'],
          ['alphanumeric', '字母与数字 (A-Z a-z 0-9)'],
          ['digits', '纯数字 (Digits 0-9)'],
          ['hex', '十六进制字符 (Hex 0-f)'],
        ),
      },
      F('length', '随机长度 (Length)', 'number', 8, '非 UUID 模式下生成的字符数；UUID 模式自动忽略'),
      {
        key: 'position',
        label: '应用方式 (Action)',
        kind: 'select',
        default: 'replace',
        hint: '覆盖整个主名，或把随机串加在前/后',
        options: OPT(
          ['replace', '覆盖整个主名 (Replace)'],
          ['prefix', '作为前缀 (Prefix)'],
          ['suffix', '作为后缀 (Suffix)'],
        ),
      },
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后保留 .jpg 等扩展名不变'),
    ],
  },
  {
    type: 'userinput',
    label: 'UserInput (自定义输入)',
    renamerClass: 'TRuleUserInput',
    summary: '提取文件特征并根据用户自定义模板统一格式化。',
    help:
      '用占位符拼出统一命名模板，把目录名、原名、扩展名、体积和序号混排。默认模板是「父目录_原名」，' +
      '适合按文件夹归类照片；[:ext:] 含前导点，[:size:] 会自动换算为 B/KB/MB/GB。未知占位符会原样保留以便发现拼写错误。',
    examples: [
      {
        input: 'photo.jpg',
        config: { template: '[:folder:]_[:name:]' },
        output: 'Trip_photo.jpg（Trip 是所在目录）',
      },
      {
        input: 'IMG_001.jpg',
        config: { template: '[:index:]_[:name:]' },
        output: '1_IMG_001.jpg',
      },
      {
        input: 'clip.mp4',
        config: { template: '[:name:]_[:size:]' },
        output: 'clip_12MB.mp4（体积来自文件元数据）',
      },
    ],
    fields: [
      F(
        'template',
        '重命名模板 (Template)',
        'text',
        '[:folder:]_[:name:]',
        '可用标签: [:name:], [:ext:], [:folder:], [:size:], [:index:]；也可插入元标签',
        { metaTags: true },
      ),
      F('skipExtension', '跳过扩展名 (Skip Ext)', 'bool', true, '开启后扩展名自动保留；模板里含 [:ext:] 也不会重复'),
    ],
  },
];

const META_BY_TYPE = new Map(RULE_META.map((m) => [m.type, m]));

export function ruleMeta(type) {
  return META_BY_TYPE.get(type) || null;
}

/** Default parameter object for a freshly added rule. */
export function defaultConfig(type) {
  const meta = ruleMeta(type);
  if (!meta) return {};
  const cfg = {};
  for (const field of meta.fields) cfg[field.key] = field.default;
  cfg.enabled = true;
  return cfg;
}

export function createRule(type, config = {}) {
  const Ctor = RULE_CLASSES[type];
  if (!Ctor) throw new Error(`未知规则类型: ${type}`);
  return new Ctor({ ...defaultConfig(type), ...config });
}

/** Rehydrate a persisted rule list (used by presets and the CLI). */
export function createRules(list = []) {
  return (Array.isArray(list) ? list : []).filter((r) => r && typeof r.type === 'string').map((r) => createRule(r.type, r));
}

export const RULE_TYPES = RULE_META.map((m) => m.type);
