// Phase 5 tab of the details page: 2D radar replay (5.j), step 1 — every player the demo knows about moving on the map
// as a round plays, with play/pause, speed, a timeline with kills and the bomb, and a round-events list to jump around.
// Known positions only, each source drawn differently (owner's rule: confirmed and uncertain must never look the same):
//   seen = solid dot with view direction · radar (teammate, POV) = smaller solid dot · heard = dot with a ring ·
//   last seen = hollow dashed dot that fades out over 15 s. Estimated positions (2.16) come in the next step.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoDetails, HeatKill, ReplayData, ReplayPlayer } from '../../shared/api.js';
import { formatLength } from '../format.js';

const SPEEDS = [0.5, 1, 2, 4];
const LAST_SEEN_FOR = 15;
const sideClass = (t?: 'T' | 'CT') => (t === 'T' ? 't' : t === 'CT' ? 'ct' : '');

type Source = 'seen' | 'radar' | 'heard' | 'last' | 'dead' | 'unknown';
interface PlayerNow { p: ReplayPlayer; source: Source; x?: number; y?: number; dir?: number; age?: number; weapon?: string; kill?: HeatKill }

/** Index of the last entry (stride `w`) whose time is ≤ t, or -1. */
function lastAt(flat: number[], w: number, t: number): number {
  let lo = 0, hi = flat.length / w - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (flat[mid * w] <= t) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

export function playerAt(p: ReplayPlayer, t: number, kills: HeatKill[]): PlayerNow {
  const weapon = [...p.weapons].reverse().find(([wt]) => wt <= t)?.[1];
  const kill = kills.find((k) => k.victim === p.name && k.time <= t);
  if (kill) return { p, source: 'dead', x: kill.vx, y: kill.vy, kill, weapon };
  const i = lastAt(p.seen, 5, t);
  if (i >= 0 && p.seen[i * 5 + 4] === 1 && t - p.seen[i * 5] <= 0.35) {
    let x = p.seen[i * 5 + 1], y = p.seen[i * 5 + 2];
    const dir = p.seen[i * 5 + 3];
    const j = i + 1;
    // Smooth movement between two close sightings.
    if (j * 5 < p.seen.length && p.seen[j * 5 + 4] === 1 && p.seen[j * 5] - p.seen[i * 5] <= 1) {
      const f = (t - p.seen[i * 5]) / (p.seen[j * 5] - p.seen[i * 5]);
      x += (p.seen[j * 5 + 1] - x) * f;
      y += (p.seen[j * 5 + 2] - y) * f;
    }
    return { p, source: 'seen', x, y, dir: dir >= 0 ? dir : undefined, weapon };
  }
  const r = lastAt(p.radar, 3, t);
  if (r >= 0 && t - p.radar[r * 3] <= 1.2) return { p, source: 'radar', x: p.radar[r * 3 + 1], y: p.radar[r * 3 + 2], weapon };
  const h = lastAt(p.heard, 3, t);
  if (h >= 0 && t - p.heard[h * 3] <= 0.6) return { p, source: 'heard', x: p.heard[h * 3 + 1], y: p.heard[h * 3 + 2], weapon };
  // Last known position from any source, fading.
  const cands: [number, number, number][] = [];
  if (i >= 0 && p.seen[i * 5 + 4] === 1) cands.push([p.seen[i * 5], p.seen[i * 5 + 1], p.seen[i * 5 + 2]]);
  if (r >= 0) cands.push([p.radar[r * 3], p.radar[r * 3 + 1], p.radar[r * 3 + 2]]);
  if (h >= 0) cands.push([p.heard[h * 3], p.heard[h * 3 + 1], p.heard[h * 3 + 2]]);
  const last = cands.sort((a, b) => b[0] - a[0])[0];
  if (last && t - last[0] <= LAST_SEEN_FOR) return { p, source: 'last', x: last[1], y: last[2], age: t - last[0], weapon };
  return { p, source: 'unknown', weapon };
}

const STATUS: Record<Source, string> = { seen: 'seen', radar: 'on the radar', heard: 'heard', last: 'last seen', dead: 'dead', unknown: 'not known' };

export function ReplayTab({ d, tagT, tagCT }: { d: DemoDetails; tagT: string; tagCT: string }) {
  const rounds = d.roundDetails.map((r) => r.number);
  const [round, setRound] = useState(rounds[0] ?? 1);
  const [data, setData] = useState<ReplayData | { error: string } | undefined>();
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [names, setNames] = useState(true);
  const h = d.heatmap;

  useEffect(() => {
    let live = true;
    setData(undefined);
    setPlaying(false);
    void window.spacedemo.getReplay(d.key, round).then((x) => {
      if (!live) return;
      setData(x);
      if (!('error' in x)) setT(x.start);
    });
    return () => { live = false; };
  }, [d.key, round]);

  const r = data && !('error' in data) ? data : undefined;
  // Playback: move the clock with the screen's frames.
  const last = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!playing || !r) return;
    let frame = 0;
    const step = (now: number) => {
      const dt = last.current === undefined ? 0 : (now - last.current) / 1000;
      last.current = now;
      setT((x) => {
        const next = Math.min(r.end, x + dt * speed);
        if (next >= r.end) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); last.current = undefined; };
  }, [playing, speed, r]);

  const jump = useCallback((to: number) => { if (r) setT(Math.max(r.start, Math.min(r.end, to))); }, [r]);
  const onKey = (e: React.KeyboardEvent) => {
    if (!r || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); setPlaying((p) => !p); }
    if (e.key === 'ArrowLeft' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); jump(t - 5); }
    if (e.key === 'ArrowRight' && (e.target as HTMLElement).tagName !== 'INPUT') { e.preventDefault(); jump(t + 5); }
  };

  const now = useMemo(() => (r ? r.players.map((p) => playerAt(p, t, r.kills)) : []), [r, t]);
  const bomb = useMemo(() => {
    if (!r) return undefined;
    const ev = r.bomb.filter((b) => b.time <= t);
    const lastEv = ev.at(-1);
    if (!lastEv || lastEv.kind === 'picked up') return undefined;
    const withPos = [...ev].reverse().find((b) => b.x !== undefined);
    return withPos ? { ...lastEv, x: withPos.x!, y: withPos.y! } : undefined;
  }, [r, t]);
  const clock = (x: number) => {
    if (!r) return '';
    if (r.freezeEnd !== undefined && x < r.freezeEnd) return `freeze time ${formatLength(r.freezeEnd - x)}`;
    return formatLength(x - (r.freezeEnd ?? r.start));
  };
  const pct = (x: number) => (r ? `${((x - r.start) / Math.max(1, r.end - r.start)) * 100}%` : '0%');
  const feed = r ? r.kills.filter((k) => k.time <= t && t - k.time < 6) : [];
  const events = r ? [
    ...r.kills.map((k) => ({ time: k.time, text: `${k.killer} → ${k.victim}`, sub: `${k.weapon}${k.headshot ? ' · headshot' : ''}`, team: k.killerTeam })),
    ...r.bomb.filter((b) => b.kind === 'planted' || b.kind === 'defused' || b.kind === 'exploded').map((b) => ({ time: b.time, text: `Bomb ${b.kind}`, sub: '', team: undefined as 'T' | 'CT' | undefined })),
  ].sort((a, b) => a.time - b.time) : [];
  const roundIdx = rounds.indexOf(round);

  return (
    <div className="heat-layout" onKeyDown={onKey}>
      <section className="card" aria-labelledby="replay-h" data-testid="details-replay">
        <h2 id="replay-h">Radar replay</h2>
        <div className="log-tools">
          <button type="button" className="btn" disabled={roundIdx <= 0} onClick={() => setRound(rounds[roundIdx - 1])} aria-label="Previous round">‹</button>
          <select className="select" aria-label="Round" value={round} onChange={(e) => setRound(Number(e.target.value))}>
            {d.roundDetails.map((x) => <option key={x.number} value={x.number}>Round {x.number}{x.winner ? ` · ${x.winner === 'T' ? tagT : x.winner === 'CT' ? tagCT : 'draw'} won` : ''}</option>)}
          </select>
          <button type="button" className="btn" disabled={roundIdx < 0 || roundIdx >= rounds.length - 1} onClick={() => setRound(rounds[roundIdx + 1])} aria-label="Next round">›</button>
          <button type="button" className="btn primary" onClick={() => { if (r && t >= r.end) setT(r.start); setPlaying(!playing); }} disabled={!r} data-testid="replay-play" aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <div className="chips" role="group" aria-label="Speed">
            {SPEEDS.map((s) => <button key={s} type="button" className="filter-chip" aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
          <button type="button" className="filter-chip" aria-pressed={names} onClick={() => setNames(!names)}>Names</button>
        </div>
        {!data && <p className="note" role="status">Loading round {round}…</p>}
        {data && 'error' in data && <p className="problem" role="alert">{data.error}</p>}
        {r && (
          <>
            <div className="heat-map replay-map">
              <svg viewBox={`0 0 ${h.width} ${h.height}`} role="img" aria-label={`Radar at ${clock(t)}: ${now.map((n) => `${n.p.name} ${STATUS[n.source]}`).join(', ')}`} data-testid="replay-svg">
                {h.useMapPicture && d.map.image ? <image href={d.map.image} x={0} y={0} width={h.width} height={h.height} />
                  : <rect x={0} y={0} width={h.width} height={h.height} className="heat-bg" />}
                {!h.useMapPicture && h.floorPath && <path d={h.floorPath} className="heat-floor" />}
                {h.sites.map((s) => (
                  <g key={s.letter + s.x} className="heat-site"><circle cx={s.x} cy={s.y} r={30} /><text x={s.x} y={s.y + 12} textAnchor="middle">{s.letter}</text></g>
                ))}
                {bomb && (
                  <g className={`replay-bomb ${bomb.kind}`} data-testid="replay-bomb">
                    <title>{`Bomb ${bomb.kind}`}</title>
                    <rect x={bomb.x - 7} y={bomb.y - 5} width={14} height={10} rx={2} />
                    {bomb.kind === 'planted' && <circle cx={bomb.x} cy={bomb.y} r={16} className="pulse" />}
                  </g>
                )}
                {now.filter((n) => n.x !== undefined).map((n) => (
                  <g key={n.p.name} className={`dot ${n.source} ${sideClass(n.p.team)}${n.p.recorder ? ' rec' : ''}`} data-testid="replay-dot" data-source={n.source}
                    style={n.source === 'last' ? { opacity: Math.max(0.15, 1 - (n.age ?? 0) / LAST_SEEN_FOR) } : undefined}>
                    <title>{`${n.p.name} · ${STATUS[n.source]}${n.age !== undefined ? ` ${Math.round(n.age)} s ago` : ''}${n.weapon ? ` · ${n.weapon}` : ''}`}</title>
                    {n.source === 'dead' ? (
                      <path d={`M${n.x! - 9} ${n.y! - 9}L${n.x! + 9} ${n.y! + 9}M${n.x! + 9} ${n.y! - 9}L${n.x! - 9} ${n.y! + 9}`} className="x" />
                    ) : (
                      <>
                        {n.source === 'heard' && <circle cx={n.x} cy={n.y} r={19} className="ring" />}
                        {n.dir !== undefined && <line x1={n.x} y1={n.y} x2={n.x! + 26 * Math.cos((n.dir * Math.PI) / 180)} y2={n.y! + 26 * Math.sin((n.dir * Math.PI) / 180)} className="view" />}
                        <circle cx={n.x} cy={n.y} r={n.source === 'radar' ? 8 : 11} className="body" />
                      </>
                    )}
                    {names && n.source !== 'dead' && <text x={n.x} y={n.y! - 17} textAnchor="middle" className="label">{n.p.name}{n.source === 'last' ? ` (${Math.round(n.age ?? 0)} s)` : ''}</text>}
                  </g>
                ))}
              </svg>
              {feed.length > 0 && (
                <ul className="killfeed" aria-label="Kill feed" data-testid="replay-feed">
                  {feed.map((k, i) => (
                    <li key={i}><span className={`side ${sideClass(k.killerTeam)}`}>{k.killer}</span> <span className="mono">{k.weapon}{k.headshot ? ' ◎' : ''}</span> <span className={`side ${sideClass(k.victimTeam)}`}>{k.victim}</span></li>
                  ))}
                </ul>
              )}
            </div>
            <div className="replay-time">
              <span className="mono big" data-testid="replay-clock">{clock(t)}</span>
              <span className="note">round {r.round} · {formatLength(t)} in the demo</span>
            </div>
            <div className="replay-scrub">
              <input type="range" min={r.start} max={r.end} step={0.1} value={t} onChange={(e) => { setT(Number(e.target.value)); }} aria-label="Time in the round" data-testid="replay-slider" />
              <div className="timeline replay-marks" aria-hidden="true">
                {r.freezeEnd !== undefined && <span className="freeze" style={{ width: pct(r.freezeEnd) }} />}
                {r.kills.map((k, i) => <span key={i} className={`tick ${sideClass(k.killerTeam)}`} style={{ left: pct(k.time) }} />)}
                {r.bomb.filter((b) => b.kind === 'planted').map((b, i) => <span key={`b${i}`} className="bomb plant" style={{ left: pct(b.time) }}>▲</span>)}
              </div>
            </div>
            <div className="heat-legend" aria-label="Legend">
              <span><svg width="22" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" className="lg-solid" /><line x1="8" y1="8" x2="20" y2="8" className="lg-view" /></svg> seen (exact, with view direction)</span>
              <span><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="4.5" className="lg-solid" /></svg> on the radar (teammate)</span>
              <span><svg width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="9" className="lg-ring" /><circle cx="10" cy="10" r="5" className="lg-solid" /></svg> heard (a sound he made)</span>
              <span><svg width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6" className="lg-last" /></svg> last seen (fades)</span>
              <span>✕ dead · <span className="side t">orange</span> {tagT} · <span className="side ct">blue</span> {tagCT}</span>
            </div>
            <span className="note">
              {r.recording === 'POV' ? "A player's demo shows what the recorder knew: teammates on the radar, enemies only when he saw or heard them." : 'An HLTV demo sees every player.'}
              {' '}Estimated positions (where an unseen player probably is) come next. Space = play/pause, ← → = 5 s.
            </span>
          </>
        )}
      </section>

      <div className="heat-side">
        <section className="card" aria-labelledby="rp-players-h" data-testid="replay-players">
          <h2 id="rp-players-h">Players</h2>
          <ul className="replay-players">
            {now.map((n) => (
              <li key={n.p.name} className={n.source === 'dead' ? 'dead' : ''}>
                <span className={`side ${sideClass(n.p.team)}`}>{n.p.name}</span>
                <span className="note">{STATUS[n.source]}{n.age !== undefined ? ` ${Math.round(n.age)} s ago` : ''}{n.weapon && n.source !== 'dead' ? ` · ${n.weapon}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-labelledby="rp-events-h" data-testid="replay-events">
          <h2 id="rp-events-h">Round events</h2>
          {events.length === 0 ? <p className="note">No kills or bomb events in this round.</p> : (
            <ul className="replay-events">
              {events.map((e, i) => (
                <li key={i} className={e.time <= t ? 'past' : ''}>
                  <button type="button" className="log-time mono" onClick={() => { jump(e.time - 3); }} title="Go to 3 s before this">{clock(e.time)}</button>
                  <span><span className={`side ${sideClass(e.team)}`}>{e.text}</span> <span className="note">{e.sub}</span></span>
                </li>
              ))}
            </ul>
          )}
          <span className="note">Click a time to go to just before it.</span>
        </section>
      </div>
    </div>
  );
}
