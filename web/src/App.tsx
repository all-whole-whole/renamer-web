import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, ToastProvider, useToast } from '@ui/components';
import { Button, Input } from '@ui/components';
import { api, connectEvents, onOffline, type StreamPayload } from './api';
import type {
  BatchSummary,
  FileRow,
  MetaTag,
  PresetSummary,
  Rule,
  RuleType,
  ScanOptions,
  Stats,
  ViewKey,
} from './types';
import { ruleDefaults } from './lib/util';
import { TopBar } from './components/TopBar';
import { RulesPanel } from './components/RulesPanel';
import { RuleInspector } from './components/RuleInspector';
import { FilesPanel } from './components/FilesPanel';
import './styles/app.css';

const EMPTY_STATS: Stats = {
  total: 0,
  changed: 0,
  unchanged: 0,
  conflicts: 0,
  errors: 0,
  selected: 0,
  issues: 0,
  actionable: 0,
  ready: 0,
};

const PAGE_SIZE = 100;

interface InspectorState {
  open: boolean;
  mode: 'new' | 'edit';
  index: number | null;
  draft: Rule | null;
}

function newId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function Workbench() {
  const toast = useToast();
  const [types, setTypes] = useState<RuleType[]>([]);
  const [metaTags, setMetaTags] = useState<MetaTag[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [presets, setPresets] = useState<PresetSummary[]>([]);
  const [presetName, setPresetName] = useState('');
  const [rows, setRows] = useState<FileRow[]>([]);
  const [stats, setStats] = useState<Stats>(EMPTY_STATS);
  const [total, setTotal] = useState(0);
  const [grandTotal, setGrandTotal] = useState(0);
  const [view, setView] = useState<ViewKey>('focus');
  const [query, setQuery] = useState('');
  const [connected, setConnected] = useState(true);
  const [status, setStatus] = useState('就绪');
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; done: number; total: number } | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [options, setOptions] = useState({ recurse: true, autoPreview: true, autoFix: false, firstDotIsExt: false });
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [inspector, setInspector] = useState<InspectorState>({ open: false, mode: 'new', index: null, draft: null });
  const [prompt, setPrompt] = useState<{ open: boolean; mode: 'saveAs' | 'delete'; value: string }>({
    open: false,
    mode: 'saveAs',
    value: '',
  });

  const rulesRef = useRef(rules);
  rulesRef.current = rules;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const viewRef = useRef(view);
  viewRef.current = view;
  const queryRef = useRef(query);
  queryRef.current = query;
  const skipAuto = useRef(true);
  const searchTimer = useRef<number | null>(null);

  const previewOptions = useCallback(
    () => ({
      autoFixConflicts: optionsRef.current.autoFix,
      overwriteWithNewName: false,
      firstDotIsExt: optionsRef.current.firstDotIsExt,
    }),
    [],
  );

  /* ----------------------------------------------------------------- 文件 */

  const loadFiles = useCallback(
    async (mode: 'replace' | 'append' = 'replace', override?: { view?: ViewKey; query?: string }) => {
      const nextView = override?.view ?? viewRef.current;
      const nextQuery = override?.query ?? queryRef.current;
      const offset = mode === 'append' ? rows.length : 0;
      if (mode === 'append') setLoadingMore(true);
      try {
        const data = await api.files(nextView, offset, PAGE_SIZE, nextQuery);
        setRows((current) => (mode === 'append' ? [...current, ...data.rows] : data.rows));
        setStats(data.stats);
        setTotal(data.total);
        setGrandTotal(data.grandTotal);
        setConnected(true);
      } catch (error) {
        toast(`读取文件列表失败：${(error as Error).message}`, { tone: 'danger' });
        setConnected(false);
      } finally {
        setLoadingMore(false);
      }
    },
    [rows.length, toast],
  );

  /* --------------------------------------------------------------- 预览 */

  const runPreview = useCallback(
    async (nextRules?: Rule[], silent = false) => {
      const list = nextRules ?? rulesRef.current;
      setBusy(true);
      if (!silent) setStatus('预览中…');
      try {
        await api.preview(list, previewOptions());
        await loadFiles('replace');
        setProgress(null);
        setStatus('就绪');
      } catch (error) {
        toast(`预览失败：${(error as Error).message}`, { tone: 'danger' });
        setStatus('预览失败');
      } finally {
        setBusy(false);
      }
    },
    [loadFiles, previewOptions, toast],
  );

  /* --------------------------------------------------------------- 扫描 */

  const scan = useCallback(
    async (kind: 'files' | 'folders') => {
      setBusy(true);
      setStatus('等待选择…');
      try {
        const picked = await api.pick(kind);
        if (!picked.ok || picked.paths.length === 0) {
          setStatus('就绪');
          return;
        }
        setStatus('扫描中…');
        const scanOptions: ScanOptions = { recurse: optionsRef.current.recurse };
        const result = await api.scan(picked.paths, scanOptions, 'replace');
        setStats(result.stats);
        await loadFiles('replace');
        setProgress(null);
        setStatus('就绪');
        toast(`已导入 ${result.added} 个文件`);
      } catch (error) {
        toast(`扫描失败：${(error as Error).message}`, { tone: 'danger' });
        setStatus('扫描失败');
      } finally {
        setBusy(false);
      }
    },
    [loadFiles, toast],
  );

  /* --------------------------------------------------------------- 启动 */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [meta, presetData, batchData] = await Promise.all([api.ruleTypes(), api.presets(), api.batches()]);
        if (cancelled) return;
        setTypes(meta.types);
        setMetaTags(meta.metaTags);
        setPresets(presetData.presets);
        setPresetName(presetData.lastUsed || presetData.presets[0]?.name || '');
        setBatches(batchData.batches);
        await loadFiles('replace');
      } catch (error) {
        if (cancelled) return;
        setConnected(false);
        toast(`无法连接本地服务：${(error as Error).message}`, { tone: 'danger' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------- 自动预览 */

  useEffect(() => {
    if (skipAuto.current) {
      skipAuto.current = false;
      return;
    }
    if (!optionsRef.current.autoPreview) return;
    const timer = window.setTimeout(() => {
      void runPreview(rules, true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [rules, runPreview]);

  /* ----------------------------------------------------------------- SSE */

  useEffect(() => {
    const close = connectEvents({
      onOpen: () => setConnected(true),
      onDown: () => setConnected(false),
      onEvent: (payload: StreamPayload) => {
        const type = payload.type ?? payload.phase;
        if (type === 'progress') {
          if (payload.phase === 'scan') {
            setProgress({ phase: 'scan', done: payload.scanned ?? 0, total: 0 });
          } else if (payload.phase === 'rename') {
            setProgress({ phase: 'rename', done: payload.done ?? 0, total: payload.total ?? 0 });
          }
        } else if (type === 'renamed') {
          setProgress(null);
          toast(`已重命名 ${payload.count ?? 0} 个文件`, { tone: 'success' });
          void api.batches().then((data) => setBatches(data.batches));
          void loadFiles('replace');
        } else if (type === 'log') {
          toast(payload.message ?? '', { tone: 'neutral' });
        } else if (type === 'error') {
          setProgress(null);
          toast(payload.message ?? '任务失败', { tone: 'danger' });
        }
      },
    });
    return close;
  }, [loadFiles, toast]);

  /* ------------------------------------------------------------- 联机 */

  const markOffline = useCallback(() => setConnected(false), []);
  useEffect(() => onOffline(markOffline), [markOffline]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.hidden) return;
      try {
        const pong = await api.ping();
        if (pong.app === 'renamer-web') setConnected(true);
      } catch {
        setConnected(false);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  /* ------------------------------------------------------------- 规则操作 */

  const openNew = useCallback(() => {
    const first = types[0];
    setInspector({
      open: true,
      mode: 'new',
      index: null,
      draft: first ? ruleDefaults(first, newId()) : null,
    });
  }, [types]);

  const openEdit = useCallback(
    (id: string) => {
      const index = rules.findIndex((rule) => rule.id === id);
      if (index < 0) return;
      setInspector({ open: true, mode: 'edit', index, draft: { ...rules[index]! } });
    },
    [rules],
  );

  const saveInspector = useCallback(() => {
    const { draft, index } = inspector;
    if (!draft) return;
    setRules((current) => {
      const next = [...current];
      if (index === null) next.push(draft);
      else next[index] = draft;
      return next;
    });
    setActiveRuleId(draft.id);
    setInspector({ open: false, mode: 'new', index: null, draft: null });
  }, [inspector]);

  const deleteRule = useCallback(
    (id: string) => {
      setRules((current) => current.filter((rule) => rule.id !== id));
      setActiveRuleId((current) => (current === id ? null : current));
    },
    [],
  );

  const moveRule = useCallback((id: string, delta: number) => {
    setRules((current) => {
      const index = current.findIndex((rule) => rule.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item!);
      return next;
    });
  }, []);

  /* ------------------------------------------------------------- 预设 */

  const loadPreset = useCallback(async () => {
    if (!presetName) return;
    setBusy(true);
    try {
      const data = await api.presetLoad(presetName);
      const loaded = (data.rules ?? []).map((rule) => ({ ...rule, id: rule.id ?? newId() }));
      setRules(loaded);
      setActiveRuleId(null);
      await loadFiles('replace');
      setStatus('就绪');
      toast(`已载入预设「${presetName}」`, { tone: 'success' });
    } catch (error) {
      toast(`载入失败：${(error as Error).message}`, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [loadFiles, presetName, toast]);

  const savePreset = useCallback(
    async (name: string) => {
      if (!name.trim()) return;
      try {
        await api.presetSave(name.trim(), rulesRef.current);
        const data = await api.presets();
        setPresets(data.presets);
        setPresetName(name.trim());
        toast(`预设已保存：${name.trim()}`, { tone: 'success' });
      } catch (error) {
        toast(`保存失败：${(error as Error).message}`, { tone: 'danger' });
      }
    },
    [toast],
  );

  const removePreset = useCallback(async () => {
    if (!presetName) return;
    try {
      await api.presetDelete(presetName);
      const data = await api.presets();
      setPresets(data.presets);
      setPresetName('');
      toast('预设已删除', { tone: 'success' });
    } catch (error) {
      toast(`删除失败：${(error as Error).message}`, { tone: 'danger' });
    }
  }, [presetName, toast]);

  /* ------------------------------------------------------------- 执行 */

  const renameNow = useCallback(async () => {
    setBusy(true);
    setStatus('重命名中…');
    try {
      const result = await api.rename(false);
      toast(`已重命名 ${result.count} 个文件`, { tone: 'success' });
      setProgress(null);
      await runPreview(undefined, true);
      setStatus('就绪');
    } catch (error) {
      toast(`重命名失败：${(error as Error).message}`, { tone: 'danger' });
      setStatus('重命名失败');
      setProgress(null);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [runPreview, toast]);

  const undoLast = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.undo();
      toast(`已撤销 ${result.restored ?? 0} 个文件`, { tone: 'success' });
      await runPreview(undefined, true);
      const data = await api.batches();
      setBatches(data.batches);
    } catch (error) {
      toast(`撤销失败：${(error as Error).message}`, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }, [runPreview, toast]);

  const toggleRow = useCallback(
    async (id: string, selected: boolean) => {
      setRows((current) => current.map((row) => (row.id === id ? { ...row, selected } : row)));
      try {
        const data = await api.selection(selected, [id]);
        setStats(data.stats);
      } catch {
        void loadFiles('replace');
      }
    },
    [loadFiles],
  );

  const selectAll = useCallback(async () => {
    const allSelected = rows.length > 0 && rows.every((row) => row.selected);
    try {
      const data = await api.selection(!allSelected);
      setStats(data.stats);
      await loadFiles('replace');
    } catch (error) {
      toast(`选择失败：${(error as Error).message}`, { tone: 'danger' });
    }
  }, [loadFiles, rows, toast]);

  /* ------------------------------------------------------------- 快捷键 */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void scan('files');
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openNew();
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        if (stats.actionable > 0 && !busy) void renameNow();
      } else if (event.key === 'F5') {
        event.preventDefault();
        void runPreview();
      } else if (event.key === '/' && !typing) {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('.rn-search input')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, openNew, renameNow, runPreview, scan, stats.actionable]);

  /* ------------------------------------------------------------- 渲染 */

  const viewLabel = useMemo(() => {
    const labels: Record<ViewKey, string> = { focus: '关注项', all: '全部', changed: '已改变', issues: '问题项' };
    return `${labels[view]}${query ? ` · 搜索「${query}」` : ''}`;
  }, [query, view]);

  return (
    <div className="rn-app">
      <TopBar
        presets={presets}
        presetName={presetName}
        connected={connected}
        status={status}
        busy={busy}
        onPresetName={setPresetName}
        onLoad={loadPreset}
        onSave={() => (presetName ? savePreset(presetName) : setPrompt({ open: true, mode: 'saveAs', value: '' }))}
        onSaveAs={() => setPrompt({ open: true, mode: 'saveAs', value: presetName })}
        onDelete={() => setPrompt({ open: true, mode: 'delete', value: presetName })}
      />

      <main className="rn-main">
        <RulesPanel
          rules={rules}
          types={types}
          activeId={activeRuleId}
          busy={busy}
          onSelect={setActiveRuleId}
          onNew={openNew}
          onEdit={openEdit}
          onToggle={(id) =>
            setRules((current) =>
              current.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule)),
            )
          }
          onMove={moveRule}
          onDelete={deleteRule}
          onClear={() => {
            setRules([]);
            setActiveRuleId(null);
          }}
        />

        <FilesPanel
          rows={rows}
          stats={stats}
          total={total}
          grandTotal={grandTotal}
          view={view}
          query={query}
          loadingMore={loadingMore}
          busy={busy}
          recurse={options.recurse}
          autoPreview={options.autoPreview}
          autoFix={options.autoFix}
          progress={progress}
          onScanFiles={() => scan('files')}
          onScanFolders={() => scan('folders')}
          onClear={async () => {
            try {
              const data = await api.clear();
              setRows([]);
              setStats(data.stats);
              setTotal(0);
              setGrandTotal(0);
            } catch (error) {
              toast(`清空失败：${(error as Error).message}`, { tone: 'danger' });
            }
          }}
          onView={(next) => {
            setView(next);
            void loadFiles('replace', { view: next });
          }}
          onQuery={(value) => {
            setQuery(value);
            if (searchTimer.current) window.clearTimeout(searchTimer.current);
            searchTimer.current = window.setTimeout(() => {
              void loadFiles('replace', { query: value });
            }, 300);
          }}
          onPreview={() => runPreview()}
          onRename={renameNow}
          onToggleRow={(id, selected) => void toggleRow(id, selected)}
          onSelectAll={() => void selectAll()}
          onLoadMore={() => void loadFiles('append')}
          onRecurse={(value) => setOptions((current) => ({ ...current, recurse: value }))}
          onAutoPreview={(value) => setOptions((current) => ({ ...current, autoPreview: value }))}
          onAutoFix={(value) => setOptions((current) => ({ ...current, autoFix: value }))}
        />
      </main>

      <footer className="rn-bottombar">
        <div className="rn-history">
          <span className="rn-eyebrow">HISTORY</span>
          <span className="rn-muted">
            {batches[0] ? `最近批次 ${batches[0].count} 个 · ${new Date(batches[0].createdAt).toLocaleString()}` : 'Undo: 无'}
          </span>
        </div>
        <Button size="sm" variant="secondary" disabled={busy || batches.length === 0} onClick={undoLast}>
          撤销上次
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.open(api.exportUrl('csv'), '_blank')}>
          导出 CSV
        </Button>
        <Button size="sm" variant="ghost" onClick={() => window.open(api.exportUrl('json'), '_blank')}>
          导出 JSON
        </Button>
        <span className="rn-spacer" />
        <span className={connected ? 'rn-conn is-on' : 'rn-conn is-off'}>
          {connected ? '已连接宿主' : '宿主已断开'} · {viewLabel}
        </span>
      </footer>

      <RuleInspector
        open={inspector.open}
        mode={inspector.mode}
        draft={inspector.draft}
        types={types}
        metaTags={metaTags}
        onType={(type) => {
          const meta = types.find((item) => item.type === type);
          if (!meta) return;
          setInspector((current) =>
            current.draft
              ? { ...current, draft: { ...ruleDefaults(meta, current.draft.id), enabled: current.draft.enabled } }
              : current,
          );
        }}
        onField={(key, value) =>
          setInspector((current) =>
            current.draft ? { ...current, draft: { ...current.draft, [key]: value } } : current,
          )
        }
        onCancel={() => setInspector({ open: false, mode: 'new', index: null, draft: null })}
        onSave={saveInspector}
        onDelete={
          inspector.mode === 'edit' && inspector.draft
            ? () => {
                deleteRule(inspector.draft!.id);
                setInspector({ open: false, mode: 'new', index: null, draft: null });
              }
            : null
        }
      />

      <Dialog
        open={prompt.open && prompt.mode === 'saveAs'}
        onClose={() => setPrompt({ open: false, mode: 'saveAs', value: '' })}
        title="另存为预设"
        description="规则栈会写入数据目录，下次可从「预设」下拉载入。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrompt({ open: false, mode: 'saveAs', value: '' })}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                const name = prompt.value.trim();
                setPrompt({ open: false, mode: 'saveAs', value: '' });
                if (name) void savePreset(name);
              }}
            >
              保存
            </Button>
          </>
        }
      >
        <Input
          autoFocus
          placeholder="预设名称"
          value={prompt.value}
          onChange={(event) => setPrompt((current) => ({ ...current, value: event.target.value }))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const name = (event.target as HTMLInputElement).value.trim();
              setPrompt({ open: false, mode: 'saveAs', value: '' });
              if (name) void savePreset(name);
            }
          }}
        />
      </Dialog>

      <Dialog
        open={prompt.open && prompt.mode === 'delete'}
        onClose={() => setPrompt({ open: false, mode: 'saveAs', value: '' })}
        title="删除预设"
        description={`确定删除「${prompt.value}」？规则栈本身不受影响。`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrompt({ open: false, mode: 'saveAs', value: '' })}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setPrompt({ open: false, mode: 'saveAs', value: '' });
                void removePreset();
              }}
            >
              删除
            </Button>
          </>
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Workbench />
    </ToastProvider>
  );
}
