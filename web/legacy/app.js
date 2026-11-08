// renamer-web frontend: vanilla ES modules, no framework, no build step.
// The DOM holds only the visible window of rows; the item array lives in the
// Node host (see server/index.mjs). Every grid request is versioned and
// cancellable so rapid typing, tab switches and previews cannot overwrite a
// newer answer with an older one.
import { diffChars } from './diff.mjs';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SVG_NS = 'http://www.w3.org/2000/svg';

const ROW_H = 36;
const HEAD_H = 34;
const PAGE = 100;
const BUFFER = 8;

const STATUS_TEXT = {
  ready: ['准备就绪', ''],
  unchanged: ['无变化', ''],
  conflict: ['冲突', 'warn'],
  error: ['错误', 'bad'],
  renaming: ['处理中', ''],
  success: ['已重命名', 'ok'],
};

const EMPTY_STATS = { total: 0, changed: 0, unchanged: 0, conflicts: 0, errors: 0, selected: 0, ready: 0 };

const state = {
  rules: [],
  types: [],
  metaTags: [],
  metaTagPicker: { open: false, control: null, field: null, selected: 0 },
  selectedRule: -1,
  view: 'focus',
  q: '',
  stats: { ...EMPTY_STATS },
  total: 0,
  revision: 0,
  pages: new Map(),
  loading: new Set(),
  gridEpoch: 0,
  fileAbort: null,
  previewSeq: 0,
  previewAbort: null,
  autoPreview: true,
  autoFix: false,
  batches: [],
  busy: false,
  busyLabel: '处理中…',
  mutation: false,
  scanOptions: { recurse: true, masks: '', excludeMasks: '', includeHidden: false, includeSystem: false },
  inspector: { open: false, index: -1, type: 'replace', draft: null, refs: new Map(), draftPreview: false },
  dragRule: -1,
  lastType: 'replace',
};

const vp = $('#gridViewport');
const spacer = $('#gridSpacer');
const rowsLayer = $('#gridRows');
const gridEmpty = $('#gridEmpty');

/* ------------------------------- utilities ------------------------------- */

async function api(path, { method = 'GET', body, signal } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`接口返回非 JSON：${text.slice(0, 120)}`);
    }
  }
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function isAbort(err) {
  return err && (err.name === 'AbortError' || err.code === 20);
}

function toast(message, kind = 'info', ttl = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ttl);
}

function setBadge(text, mode = '') {
  const el = $('#statusBadge');
  el.textContent = text;
  el.className = `badge ${mode}`.trim();
}

function setConnection(online) {
  for (const id of ['#connectionLight', '#connLight']) {
    const dot = $(id);
    if (!dot) continue;
    dot.classList.toggle('online', online === true);
    dot.classList.toggle('offline', online === false);
    dot.title = online ? '与本地宿主已连接' : '与本地宿主断开';
  }
  const info = $('#connInfo');
  if (info) info.textContent = online ? '宿主已连接' : '连接中断，重试中…';
}

function setPerf(text) {
  $('#perfInfo').textContent = text || '';
}

function setBusy(busy, label = '处理中…') {
  state.busy = busy;
  state.busyLabel = label;
  $('#btnRename').classList.toggle('is-busy', busy);
  const undo = $('#btnUndo');
  if (undo) undo.disabled = busy || !state.batches[0];
  updateRenameButton();
}

function updateRenameButton() {
  const btn = $('#btnRename');
  const label = $('#renameLabel');
  if (!btn || !label) return;
  const changed = state.stats.changed || 0;
  btn.disabled = state.busy || state.mutation || changed === 0;
  label.textContent = state.busy ? state.busyLabel : changed ? `重命名 ${changed} 项` : '开始重命名';
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function isEditable(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

function makeIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.appendChild(use);
  return svg;
}

/* ------------------------------ virtual grid ----------------------------- */

function abortFileRequests() {
  if (state.fileAbort) {
    state.fileAbort.abort();
    state.fileAbort = null;
  }
}

function gridReset() {
  abortFileRequests();
  state.gridEpoch += 1;
  state.pages.clear();
  state.loading.clear();
}

function currentFirst() {
  const rel = Math.max(0, vp.scrollTop - HEAD_H);
  return Math.max(0, Math.floor(rel / ROW_H));
}

function updateEmptyState() {
  const title = $('#gridEmptyTitle');
  const text = $('#gridEmptyText');
  if (!title || !text) return;

  if (state.q) {
    title.textContent = '没有匹配项';
    text.textContent = `没有文件名包含「${state.q}」。清空搜索可恢复完整列表。`;
    return;
  }
  if (!state.stats.total) {
    title.textContent = '文件列表为空';
    text.textContent = '用「添加文件 / 添加目录」导入，或按 Ctrl+O 打开文件。';
    return;
  }
  if (state.view === 'issues') {
    title.textContent = '没有冲突或错误';
    text.textContent = '当前规则栈没有产生需要处理的问题。';
    return;
  }
  if (state.view === 'changed') {
    title.textContent = '当前没有发生改变的文件';
    text.textContent = '调整左侧规则后，预览结果会出现在这里。';
    return;
  }
  if (state.view === 'focus') {
    title.textContent = '没有需要关注的文件';
    text.textContent = '问题项与真实改动会优先显示在这里，切到「全部」可浏览完整列表。';
    return;
  }
  title.textContent = '没有可显示的文件';
  text.textContent = '调整视图或搜索条件后重试。';
}

function setTotal(total) {
  state.total = Math.max(0, Number(total) || 0);
  vp.setAttribute('aria-rowcount', String(state.total));
  spacer.style.height = `${state.total * ROW_H}px`;
  gridEmpty.hidden = state.total > 0;
  const maxScroll = Math.max(0, state.total * ROW_H + HEAD_H - vp.clientHeight);
  if (vp.scrollTop > maxScroll) vp.scrollTop = maxScroll;
  if (state.total === 0) rowsLayer.replaceChildren();
  updateEmptyState();
}

function renderDiff(host, before, after) {
  host.replaceChildren();
  for (const op of diffChars(before, after)) {
    if (op.type === 'same') {
      host.appendChild(document.createTextNode(op.text));
    } else {
      const tag = document.createElement(op.type === 'del' ? 'del' : 'ins');
      tag.textContent = op.text;
      host.appendChild(tag);
    }
  }
}

function rowElement(index, row) {
  const el = document.createElement('div');
  el.className = 'grid-row';
  el.tabIndex = 0;
  el.setAttribute('role', 'row');

  if (!row) {
    el.classList.add('loading');
    el.setAttribute('aria-busy', 'true');
    el.append(
      document.createElement('span'),
      document.createElement('span'),
      Object.assign(document.createElement('span'), { className: 'name', textContent: '载入中…' }),
      document.createElement('span'),
      document.createElement('span'),
      document.createElement('span'),
    );
    return el;
  }

  const [label, tone] = STATUS_TEXT[row.status] || [row.status, ''];
  el.classList.add(row.status || 'ready');
  el.dataset.index = String(index);
  el.dataset.id = row.id || '';
  el.setAttribute('aria-rowindex', String(index + 1));
  el.setAttribute('aria-selected', row.selected !== false ? 'true' : 'false');
  if (row.errorMessage) el.title = row.errorMessage;

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = row.selected !== false;
  check.setAttribute('aria-label', `选择 ${row.originalName}`);
  check.addEventListener('click', (event) => event.stopPropagation());
  check.addEventListener('change', () => applySelection(row, check.checked, check));

  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = String(index + 1);

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = row.originalName;
  name.title = `${row.dir}\\${row.originalName}`;

  const newName = document.createElement('span');
  newName.className = 'new name';
  if (row.newName !== row.originalName) renderDiff(newName, row.originalName, row.newName);
  else newName.textContent = row.newName;
  newName.title = row.errorMessage ? `${row.newName} — ${row.errorMessage}` : `${row.dir}\\${row.newName}`;

  const dir = document.createElement('span');
  dir.className = 'dir';
  dir.textContent = row.dir;

  const st = document.createElement('span');
  st.className = `st ${tone}`.trim();
  st.textContent = label;
  const explanation = row.errorMessage
    || (row.status === 'conflict' ? `目标已存在：${row.newName}` : '')
    || (row.status === 'ready' ? `将重命名为 ${row.newName}` : '');
  if (explanation) {
    st.title = explanation;
    st.setAttribute('aria-label', `${label}：${explanation}`);
  }

  el.append(check, idx, name, newName, dir, st);
  el.addEventListener('click', (event) => {
    if (event.target === check) return;
    el.focus({ preventScroll: true });
  });
  return el;
}

function renderWindow() {
  const focusId = document.activeElement?.closest?.('.grid-row')?.dataset.id;
  const rel = Math.max(0, vp.scrollTop - HEAD_H);
  const height = vp.clientHeight || 420;
  const first = Math.max(0, Math.floor(rel / ROW_H) - BUFFER);
  const last = Math.min(Math.max(state.total - 1, 0), Math.ceil((rel + height) / ROW_H) + BUFFER);

  rowsLayer.style.transform = `translate3d(0, ${first * ROW_H}px, 0)`;

  if (!state.total) {
    rowsLayer.replaceChildren();
    return;
  }

  const frag = document.createDocumentFragment();
  for (let i = first; i <= last; i += 1) {
    const page = state.pages.get(Math.floor(i / PAGE));
    frag.appendChild(rowElement(i, page ? page[i % PAGE] : undefined));
  }
  rowsLayer.replaceChildren(frag);

  if (focusId) {
    const again = rowsLayer.querySelector(`.grid-row[data-id="${CSS.escape(focusId)}"]`);
    if (again) again.focus({ preventScroll: true });
  }

  ensurePage(Math.floor(first / PAGE));
  ensurePage(Math.floor(last / PAGE));
}

async function ensurePage(pageIndex) {
  if (pageIndex < 0) return;
  if (state.pages.has(pageIndex) || state.loading.has(pageIndex)) return;
  const epoch = state.gridEpoch;
  state.loading.add(pageIndex);
  const controller = state.fileAbort || (state.fileAbort = new AbortController());
  const params = new URLSearchParams({
    offset: String(pageIndex * PAGE),
    limit: String(PAGE),
    view: state.view,
    q: state.q,
  });

  try {
    const data = await api(`/api/files?${params}`, { signal: controller.signal });
    if (epoch !== state.gridEpoch) return;
    const revision = Number(data.revision);
    if (Number.isFinite(revision) && revision < state.revision) return;
    if (Number.isFinite(revision)) state.revision = revision;
    state.pages.set(pageIndex, Array.isArray(data.rows) ? data.rows : []);
    setTotal(data.total);
    applyStats(data.stats);
    renderWindow();
  } catch (err) {
    if (!isAbort(err) && epoch === state.gridEpoch) {
      toast(`读取文件窗口失败：${err.message}`, 'bad');
      setBadge('读取失败', 'err');
    }
  } finally {
    if (epoch === state.gridEpoch) state.loading.delete(pageIndex);
  }
}

async function refreshGrid({ resetScroll = false } = {}) {
  if (resetScroll) vp.scrollTop = 0;
  gridReset();
  renderWindow();
  const first = currentFirst();
  await ensurePage(Math.floor(first / PAGE));
  renderWindow();
}

function refreshStatsOnly() {
  // Selection endpoints already return fresh aggregated stats; this is only a
  // fallback for the rare case where that response was lost.
  const stats = state.stats;
  applyStats(stats);
}

/* -------------------------------- stats --------------------------------- */

function addMetric(kind, label, value, title) {
  const el = document.createElement('span');
  el.className = `metric ${kind}`.trim();
  if (title) el.title = title;
  const text = document.createElement('span');
  text.textContent = label;
  const b = document.createElement('b');
  b.textContent = String(value ?? 0);
  el.append(text, b);
  $('#metrics').appendChild(el);
}

function applyStats(stats) {
  if (!stats) return;
  const s = { ...EMPTY_STATS, ...stats };
  if (s.ready === undefined) s.ready = Math.max(0, s.total - s.conflicts - s.errors);
  state.stats = s;

  const metrics = $('#metrics');
  metrics.replaceChildren();
  addMetric('total', '总计', s.total, '当前文件列表中的全部条目');
  addMetric('changed', '改变', s.changed, '预览可执行的重命名');
  addMetric('conflict', '冲突', s.conflicts, '目标名称重复或已存在于磁盘');
  addMetric('error', '错误', s.errors, '规则求值或文件名校验失败');
  addMetric('ready', '就绪', s.ready, '通过校验的条目（含无变化）');

  $('#fileCount').textContent = s.total ? String(s.total) : '';
  $('#btnFixConflicts').hidden = s.conflicts === 0;
  $('#btnFixConflicts').replaceChildren(
    makeIcon('wand'),
    document.createTextNode(` 一键修复冲突 (${s.conflicts})`),
  );

  const all = $('#chkAll');
  all.checked = s.total > 0 && s.selected === s.total;
  all.indeterminate = s.selected > 0 && s.selected < s.total;
  all.disabled = s.total === 0;
  updateRenameButton();
  updateEmptyState();
}

/* -------------------------------- rules --------------------------------- */

function ruleLabel(rule) {
  const meta = state.types.find((t) => t.type === rule.type);
  return meta ? meta.label : rule.type;
}

function describeRule(rule) {
  const parts = [];
  const push = (v) => {
    if (v !== undefined && v !== '' && v !== null && v !== false) parts.push(String(v));
  };
  switch (rule.type) {
    case 'replace':
      push(`"${rule.find ?? ''}"→"${rule.replaceWith ?? ''}"`);
      if (rule.caseSensitive) push('区分大小写');
      if (rule.wildcard) push('通配符');
      break;
    case 'regex':
      push(`/${rule.pattern ?? ''}/${rule.flags ?? 'g'}→"${rule.replacement ?? ''}"`);
      break;
    case 'insert':
      push(`${rule.at === 'prefix' ? '开头' : rule.at === 'suffix' ? '结尾' : `第${rule.index}位`} "${rule.text ?? ''}"`);
      break;
    case 'delete':
      push(`${rule.from === 'end' ? '从尾' : '从头'}第${rule.index}个起删${rule.count}`);
      break;
    case 'remove':
      push(rule.mode === 'between' ? `移除 ${rule.open}…${rule.close}` : `移除 "${rule.text ?? ''}"`);
      break;
    case 'case':
      push({ lower: '小写', upper: '大写', title: '词首大写', sentence: '句首大写', invert: '反转' }[rule.mode] || rule.mode);
      if (rule.scope === 'both') push('含扩展名');
      break;
    case 'strip': {
      const labels = { digits: '数字', letters: '字母', symbols: '符号', spaces: '空格', control: '控制符', nonAscii: '非ASCII', brackets: '括号' };
      const selected = Object.keys(labels).filter((key) => rule[key] === true).map((key) => labels[key]);
      push(selected.join('/') || '无选择');
      break;
    }
    case 'cleanup': {
      const labels = {
        collapseSpaces: '合并空格',
        trim: '去首尾',
        underscoresToSpaces: '下划线→空格',
        spacesToUnderscores: '空格→下划线',
        removeEmptyBrackets: '空括号',
        fixBrackets: '修括号',
      };
      const selected = Object.keys(labels).filter((key) => rule[key] === true).map((key) => labels[key]);
      push(selected.slice(0, 2).join('/') + (selected.length > 2 ? '…' : ''));
      break;
    }
    case 'padding':
      push(`补至 ${rule.length} 位 "${rule.char}"`);
      break;
    case 'serialize':
      push(`起${rule.start} 步${rule.step} 补${rule.padding} ${rule.position}`);
      break;
    case 'translit':
      push(`${rule.mode}${rule.cjk === 'drop' ? ' / 去 CJK' : ''}`);
      break;
    case 'rearrange':
      push(`"${rule.separator}" → ${rule.order}`);
      break;
    case 'extension':
      push({ set: '设为', remove: '移除', lower: '小写', upper: '大写', ensure: '缺省补' }[rule.mode] || rule.mode);
      if (rule.mode !== 'remove' && rule.mode !== 'lower' && rule.mode !== 'upper') push(`"${rule.value ?? ''}"`);
      if (rule.detectDoubleExt) push('双扩展名');
      break;
    case 'script': {
      const line = String(rule.source || '').split(/\r?\n/).find((l) => l.trim()) || '';
      push(line.slice(0, 48));
      break;
    }
    case 'reformatdate':
      push({ name: '文件名', modified: '修改时间', created: '创建时间', exif: 'EXIF' }[rule.source] || rule.source);
      push(`→ ${rule.targetFormat}`);
      break;
    case 'list':
      push(rule.mode === 'sequential' ? '顺序替换' : `映射 "${rule.separator || '->'}"`);
      break;
    case 'randomize':
      push({ uuid: 'UUID', alphanumeric: '字母数字', digits: '数字', hex: '十六进制' }[rule.charset] || rule.charset);
      if (rule.charset !== 'uuid') push(`${rule.length} 位`);
      push(rule.position);
      break;
    case 'userinput':
      push(rule.template || '(空模板)');
      break;
    default:
      push(rule.value ?? '');
  }
  return `${ruleLabel(rule)}${parts.length ? `: ${parts.join(' ')}` : ''}`;
}

function renderRules() {
  const list = $('#ruleList');
  list.replaceChildren();
  $('#ruleCount').textContent = state.rules.length ? String(state.rules.length) : '';
  $('#ruleEmpty').hidden = state.rules.length > 0;
  list.hidden = state.rules.length === 0;

  state.rules.forEach((rule, index) => {
    const li = document.createElement('li');
    li.className = 'rule-item';
    li.draggable = true;
    li.dataset.index = String(index);
    li.tabIndex = 0;
    if (index === state.selectedRule) li.classList.add('selected');
    if (rule.enabled === false) li.classList.add('disabled');

    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.title = '拖拽调整顺序';
    grip.appendChild(makeIcon('grip'));

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = rule.enabled !== false;
    check.title = '启用 / 停用';
    check.setAttribute('aria-label', `启用或停用第 ${index + 1} 条规则`);
    check.addEventListener('click', (event) => event.stopPropagation());
    check.addEventListener('change', () => {
      rule.enabled = check.checked;
      renderRules();
      schedulePreview();
    });

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String(index + 1);

    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = describeRule(rule);
    desc.title = desc.textContent;

    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = rule.type;

    li.append(grip, check, idx, desc, kind);
    li.addEventListener('click', () => openInspector(index));
    li.addEventListener('keydown', (event) => {
      if (event.target !== li) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openInspector(index);
      }
    });
    li.addEventListener('dragstart', (event) => {
      state.dragRule = index;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
      requestAnimationFrame(() => li.classList.add('dragging'));
    });
    li.addEventListener('dragend', () => {
      state.dragRule = -1;
      $$('.rule-item').forEach((item) => item.classList.remove('dragging', 'drag-over'));
    });
    li.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (event) => {
      event.preventDefault();
      li.classList.remove('drag-over');
      const from = Number(event.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from) && from >= 0) moveRule(from, index);
    });
    list.appendChild(li);
  });
}

function moveRule(from, to) {
  if (from === to || from < 0 || to < 0 || from >= state.rules.length || to >= state.rules.length) return;
  const [rule] = state.rules.splice(from, 1);
  state.rules.splice(to, 0, rule);

  if (state.inspector.open && state.inspector.index >= 0) {
    let index = state.inspector.index;
    if (index === from) index = to;
    else if (from < to && index > from && index <= to) index -= 1;
    else if (from > to && index >= to && index < from) index += 1;
    state.inspector.index = index;
  }
  state.selectedRule = to;
  renderRules();
  schedulePreview();
}

function deleteRuleAt(index) {
  if (index < 0 || index >= state.rules.length) return;
  state.rules.splice(index, 1);
  state.selectedRule = Math.min(index, state.rules.length - 1);
  if (state.inspector.index >= 0) {
    if (state.inspector.index === index) closeInspector();
    else if (state.inspector.index > index) state.inspector.index -= 1;
  }
  renderRules();
  schedulePreview();
}

function clearRules() {
  state.rules = [];
  state.selectedRule = -1;
  closeInspector();
  renderRules();
  schedulePreview();
}

/* ------------------------------- inspector ------------------------------ */

function defaultConfigFor(type) {
  const meta = state.types.find((t) => t.type === type);
  const cfg = {};
  if (!meta) return cfg;
  for (const field of meta.fields) cfg[field.key] = field.default;
  return cfg;
}

function openInspector(index = -1, { focus = false } = {}) {
  const existing = index >= 0 ? state.rules[index] : null;
  if (index >= 0 && !existing) return;
  const type = existing ? existing.type : (state.lastType || 'replace');
  if (!state.types.some((t) => t.type === type)) {
    toast('规则元数据尚未加载完成', 'warn');
    return;
  }

  const previousDraftPreview = state.inspector.draftPreview;
  state.selectedRule = index;
  state.lastType = type;
  state.inspector = {
    open: true,
    index,
    type,
    draft: existing ? { ...existing } : { type, enabled: true, ...defaultConfigFor(type) },
    refs: new Map(),
    draftPreview: false,
  };
  if (previousDraftPreview) runPreview().catch(() => {});
  renderRules();
  $('#ruleInspector').hidden = false;
  $('#inspectorError').hidden = true;
  renderInspector();

  if (focus) {
    setTimeout(() => $('#ruleFields input, #ruleFields select, #ruleFields textarea')?.focus({ preventScroll: true }), 0);
  }
}

function closeInspector({ keepPreview = false } = {}) {
  const hadDraftPreview = state.inspector.draftPreview;
  state.inspector.open = false;
  state.inspector.draftPreview = false;
  state.inspector.refs.clear();
  const panel = $('#ruleInspector');
  if (panel) panel.hidden = true;
  if (hadDraftPreview && !keepPreview) schedulePreview();
}

function renderTypeList() {
  const box = $('#ruleTypeList');
  box.replaceChildren();
  for (const meta of state.types) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `type-btn ${meta.type === state.inspector.type ? 'active' : ''}`;
    btn.textContent = meta.label;
    btn.title = meta.renamerClass || meta.type;
    btn.addEventListener('click', () => {
      if (meta.type === state.inspector.type) return;
      const hadDraftPreview = state.inspector.draftPreview;
      state.inspector.type = meta.type;
      state.lastType = meta.type;
      state.inspector.index = -1;
      state.inspector.draft = { type: meta.type, enabled: true, ...defaultConfigFor(meta.type) };
      state.inspector.draftPreview = false;
      renderInspector();
      if (hadDraftPreview) runPreview().catch(() => {});
    });
    box.appendChild(btn);
  }
}

function renderInspector() {
  if (!state.inspector.open) return;
  const editing = state.inspector.index >= 0;
  const meta = state.types.find((t) => t.type === state.inspector.type);
  $('#inspectorKind').textContent = editing ? `EDIT #${state.inspector.index + 1}` : 'NEW';
  $('#inspectorTitle').textContent = editing ? '编辑规则' : '新建规则';
  $('#inspectorTypeWrap').hidden = editing;
  $('#btnDeleteRuleInline').hidden = !editing;
  $('#btnDeleteRuleInline').onclick = editing ? () => deleteRuleAt(state.inspector.index) : null;
  $('#inspectorError').hidden = true;

  if (!meta) {
    renderHelp(null);
    $('#ruleFields').replaceChildren();
    showInspectorError('找不到该规则类型的参数定义');
    return;
  }

  renderTypeList();
  renderHelp(meta);
  renderFields(meta);
}

/**
 * The help card is generated entirely from RULE_META, so a new rule cannot ship
 * without its summary/help/examples showing up in the inspector.
 */
function renderHelp(meta) {
  const host = $('#inspectorHelp');
  if (!host) return;
  host.replaceChildren();
  if (!meta) return;

  const head = document.createElement('div');
  head.className = 'rule-help-head';
  const title = document.createElement('strong');
  title.className = 'rule-help-title';
  title.textContent = meta.label;
  const badge = document.createElement('span');
  badge.className = 'rule-help-class';
  badge.textContent = meta.renamerClass || meta.type;
  head.append(title, badge);

  const summary = document.createElement('p');
  summary.className = 'rule-help-summary';
  summary.textContent = meta.summary || '';

  const detail = document.createElement('p');
  detail.className = 'rule-help-text';
  detail.textContent = meta.help || '';

  host.append(head, summary);
  if (meta.help) host.append(detail);

  if (Array.isArray(meta.examples) && meta.examples.length) {
    const details = document.createElement('details');
    details.className = 'rule-examples';
    const summaryEl = document.createElement('summary');
    summaryEl.textContent = `💡 典型案例 (Examples) · ${meta.examples.length}`;
    const list = document.createElement('div');
    list.className = 'example-list';

    for (const example of meta.examples) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'example-btn';
      button.title = '点击填入此示例';

      const flow = document.createElement('span');
      flow.className = 'example-flow';
      const input = document.createElement('code');
      input.textContent = example.input ?? '';
      const arrow = document.createElement('span');
      arrow.className = 'example-arrow';
      arrow.textContent = '→';
      const output = document.createElement('code');
      output.textContent = example.output ?? '';
      flow.append(input, arrow, output);

      const config = document.createElement('span');
      config.className = 'example-config';
      config.textContent = describeExampleConfig(example.config);

      button.append(flow, config);
      button.addEventListener('click', () => applyExample(meta, example));
      list.append(button);
    }

    details.append(summaryEl, list);
    host.append(details);
  }
}

function describeExampleConfig(config) {
  if (!config || typeof config !== 'object') return '';
  return Object.entries(config)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(' · ');
}

function applyExample(meta, example) {
  const config = { ...defaultConfigFor(meta.type), ...(example.config || {}) };
  const keepExamplesOpen = Boolean($('#inspectorHelp details')?.open);
  state.inspector.draft = { type: meta.type, enabled: true, ...config };
  state.inspector.draftPreview = false;
  renderInspector();
  const details = $('#inspectorHelp details');
  if (details && keepExamplesOpen) details.open = true;
  previewDraft().catch(() => {});
}

function showInspectorError(message) {
  const box = $('#inspectorError');
  box.textContent = message;
  box.hidden = false;
}

function renderFields(meta) {
  const host = $('#ruleFields');
  host.replaceChildren();
  state.inspector.refs = new Map();
  const config = state.inspector.draft || {};

  for (const field of meta.fields) {
    const value = config[field.key] !== undefined ? config[field.key] : field.default;

    if (field.kind === 'bool') {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      const row = document.createElement('label');
      row.className = 'field-row';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value === true;
      const text = document.createElement('span');
      text.textContent = field.label;
      row.append(input, text);
      wrap.appendChild(row);
      appendFieldHint(wrap, field);
      host.appendChild(wrap);
      state.inspector.refs.set(field.key, () => input.checked);
      continue;
    }

    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    const id = `rule-field-${field.key}`;
    label.htmlFor = id;
    label.textContent = field.label;
    wrap.appendChild(label);
    let control = null;

    if (field.kind === 'select') {
      const select = document.createElement('select');
      select.id = id;
      for (const option of field.options || []) {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        if (String(value) === String(option.value)) opt.selected = true;
        select.appendChild(opt);
      }
      wrap.appendChild(select);
      state.inspector.refs.set(field.key, () => select.value);
    } else if (field.kind === 'textarea') {
      const area = document.createElement('textarea');
      area.id = id;
      area.rows = field.key === 'content' ? 7 : field.key === 'source' ? 6 : 5;
      area.spellcheck = false;
      area.value = String(value ?? '');
      wrap.appendChild(area);
      control = area;
      state.inspector.refs.set(field.key, () => area.value);
    } else {
      const input = document.createElement('input');
      input.id = id;
      input.type = field.kind === 'number' ? 'number' : 'text';
      input.value = value === undefined || value === null ? '' : String(value);
      input.spellcheck = false;
      if (field.kind === 'number') {
        input.min = '0';
        input.step = '1';
      }
      wrap.appendChild(input);
      control = input;
      state.inspector.refs.set(field.key, () => (field.kind === 'number' ? Number(input.value) : input.value));
    }
    appendFieldHint(wrap, field);
    if (control && field.metaTags) appendMetaTagButton(wrap, control);
    host.appendChild(wrap);
  }
}

function appendFieldHint(wrap, field) {
  if (!field.hint) return;
  const hint = document.createElement('span');
  hint.className = 'field-hint';
  hint.textContent = field.hint;
  wrap.appendChild(hint);
}

function appendMetaTagButton(wrap, control) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'meta-tag-btn';
  button.textContent = '🏷 插入元标签';
  button.title = '把日期、文件大小、父文件夹名等元标签插入到当前光标位置';
  button.addEventListener('click', () => openMetaTagPicker(control));
  wrap.appendChild(button);
}

/* ------------------------------ meta tags ------------------------------- */

function openMetaTagPicker(control) {
  if (!state.metaTags.length) {
    toast('元标签尚未加载完成，请稍后重试', 'warn');
    return;
  }
  state.metaTagPicker = { open: true, control, field: null, selected: 0 };
  renderMetaTagPicker();
  const modal = $('#metaTagModal');
  modal.hidden = false;
  setTimeout(() => $('#metaTagList .meta-tag-item.active')?.focus({ preventScroll: true }), 0);
}

function closeMetaTagPicker() {
  const control = state.metaTagPicker.control;
  state.metaTagPicker.open = false;
  state.metaTagPicker.control = null;
  $('#metaTagModal').hidden = true;
  if (control) control.focus({ preventScroll: true });
}

function renderMetaTagPicker() {
  const list = $('#metaTagList');
  list.replaceChildren();
  state.metaTags.forEach((tag, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'meta-tag-item';
    button.setAttribute('role', 'option');
    button.dataset.index = String(index);
    const name = document.createElement('strong');
    name.textContent = tag.label;
    const token = document.createElement('code');
    token.textContent = tag.token;
    button.append(name, token);
    button.addEventListener('click', () => selectMetaTag(index));
    button.addEventListener('dblclick', () => insertSelectedMetaTag());
    list.appendChild(button);
  });
  selectMetaTag(state.metaTagPicker.selected);
}

function selectMetaTag(index) {
  if (index < 0 || index >= state.metaTags.length) return;
  state.metaTagPicker.selected = index;
  $$('#metaTagList .meta-tag-item').forEach((item, itemIndex) => {
    const active = itemIndex === index;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const tag = state.metaTags[index];
  $('#metaTagName').textContent = tag.label;
  $('#metaTagToken').textContent = tag.token;
  $('#metaTagDesc').textContent = tag.description;
  $('#metaTagExample').textContent = tag.example || '';
}

function insertSelectedMetaTag() {
  const tag = state.metaTags[state.metaTagPicker.selected];
  const control = state.metaTagPicker.control;
  if (!tag || !control) return;
  const start = Number.isInteger(control.selectionStart) ? control.selectionStart : control.value.length;
  const end = Number.isInteger(control.selectionEnd) ? control.selectionEnd : start;
  control.value = `${control.value.slice(0, start)}${tag.token}${control.value.slice(end)}`;
  control.dispatchEvent(new Event('input', { bubbles: true }));
  closeMetaTagPicker();
  control.focus({ preventScroll: true });
  try {
    control.setSelectionRange(start + tag.token.length, start + tag.token.length);
  } catch {
    /* some input types do not expose selection */
  }
}

function moveMetaTagSelection(delta) {
  if (!state.metaTagPicker.open) return;
  const count = state.metaTags.length;
  if (!count) return;
  const next = (state.metaTagPicker.selected + delta + count) % count;
  selectMetaTag(next);
  $$('#metaTagList .meta-tag-item')[next]?.focus({ preventScroll: true });
}

function applyInspector() {
  if (!state.inspector.open) return;
  const meta = state.types.find((t) => t.type === state.inspector.type);
  if (!meta) {
    showInspectorError('找不到该规则类型的参数定义');
    return;
  }

  const config = {};
  try {
    for (const [key, read] of state.inspector.refs) config[key] = read();
  } catch (err) {
    showInspectorError(err.message);
    return;
  }

  const editing = state.inspector.index >= 0;
  if (editing && state.rules[state.inspector.index]) {
    const current = state.rules[state.inspector.index];
    state.rules[state.inspector.index] = {
      ...current,
      type: state.inspector.type,
      enabled: current.enabled !== false,
      ...config,
    };
    state.selectedRule = state.inspector.index;
  } else {
    state.rules.push({ type: state.inspector.type, enabled: true, ...config });
    state.selectedRule = state.rules.length - 1;
  }

  state.lastType = state.inspector.type;
  closeInspector({ keepPreview: true });
  renderRules();
  runPreview().catch(() => {});
}

/* ------------------------------- actions -------------------------------- */

async function scanPaths(paths, mode = 'append') {
  if (!paths || !paths.length) return;
  setBadge('扫描中…', 'busy');
  try {
    const data = await api('/api/scan', {
      method: 'POST',
      body: { paths, mode, options: { ...state.scanOptions }, autoPreview: true },
    });
    if (data.truncated) toast('已达到扫描上限，结果被截断', 'warn');
    if (data.skippedDirs) toast(`${data.skippedDirs} 个目录无法读取或没有权限，已跳过`, 'warn', 7000);
    toast(`已加入 ${data.added} 个文件（共 ${data.total}）`, 'ok');
    applyStats(data.stats);
    setTotal(data.total);
    if (data.added > 0) {
      // Import should reveal what was imported: the default "focus" view hides
      // unchanged rows (and therefore most nested files before a rule is added),
      // so switch to the complete list after a successful scan.
      state.view = 'all';
      $$('#viewTabs .tab').forEach((tab) => {
        const active = tab.dataset.view === 'all';
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }
    await refreshGrid();
    await refreshBatches();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    setBadge('就绪');
    updateRenameButton();
  }
}

const schedulePreview = debounce(() => {
  if (!state.autoPreview) return;
  runPreview().catch(() => {});
}, 260);

async function runPreview() {
  if (state.mutation) return;
  const seq = ++state.previewSeq;
  if (state.previewAbort) state.previewAbort.abort();
  const controller = new AbortController();
  state.previewAbort = controller;

  setBusy(true, '计算预览…');
  setBadge('计算中…', 'busy');
  try {
    const data = await api('/api/preview', {
      method: 'POST',
      body: { rules: state.rules, options: { autoFixConflicts: state.autoFix } },
      signal: controller.signal,
    });
    if (seq !== state.previewSeq) return;

    const revision = Number(data.revision);
    if (Number.isFinite(revision)) state.revision = Math.max(state.revision, revision);
    applyStats(data.stats);
    if (data.conflictReport && data.conflictReport.fixed) {
      toast(`已自动修复 ${data.conflictReport.fixed} 个冲突`, 'warn');
    }
    await refreshGrid();
    if (seq !== state.previewSeq) return;

    const elapsed = data.elapsedMs != null ? `${data.elapsedMs} ms` : '完成';
    setPerf(`预览 ${elapsed} · ${Number(data.stats?.total || 0).toLocaleString('zh-CN')} 项`);
    setBadge('就绪', 'ok');
  } catch (err) {
    if (isAbort(err) || seq !== state.previewSeq) return;
    toast(err.message, 'bad', 8000);
    setBadge('预览失败', 'err');
  } finally {
    if (state.previewAbort === controller) state.previewAbort = null;
    if (seq === state.previewSeq) {
      setBusy(false);
      updateRenameButton();
    }
  }
}

function draftRuleStack() {
  const draft = {
    type: state.inspector.type,
    enabled: true,
    ...(state.inspector.draft || {}),
  };
  const rules = state.rules.slice();
  if (state.inspector.index >= 0 && rules[state.inspector.index]) {
    rules[state.inspector.index] = draft;
  } else {
    rules.push(draft);
  }
  return rules;
}

/**
 * Preview the unsaved inspector draft without committing it to `state.rules`.
 * The server marks this request `transient` and restores its rule stack after
 * evaluation, so closing the editor can never leave a phantom rule behind.
 */
async function previewDraft() {
  if (!state.inspector.open || state.mutation) return;
  const seq = ++state.previewSeq;
  if (state.previewAbort) state.previewAbort.abort();
  const controller = new AbortController();
  state.previewAbort = controller;
  // Mark the draft before the request leaves: closing the editor while the
  // request is in flight must still schedule a committed-stack restore.
  state.inspector.draftPreview = true;

  setBusy(true, '示例预览…');
  setBadge('计算中…', 'busy');
  try {
    const data = await api('/api/preview', {
      method: 'POST',
      body: {
        rules: draftRuleStack(),
        transient: true,
        options: { autoFixConflicts: state.autoFix },
      },
      signal: controller.signal,
    });
    if (!state.inspector.open || seq !== state.previewSeq) return;

    const revision = Number(data.revision);
    if (Number.isFinite(revision)) state.revision = Math.max(state.revision, revision);
    applyStats(data.stats);
    await refreshGrid();
    if (!state.inspector.open || seq !== state.previewSeq) return;
    const elapsed = data.elapsedMs != null ? `${data.elapsedMs} ms` : '完成';
    setPerf(`示例预览 ${elapsed} · ${Number(data.stats?.total || 0).toLocaleString('zh-CN')} 项`);
    setBadge('示例已填充', 'ok');
  } catch (err) {
    if (isAbort(err) || seq !== state.previewSeq) return;
    toast(err.message, 'bad', 8000);
    setBadge('预览失败', 'err');
  } finally {
    if (state.previewAbort === controller) state.previewAbort = null;
    if (seq === state.previewSeq) {
      setBusy(false);
      updateRenameButton();
    }
  }
}

async function doRename() {
  if (state.busy || state.mutation) return;
  if (state.inspector.open) {
    toast('请先「应用并预览」或取消当前规则编辑', 'warn');
    return;
  }
  const s = state.stats;
  if (!s.changed) {
    toast('没有可执行的重命名项', 'warn');
    return;
  }
  const ok = window.confirm(
    `即将重命名 ${s.changed} 个文件。\n冲突 ${s.conflicts} 个、错误 ${s.errors} 个将被跳过。\n\n继续？`,
  );
  if (!ok) return;

  if (state.previewAbort) state.previewAbort.abort();
  state.previewSeq += 1;
  state.mutation = true;
  setBusy(true, '重命名中…');
  setBadge('重命名中…', 'busy');
  try {
    const data = await api('/api/rename', { method: 'POST', body: {} });
    const revision = Number(data.revision);
    if (Number.isFinite(revision)) state.revision = Math.max(state.revision, revision);
    if (data.stats) applyStats(data.stats);
    toast(`已完成 ${data.count} 个文件`, 'ok', 6000);
    await refreshGrid();
    await refreshBatches();
    setBadge('就绪', 'ok');
  } catch (err) {
    toast(err.message, 'bad', 8000);
    setBadge('重命名失败', 'err');
    await refreshGrid();
  } finally {
    state.mutation = false;
    setBusy(false);
    updateRenameButton();
  }
}

async function doUndo() {
  if (state.busy || state.mutation) return;
  const batch = state.batches[0];
  if (!batch) {
    toast('没有可撤销的批次', 'warn');
    return;
  }
  if (!window.confirm(`撤销批次 ${batch.batchId}（${batch.count} 个文件）？`)) return;

  if (state.previewAbort) state.previewAbort.abort();
  state.previewSeq += 1;
  state.mutation = true;
  updateRenameButton();
  setBadge('撤销中…', 'busy');
  try {
    const data = await api('/api/undo', { method: 'POST', body: { batchId: batch.batchId } });
    const revision = Number(data.revision);
    if (Number.isFinite(revision)) state.revision = Math.max(state.revision, revision);
    if (data.stats) applyStats(data.stats);
    toast(`已恢复 ${data.restored}/${data.total} 个文件`, 'ok');
    await refreshGrid();
    await refreshBatches();
    setBadge('就绪', 'ok');
  } catch (err) {
    toast(err.message, 'bad', 8000);
    setBadge('撤销失败', 'err');
  } finally {
    state.mutation = false;
    updateRenameButton();
    refreshBatches().catch(() => {});
  }
}

async function refreshBatches() {
  try {
    const data = await api('/api/batches');
    state.batches = data.batches || [];
    const first = state.batches[0];
    if (first) {
      const when = String(first.createdAt || '').slice(0, 16).replace('T', ' ');
      $('#undoInfo').textContent = `可撤销：${first.count} 个文件 · ${when}`;
    } else {
      $('#undoInfo').textContent = 'Undo: 无';
    }
    $('#btnUndo').disabled = !first || state.busy;
  } catch {
    /* history is advisory */
  }
}

/* ------------------------------ selection ------------------------------- */

async function applySelection(row, selected, checkbox) {
  if (checkbox) checkbox.disabled = true;
  try {
    const data = await api('/api/selection', {
      method: 'POST',
      body: { ids: [row.id], selected },
    });
    row.selected = selected;
    if (checkbox) {
      checkbox.checked = selected;
      checkbox.closest('.grid-row')?.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
    if (data.stats) applyStats(data.stats);
    else refreshStatsOnly();
  } catch (err) {
    if (checkbox) checkbox.checked = !selected;
    toast(err.message, 'bad');
  } finally {
    if (checkbox) checkbox.disabled = false;
  }
}

async function applySelectAll(selected) {
  const all = $('#chkAll');
  all.disabled = true;
  try {
    const data = await api('/api/selection', { method: 'POST', body: { selected } });
    if (data.stats) applyStats(data.stats);
    await refreshGrid();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    all.disabled = false;
  }
}

async function toggleRowSelection(rowEl) {
  const index = Number(rowEl.dataset.index);
  if (!Number.isInteger(index)) return;
  const page = state.pages.get(Math.floor(index / PAGE));
  const row = page ? page[index % PAGE] : null;
  if (!row) return;
  const checkbox = rowEl.querySelector('input[type="checkbox"]');
  const selected = !(row.selected !== false);
  if (checkbox) checkbox.checked = selected;
  await applySelection(row, selected, checkbox);
}

/* -------------------------------- presets ------------------------------- */

async function refreshPresets(selectName) {
  try {
    const data = await api('/api/presets');
    const select = $('#presetSelect');
    select.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '（无预设）';
    select.appendChild(none);
    for (const preset of data.presets || []) {
      const opt = document.createElement('option');
      opt.value = preset.name;
      opt.textContent = `${preset.name}${preset.corrupt ? ' ⚠' : ` (${preset.rules})`}`;
      select.appendChild(opt);
    }
    const target = selectName ?? data.lastUsed;
    if (target) select.value = target;
  } catch (err) {
    toast(err.message, 'bad');
  }
}

/* --------------------------------- SSE ---------------------------------- */

const remoteRefresh = debounce(() => {
  refreshGrid().catch(() => {});
  refreshBatches().catch(() => {});
}, 220);

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => {
    setConnection(true);
    setBadge('就绪', 'ok');
  };
  es.onerror = () => {
    setConnection(false);
    setBadge('连接中断', 'err');
  };
  es.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      const revision = Number(msg.revision);
      if (Number.isFinite(revision)) state.revision = Math.max(state.revision, revision);
    } else if (msg.type === 'progress') {
      if (msg.phase === 'scan') setBadge(`扫描 ${msg.kept} 项…`, 'busy');
      if (msg.phase === 'rename') setBadge(`重命名 ${msg.done}/${msg.total}`, 'busy');
    } else if (msg.type === 'renamed') {
      setBadge('就绪', 'ok');
      remoteRefresh();
    } else if (msg.type === 'error') {
      setBadge('出错', 'err');
      toast(msg.message || '宿主报错', 'bad');
    } else if (msg.type === 'log') {
      toast(msg.message, 'info');
    } else if (msg.type === 'bye') {
      setConnection(false);
      setBadge('宿主已退出', 'err');
      toast('宿主进程已退出，重新运行 start.cmd 即可恢复', 'warn', 10000);
    }
  };
}

/* -------------------------------- wiring -------------------------------- */

async function pickAndScan(kind) {
  setBadge('等待选择…', 'busy');
  try {
    const result = await api(`/api/pick?kind=${encodeURIComponent(kind)}`);
    if (result.ok) await scanPaths(result.paths);
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    if (!state.busy) setBadge('就绪');
  }
}

function forceRefresh() {
  if (state.mutation) {
    toast('重命名或撤销仍在进行，请稍候再刷新', 'warn');
    return;
  }
  refreshBatches().catch(() => {});
  runPreview().catch(() => {});
}

function bind() {
  $('#btnAddRule').addEventListener('click', () => openInspector(-1, { focus: true }));
  $('#btnAddFirstRule').addEventListener('click', () => openInspector(-1, { focus: true }));
  $('#btnInspectorClose').addEventListener('click', closeInspector);
  $('#btnInspectorCancel').addEventListener('click', closeInspector);
  $('#btnInspectorApply').addEventListener('click', applyInspector);
  $('#btnMetaTagClose').addEventListener('click', closeMetaTagPicker);
  $('#btnMetaTagCancel').addEventListener('click', closeMetaTagPicker);
  $('#btnMetaTagInsert').addEventListener('click', insertSelectedMetaTag);
  $('#metaTagModal').addEventListener('click', (event) => {
    if (event.target === $('#metaTagModal')) closeMetaTagPicker();
  });
  $('#metaTagModal').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMetaTagPicker();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      moveMetaTagSelection(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      moveMetaTagSelection(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      insertSelectedMetaTag();
    }
  });

  $('#btnDeleteRule').addEventListener('click', () => {
    if (state.selectedRule < 0) return toast('先选中一条规则', 'warn');
    deleteRuleAt(state.selectedRule);
  });
  $('#btnClearRules').addEventListener('click', () => {
    if (!state.rules.length) return;
    if (!window.confirm('清空整个规则栈？')) return;
    clearRules();
  });
  $('#btnRuleUp').addEventListener('click', () => {
    if (state.selectedRule <= 0) return;
    moveRule(state.selectedRule, state.selectedRule - 1);
  });
  $('#btnRuleDown').addEventListener('click', () => {
    const i = state.selectedRule;
    if (i < 0 || i >= state.rules.length - 1) return;
    moveRule(i, i + 1);
  });

  $('#btnAddFiles').addEventListener('click', () => pickAndScan('files'));
  $('#btnAddFolders').addEventListener('click', () => pickAndScan('folders'));
  const recurseToggle = $('#chkRecurse');
  if (recurseToggle) {
    recurseToggle.checked = state.scanOptions.recurse !== false;
    recurseToggle.addEventListener('change', () => {
      state.scanOptions.recurse = recurseToggle.checked;
    });
  }

  $('#btnClearFiles').addEventListener('click', async () => {
    if (state.stats.total && !window.confirm('清空文件列表？')) return;
    try {
      const data = await api('/api/clear', { method: 'POST', body: {} });
      gridReset();
      state.pages.clear();
      setTotal(0);
      applyStats(data.stats || { ...EMPTY_STATS });
      setBadge('就绪', 'ok');
      renderWindow();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  $('#btnPreview').addEventListener('click', () => runPreview().catch(() => {}));
  $('#btnRename').addEventListener('click', () => doRename());
  $('#btnUndo').addEventListener('click', () => doUndo());
  $('#btnExport').addEventListener('click', () => window.open('/api/export?format=csv', '_blank'));
  $('#btnExportJson').addEventListener('click', () => window.open('/api/export?format=json', '_blank'));

  $('#chkAutoPreview').addEventListener('change', (event) => {
    state.autoPreview = event.target.checked;
    if (state.autoPreview) schedulePreview();
  });
  $('#chkAutoFix').addEventListener('change', (event) => {
    state.autoFix = event.target.checked;
    schedulePreview();
  });
  $('#btnFixConflicts').addEventListener('click', () => {
    state.autoFix = true;
    $('#chkAutoFix').checked = true;
    runPreview().catch(() => {});
  });

  $('#searchBox').addEventListener('input', debounce((event) => {
    state.q = event.target.value.trim();
    refreshGrid({ resetScroll: true }).catch(() => {});
  }, 240));
  $('#searchBox').addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && event.target.value) {
      event.target.value = '';
      state.q = '';
      refreshGrid({ resetScroll: true }).catch(() => {});
      event.stopPropagation();
    }
  });

  for (const tab of $$('#viewTabs .tab')) {
    tab.addEventListener('click', () => {
      if (state.view === tab.dataset.view) return;
      $$('#viewTabs .tab').forEach((t) => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      state.view = tab.dataset.view;
      refreshGrid({ resetScroll: true }).catch(() => {});
    });
  }

  $('#chkAll').addEventListener('change', (event) => applySelectAll(event.target.checked));

  vp.addEventListener('scroll', () => {
    requestAnimationFrame(() => renderWindow());
  }, { passive: true });
  window.addEventListener('resize', debounce(() => renderWindow(), 120));

  window.addEventListener('keydown', onHotkeys);

  const filesPanel = $('.files-panel');
  filesPanel.addEventListener('dragover', (event) => {
    event.preventDefault();
    filesPanel.classList.add('dragging');
  });
  filesPanel.addEventListener('dragleave', () => filesPanel.classList.remove('dragging'));
  filesPanel.addEventListener('drop', (event) => {
    event.preventDefault();
    filesPanel.classList.remove('dragging');
    toast('浏览器拖拽拿不到本地绝对路径，请用「添加文件 / 添加目录」', 'warn', 6000);
  });

  $('#btnLoadPreset').addEventListener('click', async () => {
    const name = $('#presetSelect').value;
    if (!name) return toast('先选一个预设', 'warn');
    try {
      const data = await api('/api/presets', { method: 'POST', body: { action: 'load', name } });
      state.rules = data.rules || [];
      state.selectedRule = -1;
      closeInspector();
      renderRules();
      const revision = Number(data.revision);
      if (Number.isFinite(revision)) state.revision = Math.max(state.revision, revision);
      if (data.stats) applyStats(data.stats);
      await refreshGrid();
      toast(`已载入预设「${name}」`, 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  $('#btnSavePreset').addEventListener('click', async () => {
    const name = $('#presetSelect').value;
    if (!name) return toast('先选一个预设，或用「另存为」', 'warn');
    try {
      await api('/api/presets', { method: 'POST', body: { name, rules: state.rules } });
      await refreshPresets(name);
      toast(`已保存预设「${name}」`, 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  $('#btnSaveAsPreset').addEventListener('click', async () => {
    const name = window.prompt('预设名称', `preset-${new Date().toISOString().slice(0, 10)}`);
    if (!name) return;
    try {
      await api('/api/presets', { method: 'POST', body: { name, rules: state.rules } });
      await refreshPresets(name);
      toast(`已保存预设「${name}」`, 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  $('#btnDeletePreset').addEventListener('click', async () => {
    const name = $('#presetSelect').value;
    if (!name) return;
    if (!window.confirm(`删除预设「${name}」？`)) return;
    try {
      await api('/api/presets', { method: 'POST', body: { action: 'delete', name } });
      await refreshPresets('');
      toast('已删除', 'ok');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });
}

function onHotkeys(event) {
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  const editable = isEditable(event.target);

  if (mod && key === 'n') {
    event.preventDefault();
    openInspector(-1, { focus: true });
    return;
  }
  if (mod && key === 'o') {
    event.preventDefault();
    pickAndScan('files');
    return;
  }
  if (mod && key === 'enter') {
    event.preventDefault();
    if (!event.repeat) doRename();
    return;
  }
  if (mod && key === 'z' && !event.shiftKey && !editable) {
    event.preventDefault();
    if (!event.repeat) doUndo();
    return;
  }
  if (event.key === 'F5' || (mod && key === 'r')) {
    event.preventDefault();
    if (!event.repeat) forceRefresh();
    return;
  }
  if (event.key === 'Escape') {
    if (state.inspector.open) {
      event.preventDefault();
      closeInspector();
    }
    return;
  }
  if (!editable && key === '/' && !mod) {
    event.preventDefault();
    $('#searchBox').focus();
    return;
  }
  if (event.key === ' ' && !editable) {
    const row = event.target?.closest?.('.grid-row');
    if (row && row.dataset.index !== undefined) {
      event.preventDefault();
      toggleRowSelection(row);
    }
    return;
  }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !editable) {
    const row = event.target?.closest?.('.grid-row');
    if (!row) return;
    const sibling = event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling;
    if (sibling && sibling.classList.contains('grid-row')) {
      event.preventDefault();
      sibling.focus({ preventScroll: false });
    }
  }
}

/* --------------------------------- boot --------------------------------- */

async function boot() {
  bind();
  connectEvents();
  setTotal(0);
  applyStats({ ...EMPTY_STATS });

  try {
    const data = await api('/api/rule-types');
    state.types = data.types || [];
    state.metaTags = data.metaTags || [];
  } catch (err) {
    toast(`规则元数据加载失败：${err.message}`, 'bad');
  }

  renderRules();
  await refreshPresets();
  await refreshBatches();
  await refreshGrid();
  setBadge('就绪', 'ok');
  updateRenameButton();
}

boot().catch((err) => {
  setBadge('启动失败', 'err');
  toast(`前端启动失败：${err.message}`, 'bad', 10000);
});
