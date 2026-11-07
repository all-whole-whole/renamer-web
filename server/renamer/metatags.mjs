import { statSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * ReNamer-style meta tags. Tokens deliberately use the same `[:Name:]` shape as
 * UserInput so a user can mix them, e.g. `[:Date_Now:]_[:File_FolderName:]`.
 *
 * Expansion is opt-in per rule field (`metaTags: true` in RULE_META), so a tag
 * inside a regex pattern or a JavaScript script is never rewritten by accident.
 */
const DATE_FORMAT = 'YYYY-MM-DD_HHmmss';
const statCache = new WeakMap();

export const META_TAGS = [
  {
    name: 'Date_Now',
    token: '[:Date_Now:]',
    label: '当前日期 (Date_Now)',
    description: `预览开始时的本地日期时间，格式 ${DATE_FORMAT}`,
    example: '2026-11-06_020453',
    resolve: ({ context }) => formatDate(asDate(context?.now) || new Date()),
  },
  {
    name: 'File_Size',
    token: '[:File_Size:]',
    label: '文件大小 (File_Size)',
    description: '带单位的文件大小，例如 12MB',
    example: '12MB',
    resolve: ({ item }) => formatSize(fileSize(item)),
  },
  {
    name: 'File_SizeBytes',
    token: '[:File_SizeBytes:]',
    label: '字节数 (File_SizeBytes)',
    description: '文件的精确字节数',
    example: '12582912',
    resolve: ({ item }) => String(fileSize(item)),
  },
  {
    name: 'File_SizeKB',
    token: '[:File_SizeKB:]',
    label: 'KB 数值 (File_SizeKB)',
    description: '文件大小除以 1024，四舍五入取整',
    example: '12288',
    resolve: ({ item }) => String(Math.round(fileSize(item) / 1024)),
  },
  {
    name: 'File_SizeMB',
    token: '[:File_SizeMB:]',
    label: 'MB 数值 (File_SizeMB)',
    description: '文件大小除以 1024²，保留两位小数',
    example: '12.00',
    resolve: ({ item }) => (fileSize(item) / (1024 * 1024)).toFixed(2),
  },
  {
    name: 'File_SizeGB',
    token: '[:File_SizeGB:]',
    label: 'GB 数值 (File_SizeGB)',
    description: '文件大小除以 1024³，保留两位小数',
    example: '0.01',
    resolve: ({ item }) => (fileSize(item) / (1024 * 1024 * 1024)).toFixed(2),
  },
  {
    name: 'File_DateCreated',
    token: '[:File_DateCreated:]',
    label: '创建时间 (File_DateCreated)',
    description: `文件创建时间，格式 ${DATE_FORMAT}；无法读取时回退到 ctime`,
    example: '2026-11-06_020453',
    resolve: ({ item }) => formatDate(fileCreated(item)) || '',
  },
  {
    name: 'File_DateModified',
    token: '[:File_DateModified:]',
    label: '修改时间 (File_DateModified)',
    description: `文件修改时间，格式 ${DATE_FORMAT}`,
    example: '2026-11-06_020453',
    resolve: ({ item }) => formatDate(fileModified(item)) || '',
  },
  {
    name: 'File_Path',
    token: '[:File_Path:]',
    label: '完整路径 (File_Path)',
    description: '文件所在目录 + 当前文件名',
    example: 'C:\\Photos\\Trip\\photo.jpg',
    resolve: ({ item }) => itemPath(item) || '',
  },
  {
    name: 'File_FullPath',
    token: '[:File_FullPath:]',
    label: '完整路径别名 (File_FullPath)',
    description: '与 File_Path 相同，便于从 ReNamer 迁移',
    example: 'C:\\Photos\\Trip\\photo.jpg',
    resolve: ({ item }) => itemPath(item) || '',
  },
  {
    name: 'File_Directory',
    token: '[:File_Directory:]',
    label: '所在目录 (File_Directory)',
    description: '文件所在的完整目录路径',
    example: 'C:\\Photos\\Trip',
    resolve: ({ item }) => item?.dir || '',
  },
  {
    name: 'File_Name',
    token: '[:File_Name:]',
    label: '完整文件名 (File_Name)',
    description: '当前规则链中的文件名，包含扩展名',
    example: 'photo.jpg',
    resolve: ({ item, parts }) => currentName(item, parts),
  },
  {
    name: 'File_BaseName',
    token: '[:File_BaseName:]',
    label: '主文件名 (File_BaseName)',
    description: '当前规则链中的文件名，不含扩展名',
    example: 'photo',
    resolve: ({ item, parts }) => (parts ? parts.base : itemBase(item)),
  },
  {
    name: 'File_Extension',
    token: '[:File_Extension:]',
    label: '扩展名 (File_Extension)',
    description: '当前扩展名，包含前导点，例如 .jpg',
    example: '.jpg',
    resolve: ({ item, parts }) => (parts ? parts.ext : itemExt(item)),
  },
  {
    name: 'File_FolderName',
    token: '[:File_FolderName:]',
    label: '文件夹名称 (File_FolderName)',
    description: '文件直接父文件夹的名字，不含上级路径',
    example: 'Trip',
    resolve: ({ item }) => (item?.dir ? basename(item.dir) : ''),
  },
];

const TAG_BY_NAME = new Map(META_TAGS.map((tag) => [tag.name.toLowerCase(), tag]));

/**
 * Expand known meta tags in one string. Unknown tokens stay untouched so a
 * typo is visible in the preview instead of silently deleting text.
 */
export function expandMetaTags(value, { item, context, parts } = {}) {
  if (typeof value !== 'string' || !value.includes('[:')) return value;
  return value.replace(/\[:([A-Za-z][A-Za-z0-9_]*):\]/g, (whole, name) => {
    const tag = TAG_BY_NAME.get(String(name).toLowerCase());
    if (!tag) return whole;
    try {
      const result = tag.resolve({ item, context, parts });
      return result === undefined || result === null ? '' : String(result);
    } catch {
      return '';
    }
  });
}

export function metaTagByName(name) {
  return TAG_BY_NAME.get(String(name).toLowerCase()) || null;
}

/* ------------------------------- helpers -------------------------------- */

function itemPath(item) {
  if (!item) return '';
  if (typeof item.path === 'string' && item.path) return item.path;
  if (typeof item.dir === 'string') {
    return item.originalName ? join(item.dir, item.originalName) : item.dir;
  }
  return '';
}

function currentName(item, parts) {
  if (parts) return `${parts.base ?? ''}${parts.ext ?? ''}`;
  return item?.originalName || '';
}

function itemBase(item) {
  return item?.originalBase || '';
}

function itemExt(item) {
  return item?.originalExt || '';
}

function statFor(item) {
  if (!item || typeof item !== 'object') return null;
  if (statCache.has(item)) return statCache.get(item);
  const path = item.path || (item.dir && item.originalName ? join(item.dir, item.originalName) : '');
  let value = null;
  if (path) {
    try {
      value = statSync(path);
    } catch {
      value = null;
    }
  }
  statCache.set(item, value);
  return value;
}

function fileSize(item) {
  const metaSize = Number(item?.meta?.size);
  if (Number.isFinite(metaSize) && metaSize > 0) return metaSize;
  const itemSize = Number(item?.size);
  if (Number.isFinite(itemSize) && itemSize > 0) return itemSize;
  return statFor(item)?.size || 0;
}

function fileModified(item) {
  return asDate(item?.mtime) || asDate(item?.modified) || asDate(item?.mtimeMs) || asDate(statFor(item)?.mtimeMs);
}

function fileCreated(item) {
  return (
    asDate(item?.birthtime) ||
    asDate(item?.created) ||
    asDate(item?.birthtimeMs) ||
    asDate(item?.ctime) ||
    asDate(statFor(item)?.birthtimeMs) ||
    asDate(statFor(item)?.ctimeMs)
  );
}

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    const exif = /^(\d{4})[:\-/](\d{1,2})[:\-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(text);
    if (exif) {
      return new Date(
        Number(exif[1]),
        Number(exif[2]) - 1,
        Number(exif[3]),
        Number(exif[4]),
        Number(exif[5]),
        Number(exif[6] || 0),
      );
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function formatDate(date, format = DATE_FORMAT) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return format.replace(/YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear());
      case 'YY':
        return String(date.getFullYear()).slice(-2);
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'M':
        return String(date.getMonth() + 1);
      case 'DD':
        return pad(date.getDate());
      case 'D':
        return String(date.getDate());
      case 'HH':
        return pad(date.getHours());
      case 'H':
        return String(date.getHours());
      case 'mm':
        return pad(date.getMinutes());
      case 'm':
        return String(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      case 's':
        return String(date.getSeconds());
      default:
        return token;
    }
  });
}

export function formatSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  return `${text}${units[unit]}`;
}

export default META_TAGS;
