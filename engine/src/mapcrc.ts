// Map checksum exactly as the GoldSrc engine computes it (ReHLDS crc.cpp CRC_MapFile):
// CRC-32 over every BSP lump except the entities lump, in lump order, WITHOUT the final inversion.
// This is the value stored in a demo header's map checksum field.
import { readFileSync } from 'node:fs';
import { crc32Update } from './crc32.js';

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
    crc = crc32Update(crc, bsp.subarray(ofs, ofs + len));
  }
  return crc >>> 0;
}

export function mapChecksumFile(path: string, gameDir?: string): number {
  return mapChecksum(readFileSync(path), gameDir);
}
