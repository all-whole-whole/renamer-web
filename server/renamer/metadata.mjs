import { promises as fs } from 'node:fs';
import { extname } from 'node:path';

/**
 * Lazy metadata reader. The grid never pays for this; it is pulled per row on
 * demand and cached on the item, mirroring ReNamer's Meta Tags subsystem
 * (umetatags) in a much smaller form: JPEG/TIFF EXIF plus ID3v2 for audio.
 */
export async function getMetadata(filePath) {
  const info = {
    path: filePath,
    size: 0,
    mtime: 0,
    birthtime: 0,
    ctime: 0,
    ext: extname(filePath).toLowerCase(),
    exif: null,
    id3: null,
  };
  try {
    const st = await fs.stat(filePath);
    info.size = st.size;
    info.mtime = st.mtimeMs;
    info.birthtime = st.birthtimeMs;
    info.ctime = st.ctimeMs;
  } catch {
    return info;
  }

  if (['.jpg', '.jpeg', '.tif', '.tiff'].includes(info.ext)) info.exif = await readExif(filePath);
  if (['.mp3', '.mp2', '.mp1'].includes(info.ext)) info.id3 = await readId3(filePath);
  return info;
}

async function readHead(filePath, bytes = 262144) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/* ------------------------------- EXIF ---------------------------------- */

const EXIF_TAGS = {
  0x010f: 'make',
  0x0110: 'model',
  0x0112: 'orientation',
  0x0132: 'modified',
  0x8769: 'exifIfd',
  0x9003: 'dateTaken',
  0xa002: 'pixelWidth',
  0xa003: 'pixelHeight',
};

async function readExif(filePath) {
  try {
    const buf = await readHead(filePath);
    const marker = buf.indexOf(Buffer.from('Exif\0\0', 'binary'));
    if (marker < 0) return null;
    return parseTiff(buf, marker + 6);
  } catch {
    return null;
  }
}

function parseTiff(buf, base) {
  if (buf.length < base + 8) return null;
  const byteOrder = buf.toString('ascii', base, base + 2);
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null;
  const le = byteOrder === 'II';
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(base + 2) !== 42) return null;

  const out = {};
  const ifd0 = base + u32(base + 4);
  readIfd(buf, base, ifd0, u16, u32, out, le);

  if (typeof out.exifIfd === 'number') {
    const ifd = base + out.exifIfd;
    readIfd(buf, base, ifd, u16, u32, out, le);
  }
  delete out.exifIfd;
  for (const key of Object.keys(out)) if (out[key] === null || out[key] === '') delete out[key];
  return Object.keys(out).length ? out : null;
}

function readIfd(buf, base, ifd, u16, u32, out, le) {
  if (ifd <= 0 || ifd + 2 > buf.length) return;
  const count = u16(ifd);
  for (let i = 0; i < count; i += 1) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > buf.length) return;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const n = u32(entry + 4);
    const name = EXIF_TAGS[tag];
    if (!name) continue;

    if (type === 2) {
      // ASCII
      const valueOffset = n <= 4 ? entry + 8 : base + u32(entry + 8);
      out[name] = buf.toString('utf8', valueOffset, Math.min(valueOffset + n, buf.length)).replace(/\0+$/, '').trim();
    } else if (type === 3) {
      out[name] = u16(entry + 8);
    } else if (type === 4) {
      out[name] = u32(entry + 8);
    }
  }
}

/* -------------------------------- ID3 ---------------------------------- */

const ID3_FRAMES = { TIT2: 'title', TPE1: 'artist', TALB: 'album', TYER: 'year', TDRC: 'year', TRCK: 'track', TCON: 'genre' };

async function readId3(filePath) {
  try {
    const buf = await readHead(filePath, 65536);
    if (buf.length < 10 || buf.toString('ascii', 0, 3) !== 'ID3') return null;
    const version = buf[3];
    const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9];
    const end = Math.min(10 + size, buf.length);
    const out = {};
    let offset = 10;

    while (offset + 10 <= end) {
      const id = buf.toString('ascii', offset, offset + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const frameSize =
        version >= 4
          ? (buf[offset + 4] << 21) | (buf[offset + 5] << 14) | (buf[offset + 6] << 7) | buf[offset + 7]
          : buf.readUInt32BE(offset + 4);
      if (frameSize <= 0 || offset + 10 + frameSize > end) break;

      const name = ID3_FRAMES[id];
      if (name && !out[name]) {
        const data = buf.subarray(offset + 10, offset + 10 + frameSize);
        out[name] = decodeId3Text(data);
      }
      offset += 10 + frameSize;
    }
    for (const key of Object.keys(out)) if (!out[key]) delete out[key];
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

function decodeId3Text(data) {
  if (data.length < 1) return '';
  const encoding = data[0];
  const body = data.subarray(1);
  if (encoding === 0) return body.toString('latin1').replace(/\0+$/, '').trim();
  if (encoding === 3) return body.toString('utf8').replace(/\0+$/, '').trim();
  // 1 = UTF-16 with BOM, 2 = UTF-16BE
  if (encoding === 2) return body.toString('utf16le').replace(/\0+$/, '').trim();
  if (body[0] === 0xff && body[1] === 0xfe) return body.subarray(2).toString('utf16le').replace(/\0+$/, '').trim();
  if (body[0] === 0xfe && body[1] === 0xff) {
    const swapped = Buffer.from(body.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le').replace(/\0+$/, '').trim();
  }
  return body.toString('utf16le').replace(/\0+$/, '').trim();
}
