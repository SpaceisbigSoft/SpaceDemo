// Reads demos straight out of .zip files (plan 4.3), without unpacking them to disk. Read-only: the zip is opened for
// reading and nothing is ever written. Original code from the ZIP format description (PKWARE APPNOTE.TXT, sections 4.3
// and 4.4): end-of-central-directory record → central directory entries → local header → data.
// Supported: "stored" (method 0) and "deflate" (method 8), the methods old demo zips use. Not supported (reported as
// a plain-language error): encrypted entries, ZIP64 (zips or entries over 4 GB), split zips.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { crc32 } from './crc32.js';

export interface ZipEntry {
  /** Path inside the zip, with forward slashes. */
  name: string;
  compressedSize: number;
  size: number;
  crc32: number;
  method: number;
  encrypted: boolean;
  /** The entry's date as stored (local time of the computer that made the zip). Undefined when not set. */
  modified?: Date;
  /** Where its local header starts. */
  localHeaderOffset: number;
}

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = readSync(fd, buf, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  return done === length ? buf : buf.subarray(0, done);
}

/** MS-DOS date and time (as stored in zips) → Date in the local time zone. */
export function dosDateTime(date: number, time: number): Date | undefined {
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  const year = 1980 + (date >> 9);
  if (day === 0 || month === 0 || month > 12) return undefined;
  return new Date(year, month - 1, day, time >> 11, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

/** Lists the files in a zip (folders left out). */
export function listZip(file: string): ZipEntry[] {
  const fd = openSync(file, 'r');
  try {
    return listOpen(fd, file);
  } finally {
    closeSync(fd);
  }
}

function listOpen(fd: number, file: string): ZipEntry[] {
  const size = fstatSync(fd).size;
  // The end record is 22 bytes plus a comment of up to 65535 bytes, at the very end of the file.
  const tailLength = Math.min(size, 22 + 0xffff);
  const tail = readAt(fd, size - tailLength, tailLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError(`${file} isn't a zip file (no end record found).`);
  const disk = tail.readUInt16LE(eocd + 4);
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (disk !== 0) throw new ZipError(`${file} is part of a split zip; join the parts first.`);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError(`${file} is a ZIP64 zip (over 4 GB), which isn't supported yet.`);
  if (cdOffset + cdSize > size) throw new ZipError(`${file} is damaged (its file list points past the end).`);

  const cd = readAt(fd, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CENTRAL_SIG) throw new ZipError(`${file} is damaged (file list entry ${i + 1}).`);
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const time = cd.readUInt16LE(p + 12);
    const date = cd.readUInt16LE(p + 14);
    const crc = cd.readUInt32LE(p + 16);
    const compressedSize = cd.readUInt32LE(p + 20);
    const uncompressedSize = cd.readUInt32LE(p + 24);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const localHeaderOffset = cd.readUInt32LE(p + 42);
    const rawName = cd.subarray(p + 46, p + 46 + nameLen);
    // Bit 11: name is UTF-8. Otherwise old zips use the DOS code page; latin1 keeps plain ASCII names exact.
    const name = rawName.toString(flags & 0x0800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    entries.push({
      name,
      compressedSize,
      size: uncompressedSize,
      crc32: crc,
      method,
      encrypted: (flags & 1) !== 0,
      modified: dosDateTime(date, time),
      localHeaderOffset,
    });
  }
  return entries;
}

/** Reads one entry's content, checks its CRC-32 and returns the bytes. */
export function readZipEntry(file: string, entry: ZipEntry | string): Uint8Array {
  const fd = openSync(file, 'r');
  try {
    const e = typeof entry === 'string' ? listOpen(fd, file).find((x) => x.name === entry) : entry;
    if (!e) throw new ZipError(`${entry} isn't in ${file}.`);
    if (e.encrypted) throw new ZipError(`${e.name} in ${file} is password-protected.`);
    if (e.method !== 0 && e.method !== 8) throw new ZipError(`${e.name} in ${file} uses compression method ${e.method}, which isn't supported (only stored and deflate).`);
    const local = readAt(fd, e.localHeaderOffset, 30);
    if (local.length < 30 || local.readUInt32LE(0) !== LOCAL_SIG) throw new ZipError(`${e.name} in ${file} is damaged (no local header).`);
    const dataStart = e.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    const raw = readAt(fd, dataStart, e.compressedSize);
    if (raw.length !== e.compressedSize) throw new ZipError(`${e.name} in ${file} is cut off.`);
    let out: Uint8Array;
    try {
      out = e.method === 0 ? raw : inflateRawSync(raw);
    } catch (err) {
      throw new ZipError(`${e.name} in ${file} can't be unpacked: ${(err as Error).message}`);
    }
    if (out.length !== e.size || crc32(out) !== e.crc32) throw new ZipError(`${e.name} in ${file} is damaged (checksum doesn't match).`);
    return out;
  } finally {
    closeSync(fd);
  }
}
