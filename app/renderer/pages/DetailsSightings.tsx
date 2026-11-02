// Phase 5 tab of the details page: enemy sightings in a player's demo (5.q) — what the recorder could know about the
// other team, round by round: first contact, when each enemy was in sight and where, and the sounds they made.
import { useState } from 'react';
import type { DemoDetails, SightRound, SoundKind } from '../../shared/api.js';
import { formatLength } from '../format.js';

const SOUND: Record<SoundKind, string> = { step: 'footsteps', hit: 'getting hit', death: 'dying', weapon: 'weapon sounds', other: 'other sounds' };
const sideClass = (t?: 'T' | 'CT') => (t === 'T' ? 't' : t === 'CT' ? 'ct' : '');

export function SightingsTab({ d, tagT, tagCT }: { d: DemoDetails; tagT: string; tagCT: string }) {
  const s = d.sightings;
  const [round, setRound] = useState(s?.rounds[0]?.round ?? 1);
  if (!s) {
    return (
      <section className="card" data-testid="details-sightings">
        <h2>Enemy sightings</h2>
        <p className="note">{d.heatmap.recording === 'HLTV' ? 'This is an HLTV demo: it sees every player, so the Radar replay already shows everyone. Sightings are for a player\'s own demo (what he could see and hear).' : "The recorder's position isn't known in this demo, so sightings can't be worked out."}</p>
      </section>
    );
  }
  if (!s.rounds.length) {
    return (
      <section className="card" data-testid="details-sightings">
        <h2>Enemy sightings</h2>
        <p className="note">No round was played to its end in this demo, so there are no sightings to show.</p>
      </section>
    );
  }
  const enemyTag = s.team === 'T' ? tagCT : tagT;
  const r = s.rounds.find((x) => x.round === round) ?? s.rounds[0];
  const live = (x: SightRound) => x.freezeEnd ?? x.start;
  const firsts = s.rounds.filter((x) => x.firstContact);
  const avgFirst = firsts.length ? firsts.reduce((a, x) => a + (x.firstContact!.time - live(x)), 0) / firsts.length : undefined;
  const heardFirst = firsts.filter((x) => x.firstContact!.how === 'heard').length;
  const totals = new Map<string, { team: 'T' | 'CT'; seconds: number; times: number; sounds: number }>();
  for (const x of s.rounds) for (const e of x.enemies) {
    const t = totals.get(e.name) ?? { team: e.team, seconds: 0, times: 0, sounds: 0 };
    t.seconds += e.seenSeconds; t.times += e.seen.length; t.sounds += e.sounds.length;
    totals.set(e.name, t);
  }
  const h = d.heatmap;

  return (
    <div className="heat-layout">
      <section className="card" aria-labelledby="sight-h" data-testid="details-sightings">
        <h2 id="sight-h">Enemy sightings · what {s.recorder} could see and hear</h2>
        <div className="chip-row" role="group" aria-label="Round">
          {s.rounds.map((x) => (
            <button key={x.round} type="button" className="filter-chip" aria-pressed={x.round === r.round} onClick={() => setRound(x.round)} title={`Round ${x.round}`}>R{x.round}</button>
          ))}
        </div>
        <p data-testid="sight-first">
          {r.firstContact ? (
            <>First contact <strong className="mono">{formatLength(r.firstContact.time - live(r))}</strong> after freeze time:{' '}
              <span className={`side ${sideClass(s.team === 'T' ? 'CT' : 'T')}`}>{r.firstContact.name}</span>{' '}
              {r.firstContact.how === 'seen' ? `seen${r.firstContact.weapon ? ` with the ${r.firstContact.weapon}` : ''}` : `heard (${SOUND[r.firstContact.sound ?? 'other']})`}
              {r.firstContact.site ? ` near site ${r.firstContact.site}` : ''}.</>
          ) : <>No enemy seen or heard in this round{r.recorderDied !== undefined ? ' before he died' : ''}.</>}
        </p>
        <Timeline r={r} />
        <div className="heat-map">
          <svg viewBox={`0 0 ${h.width} ${h.height}`} role="img" aria-label={`Where enemies were seen in round ${r.round}`} data-testid="sight-map">
            {h.useMapPicture && d.map.image ? <image href={d.map.image} x={0} y={0} width={h.width} height={h.height} />
              : <rect x={0} y={0} width={h.width} height={h.height} className="heat-bg" />}
            {!h.useMapPicture && h.floorPath && <path d={h.floorPath} className="heat-floor" />}
            {h.sites.map((x) => <g key={x.letter + x.x} className="heat-site"><circle cx={x.x} cy={x.y} r={30} /><text x={x.x} y={x.y + 12} textAnchor="middle">{x.letter}</text></g>)}
            {r.enemies.map((e) => (
              <g key={e.name} className={`sight ${sideClass(e.team)}`}>
                {e.sounds.map((snd, i) => <circle key={`s${i}`} cx={snd.x} cy={snd.y} r={7} className={`snd ${snd.kind}`}><title>{`${e.name} · ${SOUND[snd.kind]} · ${formatLength(snd.time - live(r))}`}</title></circle>)}
                {pathsOf(e.path).map((pts, i) => <polyline key={`p${i}`} points={pts} className="path" />)}
                {e.seen.map((sp, i) => (
                  <circle key={`f${i}`} cx={sp.x} cy={sp.y} r={8} className="first" data-testid="sight-mark">
                    <title>{`${e.name} in sight ${formatLength(sp.from - live(r))}–${formatLength(sp.to - live(r))}${sp.weapon ? ` · ${sp.weapon}` : ''}${sp.crouch ? ` · crouching ${sp.crouch} %` : ''}`}</title>
                  </circle>
                ))}
              </g>
            ))}
            {r.firstContact && <text x={r.firstContact.x} y={r.firstContact.y - 14} textAnchor="middle" className="first-star">★</text>}
          </svg>
        </div>
        <div className="heat-legend">
          <span><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" className="lg-solid" /></svg> where he came into sight (line = how he moved while in sight)</span>
          <span><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" className="lg-ring" /></svg> a sound he made while out of sight</span>
          <span>★ first contact</span>
        </div>
        <span className="note">
          {s.method === 'sight'
            ? 'In sight = in his field of view with nothing solid in between (checked against the map; doors, glass and smoke are not counted). '
            : "In sight = in his view area (the server sent the enemy's position); without the map file, walls inside that area can still hide him. "}
          Heard = a sound within about 1,250 units of him (the game's normal sound range; not measured in game yet). Only while he was alive: after dying he watched his teammates.
        </span>
      </section>

      <div className="heat-side">
        <section className="card" aria-labelledby="sight-sum-h" data-testid="sight-summary">
          <h2 id="sight-sum-h">Whole demo</h2>
          {avgFirst !== undefined && <p className="big-number"><span className="mono">{formatLength(avgFirst)}</span> <span className="note">average time to first contact · heard first in {heardFirst} of {firsts.length} rounds</span></p>}
          <table className="team-table radio-table">
            <thead><tr><th scope="col">{enemyTag}</th><th scope="col" className="num">Times in sight</th><th scope="col" className="num">Seconds</th><th scope="col" className="num">Sounds</th></tr></thead>
            <tbody>
              {[...totals].sort((a, b) => b[1].seconds - a[1].seconds).map(([n, t]) => (
                <tr key={n}><td className="pname"><span className={`side ${sideClass(t.team)}`}>{n}</span></td><td className="num mono">{t.times}</td><td className="num mono">{Math.round(t.seconds)}</td><td className="num mono">{t.sounds}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card" aria-labelledby="sight-round-h">
          <h2 id="sight-round-h">Round {r.round}</h2>
          <ul className="replay-players">
            {r.enemies.map((e) => (
              <li key={e.name} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span className={`side ${sideClass(e.team)}`}>{e.name}</span>
                <span className="note">
                  {e.seen.length ? `in sight ${e.seen.length}× (${seenText(e.seen.length, e.seenSeconds)})${e.seen[0].weapon ? ` · ${[...new Set(e.seen.map((x) => x.weapon).filter(Boolean))].join(', ')}` : ''}` : 'never in sight'}
                  {e.sounds.length ? ` · heard ${e.sounds.length}×` : ''}{e.died !== undefined ? ` · died ${formatLength(e.died - live(r))}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

const seenText = (times: number, seconds: number) => (times === 0 ? '—' : seconds < 1 ? '<1 s' : `${Math.round(seconds)} s`);

function pathsOf(flat: number[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (let i = 0; i < flat.length; i += 3) {
    if (flat[i] < 0) { if (cur.length > 1) out.push(cur.join(' ')); cur = []; continue; }
    cur.push(`${flat[i + 1]},${flat[i + 2]}`);
  }
  if (cur.length > 1) out.push(cur.join(' '));
  return out;
}

function Timeline({ r }: { r: SightRound }) {
  const span = Math.max(1, r.end - r.start);
  const pct = (t: number) => `${((Math.min(Math.max(t, r.start), r.end) - r.start) / span) * 100}%`;
  return (
    <>
    <div className="vt compact" role="img" aria-label={`Round ${r.round}: ${r.enemies.map((e) => `${e.name} in sight ${e.seen.length} times`).join(', ')}`} data-testid="sight-timeline">
      {r.enemies.map((e) => (
        <div key={e.name} className="vt-row" data-testid="sight-row">
          <span className="vt-name" title={e.name}><span className={`side ${sideClass(e.team)}`}>{e.name}</span><span className="note">{seenText(e.seen.length, e.seenSeconds)}</span></span>
          <div className="vt-track">
            {r.freezeEnd !== undefined && <span className="vt-freeze" style={{ left: 0, width: pct(r.freezeEnd) }} />}
            {r.recorderDied !== undefined && <span className="vt-end" style={{ left: pct(r.recorderDied) }} title="the recorder died" />}
            {e.sounds.map((snd, i) => <span key={`s${i}`} className={`sight-tick ${snd.kind}`} style={{ left: pct(snd.time) }} />)}
            {e.seen.map((sp, i) => <span key={i} className={`vt-burst ${sideClass(e.team)}`} style={{ left: pct(sp.from), width: `max(3px, calc(${pct(sp.to)} - ${pct(sp.from)}))` }} title={`in sight ${(sp.to - sp.from).toFixed(1)} s${sp.weapon ? ` · ${sp.weapon}` : ''}`} />)}
            {e.died !== undefined && <span className="sight-died" style={{ left: pct(e.died) }}>✕</span>}
          </div>
        </div>
      ))}
    </div>
      <span className="note">Bars = in sight · small marks = sounds (grey footsteps, red getting hit, white weapon sounds) · ✕ = died · line = the recorder died · shaded = freeze time.</span>
    </>
  );
}
