// Development helper: reads the packets of a single-stream Ogg file (ffmpeg's Opus output).
/** Minimal Ogg page reader returning the packets of a single logical stream. */
export function oggPackets(b: Uint8Array): Uint8Array[] {
  const packets: Uint8Array[] = [];
  let pending: number[] = [];
  let p = 0;
  while (p + 27 <= b.length) {
    if (b[p] !== 0x4f || b[p + 1] !== 0x67 || b[p + 2] !== 0x67 || b[p + 3] !== 0x53) throw new Error('Bad Ogg page');
    const segments = b[p + 26];
    const table = b.subarray(p + 27, p + 27 + segments);
    let q = p + 27 + segments;
    for (const len of table) {
      for (let i = 0; i < len; i++) pending.push(b[q + i]);
      q += len;
      if (len < 255) {
        packets.push(Uint8Array.from(pending));
        pending = [];
      }
    }
    p = q;
  }
  return packets;
}
