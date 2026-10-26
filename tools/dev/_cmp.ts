// Compare naive (apply to previous) vs exact (reference frame) player positions against corpse positions.
import { readFileSync } from 'node:fs';
import { readDemo } from '../../engine/src/container/read.js';
import { FrameType } from '../../engine/src/container/types.js';
import { createState, decodeMessages } from '../../engine/src/protocol/messages.js';
import { EntityTracker, incomingSequence } from '../../engine/src/match/entities.js';
import { extractMatch } from '../../engine/src/match/extract.js';
for (const path of process.argv.slice(2)) {
  const demo = readDemo(new Uint8Array(readFileSync(path)));
  const m = extractMatch(demo);
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);
  const tr = new EntityTracker(s);
  const naive = new Map<number, number[]>();
  // position history per entity: [time, x, y, z] for exact and naive
  const histE = new Map<number, number[][]>(), histN = new Map<number, number[][]>();
  let playback = false;
  demo.sections.forEach((sec, si) => { if (si > 0) playback = true; for (const f of sec.frames) {
    if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
    for (const msg of decodeMessages(f.messages, s)) {
      const b = msg.body; if (!b) continue;
      if (b.kind === 'baseline') tr.baseline(b);
      if (b.kind === 'entities') {
        const st = tr.packet(b, incomingSequence(f.info));
        for (const e of b.entities) { if (e.number > 32) continue; if (e.remove) { naive.delete(e.number); continue; }
          const d = s.deltas.get(e.descriptor)!; const p = naive.get(e.number) ?? [NaN, NaN, NaN];
          naive.set(e.number, [0,1,2].map((i) => d.getFloat(e.record!, `origin[${i}]`) ?? p[i])); }
        if (!playback) continue;
        for (const [n, es] of st) if (n <= 32 && es['origin[0]'] !== undefined) (histE.get(n) ?? histE.set(n, []).get(n)!).push([f.time, es['origin[0]'] as number, es['origin[1]'] as number, es['origin[2]'] as number]);
        for (const [n, o] of naive) if (!isNaN(o[0])) (histN.get(n) ?? histN.set(n, []).get(n)!).push([f.time, ...o]);
      }
    }
  }});
  const slotOf = new Map(m.players.map((p) => [p.id, p.slot]));
  const near = (h: number[][] | undefined, t: number) => { if (!h) return undefined; let best: number[] | undefined; for (const x of h) { if (x[0] <= t) best = x; else break; } return best && t - best[0] < 1 ? best : undefined; };
  let n = 0, e50 = 0, n50 = 0, eHave = 0, nHave = 0; const errE: number[] = [], errN: number[] = [];
  m.deaths.forEach((d, i) => { if (d.victim === undefined) return; const k = m.kills.find((k) => k.victim === d.victim && k.time <= d.time && d.time - k.time < 8); if (!k) return; n++;
    const ent = (slotOf.get(d.victim) ?? -2) + 1;
    const pe = near(histE.get(ent), k.time), pn = near(histN.get(ent), k.time);
    const dist = (p: number[]) => Math.hypot(p[1] - d.position[0], p[2] - d.position[1]);
    if (pe) { eHave++; errE.push(dist(pe)); if (dist(pe) < 50) e50++; }
    if (pn) { nHave++; errN.push(dist(pn)); if (dist(pn) < 50) n50++; }
  });
  const med = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]?.toFixed(1);
  console.log(path.split('/').pop(), `deaths ${n}; exact: pos known ${eHave}, within 50u ${e50}, median ${med(errE)}u | naive: known ${nHave}, within 50u ${n50}, median ${med(errN)}u`);
}
