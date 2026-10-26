// Standard CRC-32 (IEEE 802.3, reflected, polynomial 0xEDB88320).
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Continues a running CRC register (start with 0xffffffff). Returns the register, not yet inverted. */
export function crc32Update(register: number, data: Uint8Array): number {
  let c = register;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** Finished CRC-32 of `data`. */
export function crc32(data: Uint8Array): number {
  return (crc32Update(0xffffffff, data) ^ 0xffffffff) >>> 0;
}
