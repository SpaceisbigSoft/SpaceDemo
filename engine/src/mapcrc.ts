// Map checksum exactly as the GoldSrc engine computes it (ReHLDS crc.cpp CRC_MapFile):
// CRC-32 over every BSP lump except the entities lump, in lump order, WITHOUT the final inversion.
// This is the value stored in a demo header's map checksum field.
import { readFileSync } from 'node:fs';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crcUpdate(crc: number, data: Uint8Array): number {
  let c = crc;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** Returns the engine map checksum of a .bsp file. `gameDir` "bshift" skips lump 1 instead of 0, like the engine. */
export function mapChecksum(bsp: Buffer, gameDir = 'cstrike'): number {
  const version = bsp.readInt32LE(0);
  if (version !== 30 && version !== 29) throw new Error(`Not a GoldSrc BSP (version ${version})`);
  const skip = gameDir === 'bshift' ? 1 : 0;
  let crc = 0xffffffff;
  for (let i = 0; i < 15; i++) {
    if (i === skip) continue;
    const ofs = bsp.readInt32LE(4 + i * 8);
    const len = bsp.readInt32LE(8 + i * 8);
    crc = crcUpdate(crc, bsp.subarray(ofs, ofs + len));
  }
  return crc >>> 0;
}

export function mapChecksumFile(path: string, gameDir?: string): number {
  return mapChecksum(readFileSync(path), gameDir);
}
