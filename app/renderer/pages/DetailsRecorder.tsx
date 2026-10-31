// Phase 5 tab of the details page: the recorder panel (5.n) — the recorder's own money, buys, health, damage taken,
// running speed and the keys he pressed, for the whole demo and round by round. Player demos (POV) only.
import { useState } from 'react';
import type { DemoDetails, RecorderPanel } from '../../shared/api.js';
import { formatLength } from '../format.js';

const KEY_ROWS: [string, string][] = [
  ['forward', 'W'], ['moveleft', 'A'], ['back', 'S'], ['moveright', 'D'], ['jump', 'Jump'], ['duck', 'Duck'],
  ['speed', 'Walk'], ['attack', 'Fire'], ['attack2', 'Alt fire'], ['reload', 'Reload'], ['use', 'Use'], ['showscores', 'Scores'],
];
const money = (n?: number) => (n === undefined ? '—' : `$${n.toLocaleString('en-US')}`);

export function RecorderTab({ d }: { d: DemoDetails }) {
  const p = d.recorder;
  const [round, setRound] = useState(p?.rounds[0]?.round ?? 1);
  if (!p) {
    return (
      <section className="card" data-testid="details-recorder">
        <h2>Recorder</h2>
        <p className="note">This is an HLTV demo: nobody's own money, health or keys are in it. The recorder panel is for a player's own demo.</p>
      </section>
    );
  }
  const r = p.rounds.find((x) => x.round === round) ?? p.rounds[0];
  return (
    <div className="log-layout recorder-layout">
      <section className="card" aria-labelledby="rec-h" data-testid="details-recorder">
        <h2 id="rec-h">{p.name} · money</h2>
        <MoneyChart p={p} onPick={setRound} picked={r.round} />
        <div style={{ overflowX: 'auto' }}>
          <table className="team-table scoreboard" data-testid="rec-rounds">
            <thead>
              <tr>
                <th scope="col">Round</th><th scope="col" className="num">Start</th><th scope="col" className="num">Spent</th><th scope="col" className="num">End</th>
                <th scope="col">Weapons in hand</th><th scope="col" className="num">Kills</th><th scope="col" className="num">Damage taken</th><th scope="col" className="num">Speed avg / top</th>
              </tr>
            </thead>
            <tbody>
              {p.rounds.map((x) => (
                <tr key={x.round} className={x.round === r.round ? 'picked-row' : ''} data-testid="rec-round">
                  <td><button type="button" className="link-btn" onClick={() => setRound(x.round)}>R{x.round}</button>{x.died !== undefined ? <span className="sub"> ✕ died {formatLength(x.died - (x.freezeEnd ?? x.start))}</span> : ''}</td>
                  <td className="num mono">{money(x.startMoney)}</td>
                  <td className="num mono">{x.spent ? money(x.spent) : '—'}</td>
                  <td className="num mono">{money(x.endMoney)}</td>
                  <td className="talkcell">{x.weapons.filter((w) => w !== 'knife').join(', ') || 'knife'}</td>
                  <td className="num mono">{x.kills}</td>
                  <td className="num mono">{x.damage.length ? x.damage.reduce((a, b) => a + b.amount, 0) : '—'}</td>
                  <td className="num mono">{x.avgSpeed !== undefined ? `${x.avgSpeed} / ${x.topSpeed}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="note">Spent = what his money went down by during buy time (90 s after freeze time). Weapons = everything he had in his hand. Speed in game units per second while alive (running with a knife ≈ 250; walking ≈ 130).</span>
      </section>
      <section className="card" aria-labelledby="rec-round-h" data-testid="rec-round-detail">
        <h2 id="rec-round-h">Round {r.round}</h2>
        <RoundDetail p={p} round={r.round} />
      </section>
    </div>
  );
}

function MoneyChart({ p, onPick, picked }: { p: RecorderPanel; onPick: (n: number) => void; picked: number }) {
  const W = 1000, H = 160;
  const t0 = p.rounds[0]?.start ?? 0, t1 = p.rounds.at(-1)?.end ?? 1;
  const pts = p.money.filter(([t]) => t >= t0 - 1 && t <= t1);
  const max = Math.max(16000, ...pts.map(([, v]) => v));
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v: number) => H - (v / max) * (H - 10) - 2;
  let d = '';
  let last: number | undefined;
  for (const [t, v] of pts) { d += last === undefined ? `M${x(Math.max(t, t0))} ${y(v)}` : `H${x(t)}V${y(v)}`; last = v; }
  if (last !== undefined) d += `H${W}`;
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="money-chart" role="img" aria-label="Money through the demo" data-testid="rec-money">
      {p.rounds.map((r) => (
        <g key={r.round} className={`round-band${r.round === picked ? ' picked' : ''}`} onClick={() => onPick(r.round)}>
          <rect x={x(r.start)} y={0} width={Math.max(1, x(r.end) - x(r.start))} height={H} />
          <text x={(x(r.start) + x(r.end)) / 2} y={H + 14} textAnchor="middle" className="axis">{r.round}</text>
        </g>
      ))}
      {[0, 4000, 8000, 12000, 16000].filter((v) => v <= max).map((v) => (
        <g key={v}><line x1={0} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={2} y={y(v) - 3} className="axis">{v ? `$${v / 1000}k` : '$0'}</text></g>
      ))}
      <path d={d} className="line" />
    </svg>
  );
}

function RoundDetail({ p, round }: { p: RecorderPanel; round: number }) {
  const r = p.rounds.find((x) => x.round === round)!;
  const start = r.start, end = r.end;
  const span = Math.max(1, end - start);
  const pct = (t: number) => `${((Math.min(Math.max(t, start), end) - start) / span) * 100}%`;
  const keys = p.keys.filter(([, a, b]) => b >= start && a <= end);
  const W = 1000, H = 90;
  const x = (t: number) => ((t - start) / span) * W;
  const sp: string[] = [];
  for (let i = 0; i < p.speed.length; i += 2) if (p.speed[i] >= start && p.speed[i] <= end) sp.push(`${x(p.speed[i]).toFixed(1)},${(H - (p.speed[i + 1] / 300) * H).toFixed(1)}`);
  const hp: string[] = [];
  let lastHp = p.health.filter(([t]) => t <= start).at(-1)?.[1] ?? 100;
  hp.push(`M0 ${H - (lastHp / 100) * H}`);
  for (const [t, v] of p.health) if (t > start && t <= end) { hp.push(`H${x(t).toFixed(1)}V${(H - (Math.min(100, v) / 100) * H).toFixed(1)}`); lastHp = v; }
  hp.push(`H${W}`);
  const weapons = p.weapons.filter(([t]) => t >= start && t <= end);
  return (
    <>
      <p className="note">
        {money(r.startMoney)} at the start{r.spent ? `, spent ${money(r.spent)}` : ''} · {r.kills} kill{r.kills === 1 ? '' : 's'}
        {r.damage.length ? ` · hit ${r.damage.length}× for ${r.damage.reduce((a, b) => a + b.amount, 0)} damage` : ' · not hit'}{r.died !== undefined ? ` · died at ${formatLength(r.died - (r.freezeEnd ?? r.start))}` : ' · survived'}
      </p>
      <div className="vt compact"><div className="vt-row tall">
      <span className="vt-name"><span>Health, speed</span></span>
      <svg viewBox={`0 0 ${W} ${H}`} className="rec-lines" preserveAspectRatio="none" role="img" aria-label="Health and speed in this round" data-testid="rec-lines">
        {r.freezeEnd !== undefined && <rect x={0} y={0} width={x(r.freezeEnd)} height={H} className="freeze" />}
        <line x1={0} x2={W} y1={H - (250 / 300) * H} y2={H - (250 / 300) * H} className="grid" />
        <path d={hp.join('')} className="hp" vectorEffect="non-scaling-stroke" />
        {sp.length > 1 && <polyline points={sp.join(' ')} className="speed" vectorEffect="non-scaling-stroke" />}
        {r.damage.map((dm, i) => <line key={i} x1={x(dm.time)} x2={x(dm.time)} y1={0} y2={H} className="hit" vectorEffect="non-scaling-stroke" />)}
      </svg>
      </div>
      <div className="vt-row">
      <span className="vt-name"><span>Weapon</span></span>
      <div className="weapon-strip" data-testid="rec-weapons">
        {weapons.map(([t, w], i) => {
          const to = weapons[i + 1]?.[0] ?? Math.min(end, r.died ?? end);
          return <span key={i} className="w" style={{ left: pct(t), width: `calc(${pct(to)} - ${pct(t)})` }} title={`${formatLength(t - (r.freezeEnd ?? start))}: ${w}`}>{w}</span>;
        })}
      </div>
      </div></div>
      <div className="heat-legend"><span><span className="swatch hp" /> health (top = 100)</span><span><span className="swatch speed" /> speed (line = 250, running)</span><span><span className="swatch hit" /> hit</span><span>shaded = freeze time</span></div>
      <div className="chart-label">Keys</div>
      <div className="vt compact keys" role="img" aria-label="Keys pressed in this round" data-testid="rec-keys">
        {KEY_ROWS.map(([k, label]) => {
          const ks = keys.filter(([n]) => n === k);
          if (!ks.length) return null;
          return (
            <div key={k} className="vt-row">
              <span className="vt-name"><span>{label}</span><span className="note">{ks.length}×</span></span>
              <div className="vt-track">
                {r.freezeEnd !== undefined && <span className="vt-freeze" style={{ left: 0, width: pct(r.freezeEnd) }} />}
                {ks.map(([, a, b], i) => <span key={i} className="vt-burst key" style={{ left: pct(a), width: `max(2px, calc(${pct(b)} - ${pct(a)}))` }} />)}
              </div>
            </div>
          );
        })}
      </div>
      <span className="note">Keys as his game recorded them. The keys can't be drawn into the game while it plays a demo (that would mean touching the game); the Radar replay shows them live instead.</span>
    </>
  );
}
