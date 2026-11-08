import { Button, Card, Checkbox, IconButton, Input, Progress, Badge } from '@ui/components';
import type { FileRow, Stats, ViewKey } from '../types';
import { bytes } from '../lib/util';

export interface FilesPanelProps {
  rows: FileRow[];
  stats: Stats;
  total: number;
  grandTotal: number;
  view: ViewKey;
  query: string;
  loadingMore: boolean;
  busy: boolean;
  recurse: boolean;
  autoPreview: boolean;
  autoFix: boolean;
  progress: { phase: string; done: number; total: number } | null;
  onScanFiles: () => void;
  onScanFolders: () => void;
  onClear: () => void;
  onView: (view: ViewKey) => void;
  onQuery: (query: string) => void;
  onPreview: () => void;
  onRename: () => void;
  onToggleRow: (id: string, selected: boolean) => void;
  onSelectAll: () => void;
  onLoadMore: () => void;
  onRecurse: (value: boolean) => void;
  onAutoPreview: (value: boolean) => void;
  onAutoFix: (value: boolean) => void;
}

const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: 'focus', label: '关注项' },
  { key: 'all', label: '全部' },
  { key: 'changed', label: '已改变' },
  { key: 'issues', label: '问题项' },
];

const STATUS: Record<string, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'danger' }> = {
  ready: { label: '就绪', tone: 'accent' },
  unchanged: { label: '未变', tone: 'neutral' },
  conflict: { label: '冲突', tone: 'warning' },
  error: { label: '错误', tone: 'danger' },
};

export function FilesPanel({
  rows,
  stats,
  total,
  grandTotal,
  view,
  query,
  loadingMore,
  busy,
  recurse,
  autoPreview,
  autoFix,
  progress,
  onScanFiles,
  onScanFolders,
  onClear,
  onView,
  onQuery,
  onPreview,
  onRename,
  onToggleRow,
  onSelectAll,
  onLoadMore,
  onRecurse,
  onAutoPreview,
  onAutoFix,
}: FilesPanelProps) {
  const allSelected = rows.length > 0 && rows.every((row) => row.selected);

  return (
    <Card padding="none" className="rn-files">
      <div className="rn-panel-head rn-files__head">
        <div className="rn-panel-title">
          <span className="rn-eyebrow">FILES</span>
          <h2>
            文件比对 <span className="rn-count">{grandTotal || ''}</span>
          </h2>
        </div>

        <div className="rn-files__actions">
          <Button variant="secondary" size="sm" onClick={onScanFiles} disabled={busy}>
            添加文件
          </Button>
          <Button variant="ghost" size="sm" onClick={onScanFolders} disabled={busy}>
            添加目录
          </Button>
          <IconButton label="清空文件列表" size="sm" onClick={onClear} disabled={busy || grandTotal === 0}>
            <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
              <path
                d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 8h6.6l.7-8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </IconButton>
          <span className="rn-spacer" />
          <Input
            type="search"
            placeholder="搜索文件名…"
            value={query}
            aria-label="搜索文件名"
            onChange={(event) => onQuery(event.target.value)}
            className="rn-search"
          />
          <Button variant="ghost" size="sm" onClick={onPreview} disabled={busy}>
            预览
          </Button>
          <Button variant="primary" size="sm" onClick={onRename} disabled={busy || stats.actionable === 0}>
            开始重命名
          </Button>
        </div>
      </div>

      <div className="rn-files__options">
        <Checkbox checked={recurse} onChange={onRecurse} label="包含子文件夹" />
        <Checkbox checked={autoPreview} onChange={onAutoPreview} label="自动预览" />
        <Checkbox checked={autoFix} onChange={onAutoFix} label="自动修复冲突" />
        <span className="rn-spacer" />
        <span className="rn-muted">
          显示 {rows.length} / {total}
        </span>
      </div>

      {progress ? (
        <div className="rn-progress">
          <Progress
            value={progress.total > 0 ? (progress.done / progress.total) * 100 : 0}
            indeterminate={progress.total <= 0}
            label={progress.phase}
          />
          <span className="rn-progress__label">
            {progress.phase === 'scan'
              ? `扫描中 ${progress.done}`
              : `重命名 ${progress.done}/${progress.total}`}
          </span>
        </div>
      ) : null}

      <div className="rn-stats" aria-live="polite">
        <span className="rn-stat">
          <em>总计</em>
          <strong>{stats.total}</strong>
        </span>
        <span className="rn-stat is-accent">
          <em>已改</em>
          <strong>{stats.changed}</strong>
        </span>
        <span className="rn-stat is-warn">
          <em>冲突</em>
          <strong>{stats.conflicts}</strong>
        </span>
        <span className="rn-stat is-bad">
          <em>错误</em>
          <strong>{stats.errors}</strong>
        </span>
        <span className="rn-stat">
          <em>已选</em>
          <strong>{stats.selected}</strong>
        </span>
        <span className="rn-stat is-ok">
          <em>就绪</em>
          <strong>{stats.ready}</strong>
        </span>
      </div>

      <div className="rn-tabs" role="tablist" aria-label="文件视图">
        {VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={`rn-tab${view === item.key ? ' is-active' : ''}`}
            onClick={() => onView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="rn-grid-wrap">
        <table className="rn-grid">
          <thead>
            <tr>
              <th className="rn-col-check">
                <Checkbox checked={allSelected} onChange={onSelectAll} aria-label="全选或全不选" />
              </th>
              <th className="rn-col-idx">#</th>
              <th>原文件名</th>
              <th>新文件名</th>
              <th className="rn-col-dir">目录</th>
              <th className="rn-col-status">状态</th>
              <th className="rn-col-size">大小</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const status = STATUS[row.status] ?? { label: row.status, tone: 'neutral' as const };
              const changed = row.newName !== row.originalName;
              return (
                <tr
                  key={row.id}
                  className={row.selected ? '' : 'is-unselected'}
                  onClick={() => onToggleRow(row.id, !row.selected)}
                >
                  <td className="rn-col-check" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={row.selected}
                      onChange={(checked) => onToggleRow(row.id, checked)}
                      aria-label={`选择 ${row.originalName}`}
                    />
                  </td>
                  <td className="rn-col-idx">{index + 1}</td>
                  <td className="rn-cell-name" title={row.originalName}>
                    {row.originalName}
                  </td>
                  <td className={`rn-cell-name${changed ? ' is-new' : ''}`} title={row.newName}>
                    {row.newName || '—'}
                    {row.errorMessage ? <span className="rn-cell-error">{row.errorMessage}</span> : null}
                  </td>
                  <td className="rn-col-dir" title={row.dir}>
                    {row.dir}
                  </td>
                  <td className="rn-col-status">
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </td>
                  <td className="rn-col-size">{bytes(row.size)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="rn-grid__empty">
                  <strong>{grandTotal ? '当前视图没有匹配项' : '文件列表为空'}</strong>
                  <span>用「添加文件 / 添加目录」导入，或按 Ctrl+O 打开文件。</span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="rn-files__foot">
        <span className="rn-muted">
          {total > rows.length ? `还有 ${total - rows.length} 行未加载` : '已全部加载'}
        </span>
        <Button size="sm" variant="ghost" disabled={loadingMore || rows.length >= total} onClick={onLoadMore}>
          {loadingMore ? '加载中…' : '加载更多'}
        </Button>
      </div>
    </Card>
  );
}
