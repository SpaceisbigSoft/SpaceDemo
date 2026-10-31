// Phase 5 tab of the details page: heatmaps (5.k) — kills with killer → victim lines, deaths, bomb plants and time
// spent, over the game's overview picture (or the floor drawn from the map file), with fight distances.
// Team colours follow the rest of the app (T orange, CT blue); shape is the second cue (T = square, CT = circle).
import { useEffect, useMemo, useState } from 'react';
import type { CombinedData, DemoDetails, HeatKill } from '../../shared/api.js';
import { CombineSwitch } from './DetailsCombined.js';
import { formatLength } from '../format.js';

type Layer = 'kills' | 'deaths' | 'time' | 'plants';
const LAYERS: { id: Layer; label: string; title: string }[] = [
  { id: 'kills', label: 'Kills', title: 'A line from where the killer stood to where the victim died (killer position known for most kills)' },
  { id: 'deaths', label: 'Deaths', title: 'Where players died (their bodies)' },
  { id: 'time', label: 'Time spent', title: 'Where players spent their time alive (only where the demo knows their position)' },
  { id: 'plants', label: 'Bomb plants', title: 'Where the bomb was planted' },
];
const BUCKETS = [
  { max: 500, label: 'Under 500' },
  { max: 1000, label: '500–1000' },
  { max: 1500, label: '1000–1500' },
  { max: 2500, label: '1500–2500' },
  { max: Infinity, label: 'Over 2500' },
];
const metres = (u: number) => Math.round(u * 0.0254);
function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]); }
  return m;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : undefined; };

export function HeatmapTab({ d, tagT, tagCT, combined, useCombined = true, onUseCombined }: {
  d: DemoDetails; tagT: string; tagCT: string;
  combined?: CombinedData | { error: string }; useCombined?: boolean; onUseCombined?: (on: boolean) => void;
}) {
  const comb = combined && !('error' in combined) && combined.heatmap ? combined : undefined;
  const isCombined = !!comb && useCombined;
  const h = isCombined ? comb!.heatmap! : d.heatmap;
  const [layers, setLayers] = useState<Set<Layer>>(new Set(['kills', 'plants']));
  const [team, setTeam] = useState<'both' | 'T' | 'CT'>('both');
  const [player, setPlayer] = useState('');
  const [round, setRound] = useState('');
  const [picked, setPicked] = useState<HeatKill | undefined>();
  const toggle = (l: Layer) => setLayers((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; });

  const players = useMemo(() => {
    const names = new Map<string, 'T' | 'CT' | undefined>();
    for (const k of h.kills) { if (k.killerTeam) names.set(k.killer, k.killerTeam); if (k.victimTeam) names.set(k.victim, k.victimTeam); }
    for (const [n, r] of Object.entries(h.heat)) if (!names.has(n)) names.set(n, r.team);
    return [...names].sort((a, b) => (a[1] ?? '').localeCompare(b[1] ?? '') || a[0].localeCompare(b[0]));
  }, [h]);
  const roundOk = (r?: number) => !round || r === Number(round);
  const teamOk = (t?: 'T' | 'CT') => team === 'both' || t === team;
  // Kills: by the killer (team, player). Deaths: by the victim.
  const kills = h.kills.filter((k) => !k.suicide && k.killer !== 'the world' && roundOk(k.round) && teamOk(k.killerTeam) && (!player || k.killer === player));
  const deaths = h.kills.filter((k) => roundOk(k.round) && teamOk(k.victimTeam) && (!player || k.victim === player));
  const plants = h.plants.filter((p) => roundOk(p.round));
  const withDistance = kills.filter((k) => k.distance !== undefined && !k.teamKill);

  // Time spent: add up the chosen players' cells; draw them on a small canvas, smoothed when scaled up.
  const heatImage = useMemo(() => {
    if (!layers.has('time')) return undefined;
    const cols = h.width / h.cell, rows = h.height / h.cell;
    const sum = new Float32Array(cols * rows);
    for (const [name, r] of Object.entries(h.heat)) {
      if ((player && name !== player) || !teamOk(r.team)) continue;
      for (const [i, n, rd] of r.cells) if (!round || rd === Number(round)) sum[i] += n;
    }
    // Soften with a 3x3 kernel (1-2-1) so single paths show as a band, not a dotted line.
    const soft = new Float32Array(sum.length);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = sum[r * cols + c];
      if (!v) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) soft[rr * cols + cc] += v * (dr ? 1 : 2) * (dc ? 1 : 2) / 16;
      }
    }
    sum.set(soft);
    let max = 0;
    for (const v of sum) max = Math.max(max, v);
    if (!max) return undefined;
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < sum.length; i++) {
      if (!sum[i]) continue;
      const v = Math.sqrt(sum[i] / max); // square root: quiet spots stay visible next to spawn areas
      img.data.set([255, Math.round(215 - 175 * v), Math.round(70 - 50 * v), Math.round(80 + 170 * v)], i * 4);
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL();
  }, [h, layers, team, player, round]);

  useEffect(() => setPicked(undefined), [team, player, round]);
  const roundsInDemo = [...new Set(h.kills.map((k) => k.round).filter((r): r is number => r !== undefined))].sort((a, b) => a - b);
  const sideName = (t?: 'T' | 'CT') => (t === 'T' ? tagT : t === 'CT' ? tagCT : '');
  const mark = (x: number, y: number, t: 'T' | 'CT' | undefined, r: number, cls: string) =>
    t === 'T' ? <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={1.5} className={`${cls} t`} /> : <circle cx={x} cy={y} r={r} className={`${cls} ${t === 'CT' ? 'ct' : ''}`} />;
  const killTitle = (k: HeatKill) =>
    `${k.round !== undefined ? `Round ${k.round} · ` : ''}${formatLength(k.time)}: ${k.killer} → ${k.victim} (${k.weapon}${k.headshot ? ', headshot' : ''}${k.teamKill ? ', team kill' : ''})${k.distance !== undefined ? ` · ${k.distance} units ≈ ${metres(k.distance)} m` : ' · killer position not known'}`;

  return (
    <div className="heat-layout">
      <section className="card" aria-labelledby="heat-h" data-testid="details-heatmap">
        <h2 id="heat-h">Map</h2>
        <div className="chip-row" role="group" aria-label="Show on the map">
          {LAYERS.map((l) => (
            <button key={l.id} type="button" className="filter-chip" aria-pressed={layers.has(l.id)} title={l.title} onClick={() => toggle(l.id)}>{l.label}</button>
          ))}
          <CombineSwitch c={combined} on={useCombined} onChange={(on) => onUseCombined?.(on)} />
        </div>
        <div className="log-tools">
          <div className="chips" role="group" aria-label="Team">
            {(['both', 'T', 'CT'] as const).map((t) => (
              <button key={t} type="button" className="filter-chip" aria-pressed={team === t} onClick={() => setTeam(t)}>
                {t === 'both' ? 'Both teams' : <><span className={`side ${t.toLowerCase()}`}>{t}</span> {sideName(t)}</>}
              </button>
            ))}
          </div>
          <select className="select" aria-label="Player" value={player} onChange={(e) => setPlayer(e.target.value)}>
            <option value="">All players</option>
            {players.map(([n, t]) => <option key={n} value={n}>{t ? `${t} · ` : ''}{n}</option>)}
          </select>
          <select className="select" aria-label="Round" value={round} onChange={(e) => setRound(e.target.value)}>
            <option value="">All rounds</option>
            {roundsInDemo.map((r) => <option key={r} value={r}>Round {r}</option>)}
          </select>
        </div>
        <div className="heat-map">
          <svg viewBox={`0 0 ${h.width} ${h.height}`} role="img" aria-label={`Map with ${layers.has('kills') ? `${kills.length} kills, ` : ''}${layers.has('deaths') ? `${deaths.length} deaths, ` : ''}${layers.has('plants') ? `${plants.length} bomb plants` : ''}`} data-testid="heat-svg">
            {h.useMapPicture && d.map.image ? <image href={d.map.image} x={0} y={0} width={h.width} height={h.height} />
              : <rect x={0} y={0} width={h.width} height={h.height} className="heat-bg" />}
            {!h.useMapPicture && h.floorPath && <path d={h.floorPath} className="heat-floor" />}
            {heatImage && <image href={heatImage} x={0} y={0} width={h.width} height={h.height} preserveAspectRatio="none" className="heat-time" data-testid="heat-time" />}
            {h.sites.map((s) => (
              <g key={s.letter + s.x} className="heat-site">
                <circle cx={s.x} cy={s.y} r={30} />
                <text x={s.x} y={s.y + 12} textAnchor="middle">{s.letter}</text>
              </g>
            ))}
            {layers.has('deaths') && deaths.map((k, i) => (
              <g key={`d${i}`} className="heat-death" data-testid="heat-death">
                <title>{`${k.victim} died · ${killTitle(k)}`}</title>
                <path d={`M${k.vx - 6} ${k.vy - 6}L${k.vx + 6} ${k.vy + 6}M${k.vx + 6} ${k.vy - 6}L${k.vx - 6} ${k.vy + 6}`} className={`x ${k.victimTeam === 'T' ? 't' : k.victimTeam === 'CT' ? 'ct' : ''}`} />
              </g>
            ))}
            {layers.has('kills') && kills.map((k, i) => (
              <g key={`k${i}`} className={`heat-kill${picked === k ? ' sel' : ''}`} onClick={() => setPicked(k)} data-testid="heat-kill">
                <title>{killTitle(k)}</title>
                {k.kx !== undefined && <line x1={k.kx} y1={k.ky} x2={k.vx} y2={k.vy} className={`line ${k.killerTeam === 'T' ? 't' : k.killerTeam === 'CT' ? 'ct' : ''}`} />}
                {k.kx !== undefined && mark(k.kx, k.ky!, k.killerTeam, 5, 'killer')}
                <path d={`M${k.vx - 5} ${k.vy - 5}L${k.vx + 5} ${k.vy + 5}M${k.vx + 5} ${k.vy - 5}L${k.vx - 5} ${k.vy + 5}`} className={`x ${k.victimTeam === 'T' ? 't' : k.victimTeam === 'CT' ? 'ct' : ''}`} />
                {k.kx !== undefined && <line x1={k.kx} y1={k.ky} x2={k.vx} y2={k.vy} className="hit" />}
              </g>
            ))}
            {layers.has('plants') && plants.map((p, i) => (
              <g key={`p${i}`} className="heat-plant" data-testid="heat-plant">
                <title>{`Bomb planted${p.site ? ` on ${p.site}` : ''}${p.round !== undefined ? ` · round ${p.round}` : ''} · ${formatLength(p.time)}`}</title>
                <path d={`M${p.x} ${p.y - 9}L${p.x + 8} ${p.y + 6}L${p.x - 8} ${p.y + 6}Z`} />
              </g>
            ))}
          </svg>
        </div>
        <div className="heat-legend" aria-label="Legend">
          <span><svg width="14" height="14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1.5" className="killer t" /></svg> {tagT} (T)</span>
          <span><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" className="killer ct" /></svg> {tagCT} (CT)</span>
          <span>square / circle = killer · ✕ = where the victim died</span>
          <span><svg width="14" height="14" aria-hidden="true"><path d="M7 1L13 12H1Z" className="plant-icon" /></svg> bomb plant</span>
          {layers.has('time') && <span><span className="heat-ramp" aria-hidden="true" /> time spent: little → a lot</span>}
        </div>
        {picked && (
          <p className="picked" role="status" data-testid="heat-picked">{killTitle(picked)}. Jumping there in the game comes after a test in your game.</p>
        )}
        {h.note && <p className="note">{h.note}</p>}
        <span className="note">
          {isCombined
            ? `Positions from this demo and ${comb!.recordings.filter((r) => r.relation === 'same-half').length} other recording(s) of the same rounds, lined up on the kills.`
            : h.recording === 'POV'
            ? "A player's demo only knows where others were when the recorder could see or hear them (and his teammates on the radar), so time spent is partly empty and some killers have no position."
            : 'An HLTV demo sees every player, so positions are complete.'}
          {' '}Hover a mark for details; click a kill to select it.
        </span>
      </section>

      <div className="heat-side">
        <section className="card" aria-labelledby="dist-h" data-testid="heat-distances">
          <h2 id="dist-h">Fight distances</h2>
          {withDistance.length === 0 ? <p className="note">No kills with both positions known for this choice.</p> : (
            <>
              <p className="big-number"><span className="mono">{median(withDistance.map((k) => k.distance!))}</span> units <span className="note">median · about {metres(median(withDistance.map((k) => k.distance!))!)} m · {withDistance.length} of {kills.filter((k) => !k.teamKill).length} kills</span></p>
              <ul className="dist-bars">
                {BUCKETS.map((b, i) => {
                  const n = withDistance.filter((k) => k.distance! < b.max && (i === 0 || k.distance! >= BUCKETS[i - 1].max)).length;
                  return (
                    <li key={b.label} title={`${n} kills at ${b.label} units`}>
                      <span className="lbl">{b.label}</span>
                      <span className="bar"><span style={{ width: `${(n / withDistance.length) * 100}%` }} /></span>
                      <span className="mono n">{n}</span>
                    </li>
                  );
                })}
              </ul>
              <table className="team-table radio-table">
                <thead><tr><th scope="col">Weapon</th><th scope="col" className="num">Kills</th><th scope="col" className="num">Median distance</th></tr></thead>
                <tbody>
                  {[...groupBy(withDistance, (k) => k.weapon)].sort((a, b) => b[1].length - a[1].length).slice(0, 6).map(([w, ks]) => (
                    <tr key={w}><td className="mono">{w}</td><td className="num mono">{ks.length}</td><td className="num mono">{median(ks.map((k) => k.distance!))}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <span className="note">Distance from the killer to where the victim's body lies, in game units (1 unit ≈ 1 inch).</span>
        </section>
        <section className="card" aria-labelledby="plants-h" data-testid="heat-plants">
          <h2 id="plants-h">Bomb plants</h2>
          {plants.length === 0 ? <p className="note">No bomb plants{round ? ' in this round' : ''}.</p> : (
            <p>{[...groupBy(plants, (p) => p.site ?? 'outside a site')].sort((a, b) => a[0].localeCompare(b[0])).map(([s, ps]) => `${s.length === 1 ? `Site ${s}` : s}: ${ps.length}`).join(' · ')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
