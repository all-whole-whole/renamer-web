export type FieldKind = 'text' | 'bool' | 'select' | 'number' | 'textarea';

export interface RuleField {
  key: string;
  label: string;
  kind: FieldKind;
  default?: string | number | boolean;
  hint?: string;
  metaTags?: boolean;
  options?: Array<{ value: string; label: string }>;
}

export interface RuleExample {
  input: string;
  config: Record<string, unknown>;
  output: string;
}

export interface RuleType {
  type: string;
  label: string;
  renamerClass?: string;
  summary?: string;
  help?: string;
  examples?: RuleExample[];
  fields: RuleField[];
}

export interface MetaTag {
  name: string;
  token: string;
  label: string;
  description: string;
  example: string;
}

/** 服务端接受的是「扁平」规则：type / enabled / 各字段直接挂顶层。 */
export interface Rule {
  id: string;
  type: string;
  enabled: boolean;
  [key: string]: unknown;
}

export type FileStatus = 'ready' | 'unchanged' | 'error' | 'conflict' | string;

export interface FileRow {
  id: string;
  dir: string;
  originalName: string;
  newName: string;
  status: FileStatus;
  errorMessage: string | null;
  selected: boolean;
  size: number;
}

export interface Stats {
  total: number;
  changed: number;
  unchanged: number;
  conflicts: number;
  errors: number;
  selected: number;
  issues: number;
  actionable: number;
  ready: number;
}

export interface FilesResponse {
  ok: boolean;
  view: string;
  offset: number;
  limit: number;
  total: number;
  grandTotal: number;
  revision: number;
  rows: FileRow[];
  stats: Stats;
}

export interface PresetSummary {
  name: string;
  file: string;
  rules: number;
  updatedAt: string;
}

export interface BatchSummary {
  batchId: string;
  createdAt: string;
  count: number;
}

export type ViewKey = 'focus' | 'all' | 'changed' | 'issues';

export interface PreviewOptions {
  autoFixConflicts: boolean;
  overwriteWithNewName: boolean;
  firstDotIsExt: boolean;
}

export interface ScanOptions {
  recurse: boolean;
}
