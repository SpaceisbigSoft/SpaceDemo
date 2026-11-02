// Walks a 1999 demo (format 4, protocol 38-40) with the engine's decoder and prints what it holds (plan F4).
// Usage: tsx tools/dev/p40-dump.ts <demo.dem> [--frames a,b,c]
import { readFileSync } from 'node:fs';
import { readDemo4, Frame4Type } from '../../engine/src/legacy/format4.js';
import { createState40, decodeMessages40, emptyEnt40, cloneEnt40, type EntState40 } from '../../engine/src/legacy/p40.js';

const file = process.argv[2];
const show = new Set((process.argv[process.argv.indexOf('--frames') + 1] ?? '').split(',').filter(Boolean).map(Number));
const demo = readDemo4(readFileSync(file));
console.log('header', { ...demo.header }, 'problems', demo.problems);
const s = createState40(demo.header.networkProtocol);
const counts: Record<string, number> = {};
const baselines = new Map<number, EntState40>();
let net = 0;
for (const [si, sec] of demo.sections.entries()) {
  const types: Record<number, number> = {};
  for (const f of sec.frames) {
    types[f.type] = (types[f.type] ?? 0) + 1;
    if (f.type !== Frame4Type.Net && f.type !== Frame4Type.NetLoading) continue;
    net++;
    const msgs = decodeMessages40(f.messages, s);
    for (const m of msgs) {
      counts[m.name] = (counts[m.name] ?? 0) + 1;
      const b = m.body;
      if (!b) continue;
      if (b.kind === 'serverInfo' || b.kind === 'moveVars' || b.kind === 'userInfo' || b.kind === 'maxSpeed') console.log(si, f.index, b);
      if (b.kind === 'resourceList') for (const r of b.resources) console.log('  res', r.type, r.index, r.name, r.size, r.flags);
      if (b.kind === 'newUserMsg') console.log('  usermsg', b.id, b.name, b.size);
      if (b.kind === 'baseline') { baselines.set(b.number, b.state); if (b.number < 40) console.log('  baseline', b.number, JSON.stringify(b.state)); }
      if (show.has(net)) {
        if (b.kind === 'clientData' || b.kind === 'playerInfo') console.log(net, f.time.toFixed(3), JSON.stringify(b));
        if (b.kind === 'entities') {
          for (const u of b.updates) {
            const e = cloneEnt40(baselines.get(u.number) ?? emptyEnt40());
            u.apply(e);
            console.log(net, 'ent', u.number, u.remove ? 'REMOVE' : '', u.flags.toString(16), u.more, JSON.stringify(e));
          }
        }
        if (b.kind === 'sound' || b.kind === 'user') console.log(net, JSON.stringify(b, (k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)));
      }
    }
  }
  console.log('section', si, 'frame types', types);
}
console.log('net frames', net, 'messages', counts);
