// Development tool (plan 1.8 follow-up): how much do POV demos know about other players?
//   npx tsx tools/dev/pov-coverage.ts <match-data folder> <demo.dem | folder>...
// For every player's alive time (live rounds, from match-data JSON), counts 0.5 s slots in which a position is known,
// per source: entity (in the recorder's potentially-visible set), Radar (teammates), sounds (footsteps etc.), shots (events).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { readDemo } from '../../engine/src/container/read.js';
import { FrameType } from '../../engine/src/container/types.js';
import { createState, decodeMessages } from '../../engine/src/protocol/messages.js';

const [matchDir, ...inputs] = process.argv.slice(2);
const files: string[] = [];
const collect = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) collect(join(p, e));
  else if (extname(p).toLowerCase() === '.dem') files.push(p);
};
for (const a of inputs) collect(a);

const SLOT = Number(process.env.SLOT ?? 0.5);
type Src = 'entity' | 'radar' | 'sound' | 'shot';
const SRCS: Src[] = ['entity', 'radar', 'sound', 'shot'];
let killsBoth = 0, killsChecked = 0, killsEntityBoth = 0;
const all: { demo: string; group: 'enemy' | 'team'; aliveSlots: number; known: Record<Src | 'any', number> }[] = [];

for (const path of files) {
  const name = basename(path);
  const mj = join(matchDir, name.replace(/\.dem$/i, '.json'));
  if (!existsSync(mj)) continue;
  const match = JSON.parse(readFileSync(mj, 'utf8'));
  const demo = readDemo(new Uint8Array(readFileSync(path)));
  const s = createState(demo.header.networkProtocol, demo.header.gameDir);
  if (match.players.some((p: { name: string }) => /hltv/i.test(name))) { /* HLTV demos are skipped below */ }

  const names = new Map<number, string>();
  const teams = new Map<number, string>();
  let recorderSlot = -1;
  let hltv = false;
  // known[slotEntity][src] = set of slot indices (time / SLOT)
  const known = new Map<number, Record<Src, Set<number>>>();
  const mark = (ent: number, src: Src, t: number) => {
    if (ent < 1 || ent > 32) return;
    const k = known.get(ent) ?? (known.set(ent, { entity: new Set(), radar: new Set(), sound: new Set(), shot: new Set() }).get(ent)!);
    k[src].add(Math.floor(t / SLOT));
  };
  const packet = new Set<number>();
  let playback = false;
  for (const [si, sec] of demo.sections.entries()) {
    if (si > 0) playback = true;
    for (const f of sec.frames) {
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
      const pending: { index: number; entity?: number }[] = [];
      for (const m of decodeMessages(f.messages, s)) {
        const b = m.body;
        if (!b) continue;
        switch (b.kind) {
          case 'serverInfo': recorderSlot = b.playerSlot; break;
          case 'hltv': hltv = true; break;
          case 'userInfo': if (b.info.name !== undefined) names.set(b.slot, b.info.name); break;
          case 'user':
            if (b.name === 'TeamInfo') teams.set(b.payload[0] - 1, Buffer.from(b.payload.subarray(1)).toString('latin1').replace(/\0.*$/, ''));
            if (b.name === 'Radar' && playback) mark(b.payload[0], 'radar', f.time);
            break;
          case 'sound': if (playback && b.origin[0] !== undefined) mark(b.entity, 'sound', f.time); break;
          case 'events': if (playback) pending.push(...b.events); break;
          case 'entities':
            if (!b.isDelta) packet.clear();
            for (const e of b.entities) e.remove ? packet.delete(e.number) : packet.add(e.number);
            if (playback) for (const n of packet) if (n <= 32) mark(n, 'entity', f.time);
            break;
        }
      }
      const list = [...packet].sort((a, b) => a - b);
      for (const e of pending) if (e.entity !== undefined) mark(list[e.entity] ?? -1, 'shot', f.time);
    }
  }
  if (hltv) continue;
  const myTeam = teams.get(recorderSlot);

  // Kills: is the position of both killer and victim known around the kill (±1 slot)?
  const slotOf = new Map([...names].map(([sl, n]) => [n, sl]));
  const knownNear = (n: string, t: number, srcs: Src[]) => {
    const sl = slotOf.get(n); if (sl === undefined) return false;
    const k = known.get(sl + 1); if (!k) return false;
    const i = Math.floor(t / SLOT);
    return srcs.some((src) => k[src].has(i) || k[src].has(i - 1) || k[src].has(i + 1));
  };
  for (const kill of match.kills) {
    if (kill.killer === 'world' || kill.killer === kill.victim) continue;
    killsChecked++;
    const recorderName = names.get(recorderSlot);
    const kn = (n: string, srcs: Src[]) => n === recorderName || knownNear(n, kill.t, srcs);
    if (kn(kill.killer, SRCS) && kn(kill.victim, SRCS)) killsBoth++;
    if (kn(kill.killer, ['entity']) && kn(kill.victim, ['entity'])) killsEntityBoth++;
  }
  // Alive slots per player: live rounds from freeze end to the player's death or the round end.
  for (const [slot, pname] of names) {
    if (slot === recorderSlot || /hltv/i.test(pname)) continue;
    const team = teams.get(slot);
    if (team !== 'CT' && team !== 'TERRORIST') continue;
    const k = known.get(slot + 1);
    let alive = 0;
    const got: Record<Src | 'any', number> = { entity: 0, radar: 0, sound: 0, shot: 0, any: 0 };
    for (const r of match.rounds) {
      const death = match.kills.find((x: { round: number; victim: string }) => x.round === r.n && x.victim === pname);
      const from = Math.ceil((r.freezeEnd ?? r.start) / SLOT), to = Math.floor((death?.t ?? r.end) / SLOT);
      for (let i = from; i < to; i++) {
        alive++;
        let any = false;
        for (const src of SRCS) if (k?.[src].has(i)) { got[src]++; any = true; }
        if (any) got.any++;
      }
    }
    if (alive) all.push({ demo: name, group: team === myTeam ? 'team' : 'enemy', aliveSlots: alive, known: got });
  }
  process.stderr.write(`${name} done\n`);
}

const pct = (a: number, b: number) => Math.round((100 * a) / b);
for (const group of ['enemy', 'team'] as const) {
  const rows = all.filter((r) => r.group === group);
  const alive = rows.reduce((n, r) => n + r.aliveSlots, 0);
  const line = [...SRCS, 'any' as const].map((src) => `${src} ${pct(rows.reduce((n, r) => n + r.known[src], 0), alive)}%`).join(', ');
  const perPlayer = rows.map((r) => pct(r.known.any, r.aliveSlots)).sort((a, b) => a - b);
  console.log(`${group}: ${rows.length} player-halves, alive ${Math.round(alive * SLOT / 60)} min; position known: ${line}; per player any: min ${perPlayer[0]}%, median ${perPlayer[perPlayer.length >> 1]}%, max ${perPlayer[perPlayer.length - 1]}%`);
}
console.log(`kills in POV demos: ${killsChecked}; both positions known (any source): ${pct(killsBoth, killsChecked)}%; both exactly (entity): ${pct(killsEntityBoth, killsChecked)}%`);
