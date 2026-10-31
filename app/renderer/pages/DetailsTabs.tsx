// Phase 5 tabs of the details page: match overview extras (5.h), rounds and timeline (5.c), scoreboard and stats (5.d).
import { useState } from 'react';
import type { DemoDetails, RoundDetail, StatRow } from '../../shared/api.js';
import { formatLength } from '../format.js';

const REASON: Record<string, string> = {
  eliminated: 'team killed', 'bomb exploded': 'bomb exploded', 'bomb defused': 'bomb defused', 'time ran out': 'time ran out', draw: 'draw',
};
const secs = (s: number) => formatLength(Math.max(0, s));

/** 5.h: server, settings and network settings per player. */
export function ServerCard({ d }: { d: DemoDetails }) {
  const o = d.overview;
  return (
    <>
      <section className="card" aria-labelledby="server-h" data-testid="details-server">
        <h2 id="server-h">Server and settings</h2>
        <dl className="facts">
          {o.hostName && <><dt>Server</dt><dd>{o.hostName}</dd></>}
          {o.serverBuild !== undefined && <><dt>Server build</dt><dd className="mono">{o.serverBuild}</dd></>}
          {o.maxClients !== undefined && <><dt>Slots</dt><dd>{o.maxClients}</dd></>}
          {o.voiceCodec && <><dt>Voice</dt><dd className="mono">{o.voiceCodec}{o.voiceQuality !== undefined ? ` · quality ${o.voiceQuality}` : ''}</dd></>}
          {o.measuredUpdatesPerSecond !== undefined && <><dt>Recorded at</dt><dd>{o.measuredUpdatesPerSecond} updates/s{o.measuredFps ? ` · ${o.measuredFps} fps` : ''}</dd></>}
          {o.restarts > 0 && <><dt>Warm-up</dt><dd>{o.restarts} restart{o.restarts > 1 ? 's' : ''}; live from {secs(o.liveStart ?? 0)}</dd></>}
        </dl>
        {o.serverMessages.length > 0 && (
          <>
            <span className="note">Server messages</span>
            <ul className="health">{o.serverMessages.map((m) => <li key={m} className="mono">{m}</li>)}</ul>
          </>
        )}
      </section>
      <section className="card" aria-labelledby="net-h" data-testid="details-network">
        <h2 id="net-h">Network settings</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="team-table">
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col" className="num">rate</th>
                <th scope="col" className="num">cl_updaterate</th>
                <th scope="col" className="num">cl_lw</th>
                <th scope="col" className="num">cl_lc</th>
                <th scope="col">Changed during the demo</th>
              </tr>
            </thead>
            <tbody>
              {o.network.map((n) => (
                <tr key={n.name}>
                  <td className="pname"><span className={n.team === 'T' ? 'side t' : n.team === 'CT' ? 'side ct' : ''}>{n.name}</span>{n.recorder && <span className="sub"> recorder</span>}</td>
                  <td className="num mono">{n.rate ? String(Math.round(Number(n.rate)) || n.rate) : '—'}</td>
                  <td className="num mono">{n.updateRate ?? '—'}</td>
                  <td className="num mono">{n.clientWeapons ?? '—'}</td>
                  <td className="num mono">{n.lagCompensation ?? '—'}</td>
                  <td className="talkcell">{n.changes.length ? n.changes.join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <span className="note">As each player's game sent them to the server (userinfo).</span>
      </section>
    </>
  );
}

/** 5.c: one line per round with a timeline of kills and the bomb. */
export function RoundsTab({ d, tagT, tagCT }: { d: DemoDetails; tagT: string; tagCT: string }) {
  const longest = Math.max(1, ...d.roundDetails.map((r) => r.seconds));
  return (
    <section className="card" aria-labelledby="rounds-h" data-testid="details-rounds">
      <h2 id="rounds-h">Rounds</h2>
      <p className="note">Each bar runs from the end of freeze time to the end of the round. Ticks are kills (colour = the killer's side), ▲ the bomb plant, ◆ the defuse or explosion. Hover for details.</p>
      <ol className="round-list">
        {d.roundDetails.map((r) => <RoundLine key={r.number} r={r} longest={longest} tagT={tagT} tagCT={tagCT} />)}
      </ol>
      <span className="note">Jumping to a round in the game needs a test in your game first (plan 5.c); for now use the demo panel's timeline.</span>
    </section>
  );
}

function RoundLine({ r, longest, tagT, tagCT }: { r: RoundDetail; longest: number; tagT: string; tagCT: string }) {
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), r.seconds) / longest) * 100}%`;
  const winner = r.winner === 'T' ? tagT : r.winner === 'CT' ? tagCT : 'draw';
  return (
    <li className="round-line" data-testid="round-line">
      <div className="round-head">
        <span className={`round-badge ${r.winner === 'T' ? 't' : r.winner === 'CT' ? 'ct' : 'draw'}`}>{r.number}</span>
        <span><strong>{winner}</strong>{r.reason ? ` · ${REASON[r.reason] ?? r.reason}` : ''}</span>
        <span className="note">{secs(r.seconds)}{r.bombTimer !== undefined ? ` · bomb ${Math.round(r.bombTimer)} s after plant` : ''}</span>
        {r.scoreT !== undefined && <span className="mono score-after">{r.scoreT} : {r.scoreCT}</span>}
      </div>
      <div className="timeline" role="img" aria-label={`Round ${r.number}: ${r.kills.length} kills${r.plantedAt !== undefined ? ', bomb planted' : ''}`}>
        <div className="track" style={{ width: pct(r.seconds) }} />
        {r.kills.map((k, i) => (
          <span key={i} className={`tick ${k.killerTeam === 'T' ? 't' : k.killerTeam === 'CT' ? 'ct' : ''}${k.teamKill ? ' tk' : ''}`} style={{ left: pct(k.at) }}
            title={`${secs(k.at)} ${k.killer} → ${k.victim} (${k.weapon}${k.headshot ? ', headshot' : ''}${k.teamKill ? ', team kill' : ''})`} />
        ))}
        {r.plantedAt !== undefined && <span className="bomb plant" style={{ left: pct(r.plantedAt) }} title={`Bomb planted at ${secs(r.plantedAt)}`}>▲</span>}
        {r.bombEnd && <span className="bomb end" style={{ left: pct(r.bombEnd.at) }} title={`Bomb ${r.bombEnd.kind} at ${secs(r.bombEnd.at)}`}>◆</span>}
      </div>
    </li>
  );
}

type SortKey = 'kills' | 'deaths' | 'kd' | 'hs' | 'fk' | 'multi' | 'clutch';

/** 5.d: scoreboard and stats. */
export function ScoreboardTab({ d }: { d: DemoDetails }) {
  const [sort, setSort] = useState<SortKey>('kills');
  const val = (s: StatRow): number => {
    switch (sort) {
      case 'kills': return s.kills;
      case 'deaths': return -s.deaths;
      case 'kd': return s.kills / Math.max(1, s.deaths);
      case 'hs': return s.kills ? s.headshots / s.kills : 0;
      case 'fk': return s.firstKills;
      case 'multi': return s.multiKills[2] + 2 * s.multiKills[3] + 3 * s.multiKills[4] + 4 * s.multiKills[5];
      case 'clutch': return s.clutches.length;
    }
  };
  const rows = [...d.stats].sort((a, b) => val(b) - val(a));
  const th = (k: SortKey, label: string, title?: string) => (
    <th scope="col" className="num" aria-sort={sort === k ? 'descending' : undefined}>
      <button type="button" className="th-sort" onClick={() => setSort(k)} title={title}>{label}<span aria-hidden="true" className="sort-mark">{sort === k ? '▼' : ''}</span></button>
    </th>
  );
  return (
    <section className="card" aria-labelledby="sb-h" data-testid="details-scoreboard">
      <h2 id="sb-h">Scoreboard</h2>
      <div style={{ overflowX: 'auto' }}>
        <table className="team-table scoreboard">
          <thead>
            <tr>
              <th scope="col">Player</th>
              {th('kills', 'K')}{th('deaths', 'D')}{th('kd', 'K/D')}{th('hs', 'HS %')}
              {th('fk', 'First kills', 'Opening kills of a round (first deaths in brackets)')}
              {th('multi', '2K/3K/4K/5K', 'Rounds with 2, 3, 4 and 5 kills')}
              {th('clutch', 'Clutches', 'Rounds won as the last player alive (1 vs X)')}
              <th scope="col">Weapons (kills)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.name} data-testid="stat-row">
                <td className="pname"><span className={`side ${s.team.toLowerCase()}`}>{s.name}</span>{s.recorder && <span className="sub"> recorder</span>}
                  {(s.teamKills > 0 || s.suicides > 0) && <span className="sub"> · {s.teamKills ? `${s.teamKills} team kill${s.teamKills > 1 ? 's' : ''}` : ''}{s.teamKills && s.suicides ? ', ' : ''}{s.suicides ? `${s.suicides} suicide${s.suicides > 1 ? 's' : ''}` : ''}</span>}
                </td>
                <td className="num mono">{s.kills}</td>
                <td className="num mono">{s.deaths}</td>
                <td className="num mono">{(s.kills / Math.max(1, s.deaths)).toFixed(2)}</td>
                <td className="num mono">{s.kills ? Math.round((100 * s.headshots) / s.kills) : 0}</td>
                <td className="num mono">{s.firstKills} <span className="sub">({s.firstDeaths})</span></td>
                <td className="num mono">{s.multiKills[2]}/{s.multiKills[3]}/{s.multiKills[4]}/{s.multiKills[5]}</td>
                <td className="num" title={s.clutches.map((c) => `round ${c.round}: 1 vs ${c.vs}`).join('\n')}>{s.clutches.length ? s.clutches.map((c) => `1v${c.vs}`).join(' ') : '—'}</td>
                <td className="talkcell" title={`Shots fired: ${Object.entries(s.shots).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ') || 'none recorded'}`}>{Object.entries(s.weapons).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, n]) => `${w} ${n}`).join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <span className="note">Counted from the kill feed in the demo. Accuracy and damage aren't stored in demos from this game version, so they aren't shown. Shots fired per player are in the tooltip of each weapon list.</span>
    </section>
  );
}
