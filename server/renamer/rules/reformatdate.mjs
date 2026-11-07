import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BaseRule } from '../rule-base.mjs';

/**
 * TRuleReformatDate: find a date in the current name, or read one from the
 * filesystem/EXIF, then render it with the user's target format.
 *
 * The parser is intentionally small and dependency-free. It recognises the
 * common filename layouts ReNamer users actually have (YYYYMMDD, ISO dates,
 * dotted dates and optional HHmmss) plus a caller-supplied source format.
 */
const FORMAT_TOKEN = /^(YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s)/;
const FORMAT_OUTPUT = /YYYY|YY|MM|M|DD|D|HH|H|mm|m|ss|s/g;

const SOURCES = new Set(['name', 'modified', 'created', 'exif']);
const POSITIONS = new Set(['replace', 'prefix', 'suffix']);

export class ReformatDateRule extends BaseRule {
  constructor(config = {}) {
    super('reformatdate', config);
    this.source = SOURCES.has(config.source) ? config.source : 'name';
    this.sourceFormat = String(config.sourceFormat ?? 'YYYY-MM-DD').trim() || 'YYYY-MM-DD';
    this.targetFormat = String(config.targetFormat ?? 'YYYYMMDD_HHmmss').trim() || 'YYYYMMDD_HHmmss';
    this.position = POSITIONS.has(config.position) ? config.position : 'replace';
    this.skipExtension = config.skipExtension !== false;
  }

  apply(parts, item) {
    const target = this.skipExtension ? parts.base : `${parts.base}${parts.ext}`;
    let found = null;

    if (this.source === 'name') {
      found = extractDate(target, this.sourceFormat);
      if (!found) return parts;
    } else {
      const date = this.dateFromItem(item);
      if (!date) return parts;
      found = { date, start: -1, end: -1 };
    }

    const formatted = formatDate(found.date, this.targetFormat);
    let output;
    if (found.start >= 0) {
      if (this.position === 'prefix') output = `${formatted}_${target}`;
      else if (this.position === 'suffix') output = `${target}_${formatted}`;
      else output = target.slice(0, found.start) + formatted + target.slice(found.end);
    } else if (this.position === 'prefix') {
      output = `${formatted}_${target}`;
    } else if (this.position === 'suffix') {
      output = `${target}_${formatted}`;
    } else {
      output = formatted;
    }

    if (output === target) return parts;
    if (!this.skipExtension) return output;
    return { base: output, ext: parts.ext };
  }

  dateFromItem(item) {
    const path = itemPath(item);
    let raw;
    if (this.source === 'modified') {
      raw = firstDate(item?.mtime, item?.modified, item?.mtimeMs, item?.meta?.mtime, item?.meta?.mtimeMs);
      if (!raw && path) raw = safeStat(path)?.[0];
    } else if (this.source === 'created') {
      raw = firstDate(item?.birthtime, item?.created, item?.birthtimeMs, item?.ctime, item?.meta?.birthtime, item?.meta?.ctime);
      if (!raw && path) raw = safeStat(path)?.[1];
    } else {
      const exif = item?.meta?.exif || {};
      raw = firstDate(exif.dateTaken, exif.DateTimeOriginal, exif.modified);
      if (!raw && path) raw = readExifDate(path);
    }
    return normalizeDate(raw);
  }

  describe() {
    const labels = { name: '文件名', modified: '修改时间', created: '创建时间', exif: 'EXIF' };
    return `ReformatDate: ${labels[this.source]} → ${this.targetFormat} (${this.position})`;
  }
}

function firstDate(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function itemPath(item) {
  if (!item) return null;
  if (typeof item.path === 'string' && item.path) return item.path;
  if (typeof item.dir === 'string' && item.originalName) return join(item.dir, item.originalName);
  return null;
}

function safeStat(path) {
  try {
    const st = statSync(path);
    return [st.mtimeMs, st.birthtimeMs || st.ctimeMs];
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 0 && value < 1e12 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    const exif = /^(\d{4})[:\-/](\d{1,2})[:\-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(text);
    if (exif) {
      return buildDate({
        year: Number(exif[1]),
        month: Number(exif[2]),
        day: Number(exif[3]),
        hour: Number(exif[4]),
        minute: Number(exif[5]),
        second: Number(exif[6] || 0),
      });
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function buildDate({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }
  return date;
}

/** Compile a source format such as `YYYY-MM-DD` or `DD.MM.YYYY` to a regex. */
function compileSourceFormat(format) {
  const fields = [];
  let pattern = '';
  let index = 0;
  while (index < format.length) {
    const rest = format.slice(index);
    const token = FORMAT_TOKEN.exec(rest);
    if (token) {
      const name = token[1];
      fields.push(name);
      pattern += name === 'YYYY' ? '(\\d{4})' : '(\\d{1,2})';
      index += name.length;
      continue;
    }
    pattern += escapeRegExp(format[index]);
    index += 1;
  }
  if (!fields.length) return null;
  return { regex: new RegExp(pattern, 'u'), fields };
}

function parseWithFormat(text, format) {
  const compiled = compileSourceFormat(format);
  if (!compiled) return null;
  const match = compiled.regex.exec(text);
  if (!match) return null;

  const values = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
  compiled.fields.forEach((field, i) => {
    const value = Number(match[i + 1]);
    if (field === 'YYYY') values.year = value;
    else if (field === 'YY') values.year = value < 70 ? 2000 + value : 1900 + value;
    else if (field === 'MM' || field === 'M') values.month = value;
    else if (field === 'DD' || field === 'D') values.day = value;
    else if (field === 'HH' || field === 'H') values.hour = value;
    else if (field === 'mm' || field === 'm') values.minute = value;
    else if (field === 'ss' || field === 's') values.second = value;
  });
  if (!values.year) return null;
  const date = buildDate(values);
  if (!date) return null;
  return { date, start: match.index, end: match.index + match[0].length };
}

/**
 * Try the explicit format first; if it does not match, fall back to the common
 * filename layouts so `20260320` works even with the default `YYYY-MM-DD`.
 */
function extractDate(text, sourceFormat) {
  // Keep the explicit format as a candidate instead of returning immediately:
  // `YYYY-MM-DD` also matches the date part of `2026-03-20_101500`, while the
  // auto detector can recover the full timestamp. Prefer the longest match.
  let best = sourceFormat ? parseWithFormat(text, sourceFormat) : null;

  const candidates = [
    // YYYYMMDD_HHmmss / YYYYMMDD-HHmmss
    [/(?<!\d)(\d{4})(\d{2})(\d{2})[T _-](\d{2})(\d{2})(\d{2})(?!\d)/u, 'YYYYMMDDHHmmss'],
    // YYYYMMDD
    [/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/u, 'YYYYMMDD'],
    // YYYY-MM-DD with optional time
    [
      /(?<!\d)(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?:[T _](\d{1,2}):?(\d{2})?:?(\d{2})?)?(?!\d)/u,
      'YYYYMMDDHHmmss',
    ],
    // DD.MM.YYYY (and DD/MM/YYYY)
    [/(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?!\d)/u, 'DDMMYYYY'],
  ];

  for (const [regex, order] of candidates) {
    const match = regex.exec(text);
    if (!match) continue;
    const numbers = match.slice(1).filter((value) => value !== undefined).map(Number);
    const values = { year: 0, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
    if (order === 'YYYYMMDDHHmmss') {
      [values.year, values.month, values.day, values.hour = 0, values.minute = 0, values.second = 0] = numbers;
    } else if (order === 'YYYYMMDD') {
      [values.year, values.month, values.day] = numbers;
    } else {
      [values.day, values.month, values.year] = numbers;
    }
    const date = buildDate(values);
    if (!date) continue;
    const found = { date, start: match.index, end: match.index + match[0].length };
    if (!best || found.end - found.start > best.end - best.start) best = found;
  }
  return best;
}

function formatDate(date, format) {
  const pad = (value) => String(value).padStart(2, '0');
  return format.replace(FORMAT_OUTPUT, (token) => {
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

function escapeRegExp(char) {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------- EXIF sync ------------------------------- */

function readExifDate(filePath) {
  let fd;
  try {
    fd = openSync(filePath, 'r');
    const head = Buffer.alloc(262144);
    const bytes = readSync(fd, head, 0, head.length, 0);
    const slice = head.subarray(0, bytes);
    const marker = slice.indexOf(Buffer.from('Exif\0\0', 'binary'));
    if (marker < 0) return null;
    return parseExifTiff(slice, marker + 6);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function parseExifTiff(buffer, base) {
  if (buffer.length < base + 8) return null;
  const byteOrder = buffer.toString('ascii', base, base + 2);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const little = byteOrder === 'II';
  const u16 = (offset) => (little ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset));
  const u32 = (offset) => (little ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset));
  if (u16(base + 2) !== 42) return null;

  const values = {};
  readExifIfd(buffer, base, base + u32(base + 4), u16, u32, values, little);
  if (typeof values.exifIfd === 'number') {
    readExifIfd(buffer, base, base + values.exifIfd, u16, u32, values, little);
  }
  return values.dateTaken || values.modified || null;
}

function readExifIfd(buffer, base, offset, u16, u32, values, little) {
  if (offset <= 0 || offset + 2 > buffer.length) return;
  const count = u16(offset);
  for (let i = 0; i < count; i += 1) {
    const entry = offset + 2 + i * 12;
    if (entry + 12 > buffer.length) return;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const length = u32(entry + 4);
    if (tag === 0x8769) values.exifIfd = u32(entry + 8);
    if (tag !== 0x9003 && tag !== 0x0132) continue;
    if (type !== 2 || length < 8) continue;
    const valueOffset = length <= 4 ? entry + 8 : base + u32(entry + 8);
    if (valueOffset >= buffer.length) continue;
    const text = buffer
      .toString('utf8', valueOffset, Math.min(valueOffset + length, buffer.length))
      .replace(/\0+$/, '')
      .trim();
    if (!text) continue;
    if (tag === 0x9003) values.dateTaken = text;
    else values.modified = text;
  }
}

export default ReformatDateRule;
