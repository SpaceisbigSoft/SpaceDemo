// 5.z Lag tab: each player's scoreboard ping over the demo (one line each), the recorder's lost and choked packets,
// and a list of laggy moments that opens the Radar replay there.
import { useState } from 'react';
import type { DemoDetails, LagMoment } from '../../shared/api.js';
import { formatLength } from '../format.js';

const W = 1000;
const ROW = 34;
/** Pings above this are drawn at the top (and still listed). */
const TOP = 300;

export function LagTab({ d, onWatch }: { d: DemoDetails; onWatch: (round: number, time: number) => void }) {
  const l = d.lag;
  const [kind, setKind] = useState<'all' | LagMoment['kind']>('all');
  const x = (t: number) => (Math.max(0, Math.min(l.seconds, t)) / Math.max(1, l.seconds)) * W;
  const y = (ping: number) => 2 + (1 - Math.min(ping, TOP) / TOP) * (ROW - 4);
  const moments = l.moments.filter((m) => kind === 'all' || m.kind === kind);
  const text = (m: LagMoment) => (m.kind === 'ping' ? `ping ${m.worst} ms` : m.kind === 'lost' ? `${m.worst} packets lost in 2 s` : `${m.worst} packets choked in 2 s`);
  const roundBands = l.rounds.map((r) => <rect key={r.number} x={x(r.start)} y={0} width={Math.max(1, x(r.end) - x(r.start))} height={ROW} className="lag-round" />);

  return (
    <div className="heat-layout">
      <section className="card" aria-labelledby="lag-h" data-testid="details-lag">
        <h2 id="lag-h">Ping over the demo</h2>
        {l.players.length === 0 ? <p className="note">No scoreboard pings in this demo.</p> : (
          <div className="lag-rows">
            {l.players.map((p) => {
              let path = '';
              for (let i = 0; i < p.pings.length; i += 2) {
                const gap = i > 0 && p.pings[i] - p.pings[i - 2] > 5;
                path += `${i === 0 || gap ? 'M' : 'L'}${x(p.pings[i]).toFixed(1)} ${y(p.pings[i + 1]).toFixed(1)}`;
              }
              return (
                <div key={p.name} className="lag-row" data-testid="lag-player">
                  <div className="lag-name">
                    <span className={`side ${p.team ? p.team.toLowerCase() : ''}`}>{p.name}</span>{p.recorder && <span className="sub"> recorder</span>}
                    <span className="note mono" title="Median · 95 % of the time below · highest (ms); average loss">{p.median} · {p.p95} · {p.max} ms{p.loss ? ` · loss ${p.loss} %` : ''}</span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${ROW}`} preserveAspectRatio="none" className="lag-chart" role="img" aria-label={`${p.name}: ping ${p.median} ms most of the time, highest ${p.max} ms`}>
                    {roundBands}
                    <line x1={0} x2={W} y1={y(100)} y2={y(100)} className="lag-ref" />
                    <path d={path} className={`lag-line ${p.team === 'T' ? 't' : p.team === 'CT' ? 'ct' : ''}`} />
                    {l.moments.filter((m) => m.kind === 'ping' && m.who === p.name).map((m, i) => (
                      <line key={i} x1={x(m.time)} x2={x(m.time)} y1={y(m.worst)} y2={ROW - 2} className="lag-spike"><title>{`${formatLength(m.time)}: ${text(m)}`}</title></line>
                    ))}
                  </svg>
                </div>
              );
            })}
            {l.recorder && (
              <div className="lag-row" data-testid="lag-recorder">
                <div className="lag-name">
                  <span>{l.recorder.name}'s connection</span>
                  <span className="note">{l.recorder.lostTotal} packets lost · {l.recorder.choke.length} choked</span>
                </div>
                <svg viewBox={`0 0 ${W} ${ROW}`} preserveAspectRatio="none" className="lag-chart" role="img" aria-label={`${l.recorder.lostTotal} packets lost and ${l.recorder.choke.length} choked over the demo`}>
                  {roundBands}
                  {l.recorder.choke.map((t, i) => <line key={`c${i}`} x1={x(t)} x2={x(t)} y1={ROW / 2} y2={ROW - 2} className="lag-choke" />)}
                  {Array.from({ length: l.recorder.lost.length / 2 }, (_, i) => (
                    <line key={`l${i}`} x1={x(l.recorder!.lost[2 * i])} x2={x(l.recorder!.lost[2 * i])} y1={2} y2={ROW / 2 - Math.min(ROW / 2 - 4, l.recorder!.lost[2 * i + 1] * 2)} className="lag-lost" />
                  ))}
                </svg>
              </div>
            )}
          </div>
        )}
        <span className="note">
          One line per player: ping in ms from the scoreboard (the line marks 100 ms; above {TOP} ms is drawn at the top), shaded = rounds, dots = spikes.
          {l.recorder && ' Last row: packets that never reached the recorder (red, top) and packets the server held back (choke, grey, bottom).'}
          {l.pingsWhenScoreboardOpen && " A player's demo only has pings while the recorder held the scoreboard open, so lines have gaps."}
        </span>
      </section>

      <div className="heat-side">
        <section className="card" aria-labelledby="lagm-h" data-testid="lag-moments">
          <h2 id="lagm-h">Laggy moments ({l.moments.length})</h2>
          <div className="chips" role="group" aria-label="Kind">
            {(['all', 'ping', 'lost', 'choke'] as const).map((k) => (
              <button key={k} type="button" className="filter-chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === 'all' ? 'All' : k === 'ping' ? 'Ping spikes' : k === 'lost' ? 'Lost packets' : 'Choke'}
              </button>
            ))}
          </div>
          {moments.length === 0 ? <p className="note">Nothing laggy found{kind !== 'all' ? ' of this kind' : ''}.</p> : (
            <ul className="lag-list">
              {moments.map((m, i) => (
                <li key={i} data-testid="lag-moment">
                  <span className="mono time">{formatLength(m.time)}</span>
                  <span><strong>{m.who}</strong> · {text(m)}{m.end - m.time >= 1 ? ` (for ${Math.round(m.end - m.time)} s)` : ''}{m.round ? ` · round ${m.round}` : ' · outside the rounds'}</span>
                  {m.round !== undefined && <button type="button" className="link-btn" onClick={() => onWatch(m.round!, m.time - 3)}>Show on the radar</button>}
                </li>
              ))}
            </ul>
          )}
          <span className="note">A ping spike: more than twice the player's usual ping, and at least 150 ms. For the recorder: 5+ packets lost or choked within 2 seconds.</span>
        </section>
      </div>
    </div>
  );
}
