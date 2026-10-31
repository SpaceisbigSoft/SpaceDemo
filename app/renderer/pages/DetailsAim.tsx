// 5.u Aim tab (player demos): the recorder's reaction time (enemy drawn on his screen → his first shot at him),
// crosshair placement (how far his crosshair was from the enemy's head when the enemy appeared) and shooting while
// moving (his speed at each shot against the weapon's accurate-speed limit).
import { useState } from 'react';
import type { AimPanel, AimSummaryData, DemoDetails } from '../../shared/api.js';
import { formatLength } from '../format.js';

/** 1 game unit ≈ 1 inch. */
const metres = (u: number) => `${Math.round(u * 0.0254)} m`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');

export function AimTab({ d, onWatch }: { d: DemoDetails; onWatch: (round: number, time: number) => void }) {
  const a = d.aim;
  const [round, setRound] = useState<number | 'all'>('all');
  const [picked, setPicked] = useState<number | undefined>();
  if (!a) {
    return (
      <section className="card" data-testid="details-aim">
        <h2>Aim</h2>
        <p className="note">{d.recorder ? 'The aim data could not be read from this demo.' : 'This is an HLTV demo: nobody\'s own view or shots are in it. Aim coaching is for a player\'s own demo.'}</p>
      </section>
    );
  }
  const s = round === 'all' ? a.summary : a.rounds.find((r) => r.round === round) ?? a.summary;
  const moments = a.engagements.map((e, i) => ({ ...e, i })).filter((e) => round === 'all' || e.round === round);
  return (
    <div className="log-layout recorder-layout">
      <section className="card" aria-labelledby="aim-h" data-testid="details-aim">
        <div className="aim-head">
          <h2 id="aim-h">{a.name} · aim</h2>
          <label className="note">Round{' '}
            <select value={round} onChange={(e) => { setRound(e.target.value === 'all' ? 'all' : Number(e.target.value)); setPicked(undefined); }} data-testid="aim-round">
              <option value="all">All rounds</option>
              {a.rounds.map((r) => <option key={r.round} value={r.round}>Round {r.round}</option>)}
            </select>
          </label>
        </div>
        <Summary a={a} s={s} />
        <Hints s={s} />
        <span className="note">
          Measured on {a.name}'s own screen, so his ping doesn't change the numbers. The other players' positions arrived about every {Math.round(a.updateInterval * 1000)} ms and
          his game drew them about {Math.round(a.drawDelay * 1000)} ms later, so times are ≈ ± {a.margin} s. {a.method === 'sight' ? 'An enemy counts as on screen when he was inside the view with nothing solid in between (smoke, doors and glass are not checked).' : 'Without this map version\'s file walls are not checked: an enemy inside the view behind a wall counts as on screen.'}
        </span>
      </section>
      <div className="aim-grid">
        <section className="card" aria-labelledby="aim-pic-h">
          <h2 id="aim-pic-h">Where enemies appeared</h2>
          <CrosshairPicture a={a} moments={moments} picked={picked} onPick={setPicked} />
          <div className="heat-legend"><span><span className="swatch won" /> he won the fight</span><span><span className="swatch lost" /> the enemy killed him</span><span><span className="swatch other" /> no kill</span><span>rings = 5°, 15°, 30°</span></div>
        </section>
        <section className="card" aria-labelledby="aim-w-h">
          <h2 id="aim-w-h">Shots by weapon</h2>
          <table className="team-table scoreboard" data-testid="aim-weapons">
            <thead><tr><th scope="col">Weapon</th><th scope="col" className="num">Shots</th><th scope="col" className="num">Accurate</th><th scope="col" className="num">Too fast</th><th scope="col" className="num">In the air</th><th scope="col">Accurate when</th></tr></thead>
            <tbody>
              {a.weapons.map((w) => (
                <tr key={w.weapon} data-testid="aim-weapon">
                  <td>{w.weapon}</td>
                  <td className="num mono">{w.shots}</td>
                  <td className="num mono">{pct(w.accurate, w.shots)}</td>
                  <td className="num mono">{w.moving || '—'}{w.medianMovingSpeed !== undefined ? <span className="sub"> ~{w.medianMovingSpeed} u/s</span> : ''}</td>
                  <td className="num mono">{w.air || '—'}</td>
                  <td className="sub">{w.limit === null ? 'on the ground, any speed' : w.limit === 0 ? 'standing still' : `below ${w.limit} u/s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="note">Speed limits from the CS 1.6 game code (running with a rifle ≈ 220 u/s, walking ≈ 120). Every weapon is inaccurate in the air. Old CS 1.5 values may differ slightly.</span>
        </section>
      </div>
      <section className="card" aria-labelledby="aim-m-h">
        <h2 id="aim-m-h">Moments ({moments.length})</h2>
        {moments.length === 0 ? <p className="note">No enemy appeared on his screen{round === 'all' ? '' : ' in this round'}.</p> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="team-table scoreboard" data-testid="aim-moments">
              <thead><tr><th scope="col">Round</th><th scope="col" className="num">Time</th><th scope="col">Enemy</th><th scope="col" className="num">Distance</th><th scope="col" className="num">Crosshair off</th><th scope="col">First shot</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Radar</span></th></tr></thead>
              <tbody>
                {moments.map((e) => (
                  <tr key={e.i} className={picked === e.i ? 'picked-row' : ''} onClick={() => setPicked(e.i)} data-testid="aim-moment">
                    <td>R{e.round}</td>
                    <td className="num mono">{formatLength(Math.max(0, e.clock))}</td>
                    <td><span className={`side ${a.team === 'T' ? 'ct' : 't'}`}>{e.enemy}</span></td>
                    <td className="num mono">{metres(e.distance)}</td>
                    <td className="num mono">{e.crosshair}°<span className="sub"> {direction(e.crossH, e.crossV)}</span></td>
                    <td>{e.alreadyFiring ? <span className="sub">already firing</span> : e.reaction === undefined ? <span className="sub">—</span> : e.anticipated ? <span title="Faster than anyone can react: he expected the enemy there">pre-aimed <span className="sub mono">≈ {e.reaction.toFixed(2)} s</span></span> : <span className="mono">≈ {e.reaction.toFixed(2)} s</span>}{e.weapon ? <span className="sub"> {e.weapon}</span> : ''}</td>
                    <td>{e.outcome === 'won' ? <span className="ok-text">killed him</span> : e.outcome === 'lost' ? <span className="bad-text">was killed</span> : <span className="sub">—</span>}</td>
                    <td><button type="button" className="link-btn" onClick={(ev) => { ev.stopPropagation(); onWatch(e.round, e.time - 2); }} data-testid="aim-watch">Show on the radar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <span className="note">Time = after freeze time. Crosshair off = angle between his crosshair and the enemy's head when the enemy first appeared on his screen (after a second or more out of sight). First shot = time from the enemy being drawn to his first shot at him.</span>
      </section>
    </div>
  );
}

/** Where the enemy was compared with the crosshair, in words. */
function direction(h: number, v: number): string {
  const parts: string[] = [];
  if (Math.abs(h) >= 1) parts.push(h > 0 ? 'right' : 'left');
  if (Math.abs(v) >= 1) parts.push(v > 0 ? 'higher' : 'lower');
  return parts.length ? `enemy ${parts.join(', ')}` : '';
}

function Summary({ a, s }: { a: AimPanel; s: AimSummaryData }) {
  return (
    <div className="aim-summary" data-testid="aim-summary">
      <div>
        <div className="chart-label">Reaction (first shot)</div>
        <p className="big-number"><span className="mono">{s.medianReaction === undefined ? '—' : `≈ ${s.medianReaction.toFixed(2)}`}</span>{s.medianReaction !== undefined ? `s ± ${a.margin}` : ''}</p>
        <span className="note">median of {s.reactions} reaction{s.reactions === 1 ? '' : 's'}{s.anticipated ? ` · ${s.anticipated} pre-aimed` : ''}{s.alreadyFiring ? ` · ${s.alreadyFiring} already firing` : ''}</span>
      </div>
      <div>
        <div className="chart-label">Crosshair placement</div>
        <p className="big-number"><span className="mono">{s.medianCrosshair === undefined ? '—' : `${s.medianCrosshair}°`}</span>{s.medianCrosshair !== undefined ? 'off the head' : ''}</p>
        <span className="note">{s.engagements ? `${s.within5} of ${s.engagements} appearances within 5°` : 'no enemy appeared'}</span>
      </div>
      <div>
        <div className="chart-label">Shooting while moving</div>
        <p className="big-number"><span className="mono">{pct(s.accurate, s.shots)}</span>{s.shots ? 'accurate' : ''}</p>
        <span className="note">{s.shots} shots · {s.moving} too fast · {s.air} in the air</span>
      </div>
    </div>
  );
}

/** One or two plain tips from the numbers (only when they clearly say something). */
function Hints({ s }: { s: AimSummaryData }) {
  const tips: string[] = [];
  if (s.engagements >= 5 && s.medianCrossV !== undefined && Math.abs(s.medianCrossV) >= 1.5) {
    tips.push(s.medianCrossV > 0 ? `Enemies' heads were usually ${s.medianCrossV}° above his crosshair: keep it a little higher, at head height.` : `Enemies' heads were usually ${-s.medianCrossV}° below his crosshair: keep it a little lower, at head height.`);
  }
  if (s.shots >= 10 && (s.moving + s.air) / s.shots >= 0.15) tips.push(`${pct(s.moving + s.air, s.shots)} of his shots were fired moving too fast or in the air: stop before shooting.`);
  if (!tips.length) return null;
  return <ul className="aim-tips" data-testid="aim-tips">{tips.map((t) => <li key={t}>{t}</li>)}</ul>;
}

function CrosshairPicture({ a, moments, picked, onPick }: { a: AimPanel; moments: (AimPanel['engagements'][number] & { i: number })[]; picked?: number; onPick: (i: number) => void }) {
  const R = 30, S = 120; // ±30° shown; 120 px from the centre to the edge
  const pos = (deg: number) => (Math.max(-R, Math.min(R, deg)) / R) * S;
  return (
    <svg viewBox={`${-S - 10} ${-S - 10} ${2 * S + 20} ${2 * S + 20}`} className="aim-picture" role="img" aria-label={`Where ${moments.length} enemies appeared compared with ${a.name}'s crosshair`} data-testid="aim-picture">
      {[5, 15, 30].map((r) => <circle key={r} r={(r / R) * S} className="ring" />)}
      <line x1={-8} x2={8} y1={0} y2={0} className="cross" /><line x1={0} x2={0} y1={-8} y2={8} className="cross" />
      {moments.map((e) => (
        <circle key={e.i} cx={pos(e.crossH)} cy={-pos(e.crossV)} r={picked === e.i ? 7 : 4.5} className={`dot ${e.outcome ?? 'other'}${picked === e.i ? ' picked' : ''}`} onClick={() => onPick(e.i)}>
          <title>{`R${e.round} ${formatLength(Math.max(0, e.clock))}: ${e.enemy}, ${e.crosshair}° off`}</title>
        </circle>
      ))}
      <text x={-S} y={S + 6} className="axis">left</text><text x={S} y={S + 6} textAnchor="end" className="axis">right</text>
    </svg>
  );
}
