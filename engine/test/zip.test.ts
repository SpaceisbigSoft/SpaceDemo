// Zip reader (plan 4.3). Small zips are built here byte by byte; set CDF_ZIPS to a folder of real demo zips to also
// check against them (every .dem entry is read and its checksum verified).
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/crc32.js';
import { dosDateTime, listZip, readZipEntry, ZipError } from '../src/zip.js';

interface FileSpec { name: string; data: Uint8Array; deflate?: boolean; utf8?: boolean }

/** Builds a zip: local headers + data, central directory, end record. DOS date 2002-10-06 21:34:10. */
function makeZip(files: FileSpec[], comment = ''): Buffer {
  const date = ((2002 - 1980) << 9) | (10 << 5) | 6;
  const time = (21 << 11) | (34 << 5) | 5;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, f.utf8 ? 'utf8' : 'latin1');
    const body = f.deflate ? deflateRawSync(f.data) : Buffer.from(f.data);
    const crc = crc32(f.data);
    const flags = f.utf8 ? 0x0800 : 0;
    const method = f.deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(flags, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10); ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const c = Buffer.from(comment);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(c.length, 20);
  return Buffer.concat([...locals, cd, end, c]);
}

const tmp = () => mkdtempSync(join(tmpdir(), 'sd-zip-'));
const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

describe('zip reader', () => {
  it('lists entries with names, sizes and dates, and skips folders', () => {
    const f = join(tmp(), 'a.zip');
    writeFileSync(f, makeZip([
      { name: 'modTside.dem', data: bytes(5000), deflate: true },
      { name: 'shots/', data: new Uint8Array(0) },
      { name: 'shots\\de_train0001.bmp', data: bytes(10) },
      { name: 'Café.dem', data: bytes(20), utf8: true },
    ], 'a comment'));
    const entries = listZip(f);
    expect(entries.map((e) => e.name)).toEqual(['modTside.dem', 'shots/de_train0001.bmp', 'Café.dem']);
    expect(entries[0]).toMatchObject({ size: 5000, method: 8, encrypted: false });
    const d = entries[0].modified!;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([2002, 10, 6, 21, 34, 10]);
  });

  it('reads stored and deflated entries and checks them', () => {
    const f = join(tmp(), 'b.zip');
    const a = bytes(70000, 3);
    const b = bytes(123, 7);
    writeFileSync(f, makeZip([{ name: 'x.dem', data: a, deflate: true }, { name: 'y.dem', data: b }]));
    expect(Buffer.from(readZipEntry(f, 'x.dem')).equals(Buffer.from(a))).toBe(true);
    expect(Buffer.from(readZipEntry(f, listZip(f)[1])).equals(Buffer.from(b))).toBe(true);
  });

  it('reports damage and non-zips in plain words', () => {
    const dir = tmp();
    const f = join(dir, 'c.zip');
    const zip = makeZip([{ name: 'x.dem', data: bytes(100) }]);
    zip[30 + 5 + 10] ^= 0xff; // flip a data byte
    writeFileSync(f, zip);
    expect(() => readZipEntry(f, 'x.dem')).toThrow(/damaged \(checksum/);
    expect(() => readZipEntry(f, 'nope.dem')).toThrow(/isn't in/);
    const g = join(dir, 'not.zip');
    writeFileSync(g, 'hello');
    expect(() => listZip(g)).toThrow(ZipError);
  });

  it('turns DOS dates into local dates', () => {
    expect(dosDateTime(0, 0)).toBeUndefined();
    expect(dosDateTime((22 << 9) | (13 << 5) | 1, 0)).toBeUndefined(); // month 13
  });

  const real = process.env.CDF_ZIPS;
  it.skipIf(!real)('reads every demo in the real zips', () => {
    const zips: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.toLowerCase().endsWith('.zip')) zips.push(p); } };
    walk(real!);
    let demos = 0;
    for (const z of zips) {
      for (const e of listZip(z).filter((x) => x.name.toLowerCase().endsWith('.dem'))) {
        const data = readZipEntry(z, e);
        expect(new TextDecoder().decode(data.subarray(0, 6))).toBe('HLDEMO');
        expect(e.modified!.getFullYear()).toBeGreaterThanOrEqual(2002);
        demos++;
      }
    }
    expect(demos).toBeGreaterThan(0);
  }, 120_000);
});
