import type {
  BatchSummary,
  FilesResponse,
  MetaTag,
  PreviewOptions,
  PresetSummary,
  Rule,
  RuleType,
  ScanOptions,
  Stats,
  ViewKey,
} from './types';

export class ApiError extends Error {
  status?: number;
  offline?: boolean;

  constructor(message: string, options: { status?: number; offline?: boolean } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.offline = options.offline;
  }
}

let offlineHandler: (() => void) | null = null;

export function onOffline(handler: () => void): void {
  offlineHandler = handler;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    offlineHandler?.();
    throw new ApiError('本地服务没有响应（host 可能已退出）', { offline: true });
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(String(body.error ?? `HTTP ${response.status}`), { status: response.status });
  }
  return body as T;
}

function post<T>(url: string, body: unknown = {}): Promise<T> {
  return request<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface PreviewResponse {
  ok: boolean;
  stats: Stats;
  conflictReport: { duplicateGroups: number; diskConflicts: number; fixed: number; conflictCount: number };
  revision: number;
  elapsedMs: number;
}

export const api = {
  ping: () => request<{ app: string; version: string; items: number; clients: number }>('/api/ping'),
  ruleTypes: () => request<{ types: RuleType[]; metaTags: MetaTag[] }>('/api/rule-types'),
  files: (view: ViewKey, offset: number, limit: number, q: string) => {
    const params = new URLSearchParams({ view, offset: String(offset), limit: String(limit) });
    if (q.trim()) params.set('q', q.trim());
    return request<FilesResponse>(`/api/files?${params.toString()}`);
  },
  pick: (kind: 'files' | 'folders') => request<{ ok: boolean; paths: string[] }>(`/api/pick?kind=${kind}`),
  scan: (paths: string[], options: ScanOptions, mode: 'replace' | 'append' = 'replace') =>
    post<{ ok: boolean; added: number; total: number; truncated: boolean; stats: Stats }>('/api/scan', {
      paths,
      mode,
      options,
    }),
  preview: (rules: Rule[], options: PreviewOptions, transient = false) =>
    post<PreviewResponse>('/api/preview', { rules, options, transient }),
  rename: (overwrite = false) => post<{ ok: boolean; batchId: string; count: number; stats: Stats }>('/api/rename', { overwrite }),
  undo: (batchId?: string) =>
    post<{ ok: boolean; restored: number; failed: number; revision: number; stats: Stats }>('/api/undo', { batchId }),
  selection: (selected: boolean, ids?: string[]) => post<{ ok: boolean; stats: Stats }>('/api/selection', { ids, selected }),
  clear: () => post<{ ok: boolean; stats: Stats }>('/api/clear'),
  batches: () => request<{ ok: boolean; batches: BatchSummary[] }>('/api/batches'),
  presets: () => request<{ ok: boolean; presets: PresetSummary[]; lastUsed: string }>('/api/presets'),
  presetLoad: (name: string) => post<{ ok: boolean; name: string; rules: Rule[]; stats: Stats }>('/api/presets', { action: 'load', name }),
  presetSave: (name: string, rules: Rule[]) => post<{ ok: boolean; name: string }>('/api/presets', { name, rules }),
  presetDelete: (name: string) => post<{ ok: boolean; deleted: boolean }>('/api/presets', { action: 'delete', name }),
  exportUrl: (format: 'csv' | 'json') => `/api/export?format=${format}`,
};

export interface StreamPayload {
  type?: string;
  phase?: string;
  scanned?: number;
  kept?: number;
  done?: number;
  total?: number;
  batchId?: string;
  count?: number;
  message?: string;
  revision?: number;
  level?: string;
}

/** 服务端同时用命名事件与 data.type 两种写法，这里都收。 */
export function connectEvents(handlers: {
  onEvent: (payload: StreamPayload) => void;
  onOpen: () => void;
  onDown: () => void;
}): () => void {
  const source = new EventSource('/api/events');
  const dispatch = (event: MessageEvent<string>) => {
    try {
      handlers.onEvent(JSON.parse(event.data) as StreamPayload);
    } catch {
      /* 单条坏事件不影响连接 */
    }
  };
  source.addEventListener('open', handlers.onOpen);
  source.onerror = () => handlers.onDown();
  source.onmessage = dispatch;
  for (const name of ['progress', 'renamed', 'log', 'error', 'hello']) {
    source.addEventListener(name, (event) => dispatch(event as MessageEvent<string>));
  }
  return () => source.close();
}
