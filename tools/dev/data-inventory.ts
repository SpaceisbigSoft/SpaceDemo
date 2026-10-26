// Development tool (plan 1.8): census of everything stored in a set of demos.
//   npx tsx tools/dev/data-inventory.ts <folder or demos...> > inventory.json
// Counts frame types, engine messages and user messages; samples user-message payloads, text,
// console commands, director data; lists the delta structures and which fields actually change.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { FrameType } from '../../engine/src/container/types.js';
import { createState, decodeMessages } from '../../engine/src/protocol/messages.js';
import type { DeltaRecord } from '../../engine/src/protocol/delta.js';

const files: string[] = [];
const collect = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) collect(join(p, e));
  else if (extname(p).toLowerCase() === '.dem') files.push(p);
};
for (const a of process.argv.slice(2)) collect(a);

type Counter = Record<string, number>;
const inc = (c: Counter, k: string, n = 1) => (c[k] = (c[k] ?? 0) + n);
const hex = (b: Uint8Array, n = 40) => Buffer.from(b.subarray(0, n)).toString('hex');
const ascii = (b: Uint8Array) => Buffer.from(b).toString('latin1').replace(/[^\x20-\x7e]/g, '·');

const total = {
  demos: [] as string[],
  frameTypes: {} as Counter,
  svc: {} as Counter,
  svcDemos: {} as Counter,
  userMsgDefs: {} as Record<string, { id: number; size: number }[]>,
  userMsg: {} as Counter,
  userMsgDemos: {} as Counter,
  userMsgSamples: {} as Record<string, string[]>,
  stuffText: {} as Counter,
  print: {} as Counter,
  consoleCommands: {} as Counter,
  directorTypes: {} as Counter,
  deltaFields: {} as Record<string, string[]>,
  fieldsChanged: {} as Record<string, Counter>,
  resourceTypes: {} as Counter,
  resourceSamples: {} as Record<string, string[]>,
  eventFrames: 0,
  soundFrames: 0,
  weaponAnimFrames: 0,
};

for (const path of files) {
  const name = basename(path);
  total.demos.push(name);
  const demo = readDemo(new Uint8Array(readFileSync(path)));
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);
  const seenSvc = new Set<string>();
  const seenUser = new Set<string>();
  for (const section of demo.sections) for (const f of section.frames) {
    inc(total.frameTypes, String(f.type));
    if (f.type === FrameType.ConsoleCommand) inc(total.consoleCommands, f.command.replace(/\d+(\.\d+)?/g, '#'));
    if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
    for (const m of decodeMessages(f.messages, s)) {
      const b = m.body;
      if (b?.kind === 'user') {
        inc(total.userMsg, b.name);
        seenUser.add(b.name);
        const arr = (total.userMsgSamples[b.name] ??= []);
        if (arr.length < 12 && Math.random() < 0.2) arr.push(`${hex(b.payload)} |${ascii(b.payload.subarray(0, 40))}|`);
        continue;
      }
      inc(total.svc, m.name);
      seenSvc.add(m.name);
      if (m.name === 'Print' && m.start !== undefined) inc(total.print, ascii(f.messages.subarray(m.start + 1, m.end! - 1)).slice(0, 80).replace(/\d+/g, '#'));
      if (!b) continue;
      switch (b.kind) {
        case 'text': inc(total.stuffText, b.text.trim().replace(/\d+(\.\d+)?/g, '#').slice(0, 80)); break;
        case 'newUserMsg': {
          const list = (total.userMsgDefs[b.def.name] ??= []);
          if (!list.some((d) => d.id === b.def.id && d.size === b.def.size)) list.push({ id: b.def.id, size: b.def.size });
          break;
        }
        case 'director': inc(total.directorTypes, String(b.data[0])); break;
        case 'resourceList':
          for (const r of b.resources) {
            inc(total.resourceTypes, String(r.type));
            const arr = (total.resourceSamples[r.type] ??= []);
            if (arr.length < 400 && !arr.includes(r.name)) arr.push(r.name);
          }
          break;
        case 'entities':
          for (const e of b.entities) if (e.record) noteFields(e.descriptor, e.record);
          break;
        case 'baseline':
          for (const e of b.entities) noteFields(e.descriptor, e.record);
          break;
        case 'clientData':
          noteFields('clientdata_t', b.client);
          for (const w of b.weapons) noteFields('weapon_data_t', w.record);
          break;
      }
    }
  }
  for (const k of seenSvc) inc(total.svcDemos, k);
  for (const k of seenUser) inc(total.userMsgDemos, k);
  for (const [n, d] of s.deltas) total.deltaFields[n] ??= d.fields.map((f) => `${f.name}:${f.kind}${f.bits}/${f.divisor}`);

  function noteFields(desc: string, rec: DeltaRecord) {
    const d = s.deltas.get(desc);
    if (!d) return;
    const c = (total.fieldsChanged[desc] ??= {});
    rec.values.forEach((v, i) => { if (v) inc(c, d.fields[i].name); });
  }
  process.stderr.write(`${name} done\n`);
}

const sortC = (c: Counter) => Object.fromEntries(Object.entries(c).sort((a, b) => b[1] - a[1]));
const out = {
  ...total,
  frameTypes: sortC(total.frameTypes), svc: sortC(total.svc), userMsg: sortC(total.userMsg),
  stuffText: sortC(total.stuffText), print: sortC(total.print), consoleCommands: sortC(total.consoleCommands),
  fieldsChanged: Object.fromEntries(Object.entries(total.fieldsChanged).map(([k, v]) => [k, sortC(v)])),
};
console.log(JSON.stringify(out, null, 1));
