// Phase 5 tabs of the details page: chat and radio log (5.l) and voice timeline (5.m).
// Jumping to a moment in the game waits for the dem_jump test in game (plan 5.c/5.i), so a click only selects for now.
import React, { useMemo, useState } from 'react';
import type { ChatChannel, DemoDetails, LogEntry, Period } from '../../shared/api.js';
import { formatLength } from '../format.js';

const CHANNEL_TAG: Record<ChatChannel, string> = {
  all: '', team: 'team', dead: 'dead', 'dead-team': 'dead · team', spectator: 'spectator', hltv: 'HLTV viewer', server: 'server',
};
const sideClass = (t?: 'T' | 'CT') => (t === 'T' ? 't' : t === 'CT' ? 'ct' : '');
const winnerText = (p: Period, tagT: string, tagCT: string) =>
  p.winner === 'T' ? `${tagT} won` : p.winner === 'CT' ? `${tagCT} won` : p.winner === 'draw' ? 'draw' : '';

type Filter = 'everyone' | 'team' | 'dead' | 'watchers' | 'server' | 'radio' | 'auto';
const FILTERS: { id: Filter; label: string; title: string }[] = [
  { id: 'everyone', label: 'Chat to everyone', title: 'say' },
  { id: 'team', label: 'Team chat', title: 'say_team' },
  { id: 'dead', label: 'Dead players', title: 'Messages from dead players (only other dead players saw them)' },
  { id: 'watchers', label: 'Spectators and HLTV', title: 'Spectators on the server and people watching through HLTV' },
  { id: 'server', label: 'Server', title: "The server's own messages" },
  { id: 'radio', label: 'Radio calls', title: 'Calls chosen from the radio menu' },
  { id: 'auto', label: 'Automatic radio', title: '"Fire in the hole!" (grenades), the round-start call, and the game\'s announcements (bomb planted, team wins)' },
];
const filterOf = (e: LogEntry): Filter => {
  if (e.kind === 'radio') return e.radio === 'player' ? 'radio' : 'auto';
  switch (e.channel) {
    case 'team': return 'team';
    case 'dead': case 'dead-team': return 'dead';
    case 'spectator': case 'hltv': return 'watchers';
    case 'server': return 'server';
    default: return 'everyone';
  }
};

/** 5.l: every chat message and radio call, by round, with filters; radio calls per player. */
export function ChatTab({ d, tagT, tagCT }: { d: DemoDetails; tagT: string; tagCT: string }) {
  const [on, setOn] = useState<Set<Filter>>(() => new Set(FILTERS.map((f) => f.id).filter((f) => f !== 'auto')));
  const [player, setPlayer] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<LogEntry | undefined>();
  const counts = useMemo(() => {
    const c = new Map<Filter, number>();
    for (const e of d.log) c.set(filterOf(e), (c.get(filterOf(e)) ?? 0) + 1);
    return c;
  }, [d.log]);
  const names = useMemo(() => [...new Set(d.log.map((e) => e.who).filter((w): w is string => !!w))].sort((a, b) => a.localeCompare(b)), [d.log]);
  const q = search.trim().toLowerCase();
  const shown = d.log.filter((e) => on.has(filterOf(e)) && (!player || e.who === player) && (!q || e.text.toLowerCase().includes(q) || e.who?.toLowerCase().includes(q)));
  const byPeriod = d.periods.map((p) => ({ p, entries: shown.filter((e) => e.period === p.id) })).filter((g) => g.entries.length > 0);
  const toggle = (f: Filter) => setOn((s) => { const n = new Set(s); if (n.has(f)) n.delete(f); else n.add(f); return n; });
  const periodOf = (e: LogEntry) => d.periods.find((p) => p.id === e.period);

  return (
    <div className="log-layout">
      <section className="card log-card" aria-labelledby="log-h" data-testid="details-log">
        <h2 id="log-h">Chat and radio</h2>
        <div className="chip-row" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="filter-chip" aria-pressed={on.has(f.id)} title={f.title} onClick={() => toggle(f.id)} disabled={!counts.get(f.id)}>
              {f.label} <span className="count">{counts.get(f.id) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="log-tools">
          <select className="select" value={player} onChange={(e) => setPlayer(e.target.value)} aria-label="Player">
            <option value="">All players</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input type="search" className="search" placeholder="Search messages" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search messages" />
          <span className="note" role="status" data-testid="log-count">{shown.length} of {d.log.length} shown</span>
        </div>
        {picked && (
          <p className="picked" role="status" data-testid="log-picked">
            <strong className="mono">{formatLength(picked.time)}</strong> in the demo{(() => { const p = periodOf(picked); return p?.round !== undefined && p.freezeEnd !== undefined ? ` · round ${p.round}, ${picked.time < p.freezeEnd ? 'freeze time' : `${formatLength(picked.time - p.freezeEnd)} after freeze time`}` : p ? ` · ${p.label.toLowerCase()}` : ''; })()}.
            {' '}Jumping there in the game comes after a test in your game; for now use the demo panel's timeline.
          </p>
        )}
        {byPeriod.length === 0 && <p className="note">{d.log.length === 0 ? 'No chat or radio in this demo.' : 'Nothing matches.'}</p>}
        <div className="log">
          {byPeriod.map(({ p, entries }) => (
            <section key={p.id} aria-label={p.label}>
              <h3 className="log-period">
                {p.round !== undefined && <span className={`round-badge ${sideClass(p.winner === 'draw' ? undefined : p.winner)}`}>{p.round}</span>}
                <span>{p.round !== undefined ? `Round ${p.round}` : p.label}</span>
                <span className="note">{winnerText(p, tagT, tagCT)}</span>
              </h3>
              <ul className="log-list">
                {entries.map((e, n) => (
                  <li key={n} className={`${e.kind === 'radio' ? 'radio' : ''}${picked === e ? ' picked-row' : ''}`} data-testid="log-row">
                    <button type="button" className="log-time mono" onClick={() => setPicked(e)} title="Select this moment">{formatLength(e.time)}</button>
                    <span className="log-body">
                      {e.kind === 'radio' && <span className="log-tag radio-tag">radio</span>}
                      {e.kind === 'chat' && e.channel && CHANNEL_TAG[e.channel] && <span className={`log-tag ch-${e.channel}`}>{CHANNEL_TAG[e.channel]}</span>}
                      {(e.who || e.channel === 'server' || e.radio === 'game') && <span className={`who ${sideClass(e.team)}`}>{e.who ?? (e.kind === 'radio' ? 'Game' : 'Server')}</span>}
                      <span className="log-text">{e.text}{e.radio === 'grenade' ? <span className="note"> (grenade)</span> : e.radio === 'round-start' ? <span className="note"> (round start)</span> : null}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section className="card" aria-labelledby="radio-h" data-testid="details-radio">
        <h2 id="radio-h">Radio calls per player</h2>
        {d.radioByPlayer.length === 0 ? <p className="note">No radio calls from players in this demo.</p> : (
          <div style={{ overflowX: 'auto' }}>
          <table className="team-table radio-table">
            <thead>
              <tr><th scope="col">Player</th><th scope="col" className="num">Calls</th><th scope="col" className="num" title='"Fire in the hole!" — one per grenade thrown'>Grenades</th><th scope="col">Most used</th></tr>
            </thead>
            <tbody>
              {d.radioByPlayer.map((r) => (
                <tr key={r.name} data-testid="radio-row">
                  <td className="pname"><span className={`side ${sideClass(r.team)}`}>{r.name}</span></td>
                  <td className="num mono">{r.calls}</td>
                  <td className="num mono">{r.grenades}</td>
                  <td className="most-used">{r.top.length ? r.top.map((t, n) => <span key={t.text}>{t.text} ×{t.count}{n < r.top.length - 1 ? ', ' : ''}</span>).reduce<React.ReactNode[]>((a, x) => [...a, x, ' '], []) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <span className="note">Calls chosen from the radio menu. The round-start call ("Lock and load." and the like) is played by the game for a random teammate, so it isn't counted.{d.periods.some((p) => p.id === 'warmup') ? ' Warm-up is included.' : ''}</span>
      </section>
    </div>
  );
}

/** 5.m: who talked when — one row per player, for the whole demo or one round. */
export function VoiceTab({ d, tagT, tagCT, recording }: { d: DemoDetails; tagT: string; tagCT: string; recording?: string }) {
  const [view, setView] = useState('all');
  const [picked, setPicked] = useState<{ name: string; start: number; end: number } | undefined>();
  const period = d.periods.find((p) => p.id === view);
  const from = period?.start ?? 0;
  const to = period?.end ?? d.seconds;
  const span = Math.max(1, to - from);
  const pct = (t: number) => `${((Math.min(Math.max(t, from), to) - from) / span) * 100}%`;
  const rows = d.voice.map((r) => {
    const bursts = r.bursts.filter(([s, e]) => e > from && s < to);
    return { ...r, bursts, inView: bursts.reduce((a, [s, e]) => a + Math.min(e, to) - Math.max(s, from), 0) };
  });
  // Axis: round starts for the whole demo; every 15 s for one part.
  const marks: { at: number; label: string; strong?: boolean }[] = period
    ? Array.from({ length: Math.floor(span / 15) + 1 }, (_, n) => ({ at: from + n * 15, label: formatLength(n * 15) }))
    : d.periods.filter((p) => p.round !== undefined).map((p) => ({ at: p.start, label: String(p.round), strong: true }));
  const periodOf = (t: number) => d.periods.find((p) => t >= p.start && t < p.end);
  const where = (t: number) => {
    const p = periodOf(t);
    if (!p) return '';
    if (p.round === undefined || p.freezeEnd === undefined) return p.label.toLowerCase();
    return `round ${p.round}, ${t < p.freezeEnd ? 'freeze time' : `${formatLength(t - p.freezeEnd)} after freeze time`}`;
  };
  const len = (s: number) => (s >= 90 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`);

  return (
    <section className="card" aria-labelledby="voice-h" data-testid="details-voice">
      <h2 id="voice-h">Voice timeline</h2>
      {d.voice.length === 0 ? <p className="note">Nobody is heard in this demo.</p> : (
        <>
          <div className="chip-row" role="group" aria-label="Part of the demo">
            {[{ id: 'all', label: 'Whole demo' }, ...d.periods.map((p) => ({ id: p.id, label: p.round !== undefined ? String(p.round) : p.label }))].map((c) => (
              <button key={c.id} type="button" className="filter-chip" aria-pressed={view === c.id} onClick={() => { setView(c.id); setPicked(undefined); }}
                title={c.id.startsWith('r') ? `Round ${c.label}` : undefined}>{c.id.startsWith('r') ? `R${c.label}` : c.label}</button>
            ))}
          </div>
          {period && (
            <p className="note">
              {period.label}{period.round !== undefined && period.winner ? ` · ${winnerText(period, tagT, tagCT)}` : ''} · {formatLength(period.start)}–{formatLength(period.end)} in the demo
              {period.freezeEnd !== undefined ? ' · shaded = freeze time, line = round over' : ''}
            </p>
          )}
          <div className="vt" role="img" aria-label={`Voice timeline, ${period ? period.label : 'whole demo'}: ${rows.map((r) => `${r.name} ${r.bursts.length} bursts`).join(', ')}`}>
            <div className="vt-row vt-axis" aria-hidden="true">
              <span className="vt-name" />
              <div className="vt-track">
                {marks.map((m) => <span key={m.at} className={`vt-mark${m.strong ? ' strong' : ''}`} style={{ left: pct(m.at) }}>{m.label}</span>)}
              </div>
            </div>
            {rows.map((r) => (
              <div key={r.name} className="vt-row" data-testid="voice-row">
                <span className="vt-name" title={r.name}>
                  <span className={`side ${sideClass(r.team)}`}>{r.name}</span>
                  <span className="note">{r.bursts.length ? len(r.inView) : '—'}</span>
                </span>
                <div className="vt-track">
                  {period?.freezeEnd !== undefined && <span className="vt-freeze" style={{ left: 0, width: pct(period.freezeEnd) }} />}
                  {period?.roundEnd !== undefined && <span className="vt-end" style={{ left: pct(period.roundEnd) }} />}
                  {!period && marks.map((m) => <span key={m.at} className="vt-grid" style={{ left: pct(m.at) }} />)}
                  {r.bursts.map(([s, e]) => (
                    <span key={s} className={`vt-burst ${sideClass(r.team)}${picked?.name === r.name && picked.start === s ? ' sel' : ''}`}
                      style={{ left: pct(s), width: `max(3px, calc(${pct(e)} - ${pct(s)}))` }}
                      title={`${r.name}: ${formatLength(s)}–${formatLength(e)} (${(e - s).toFixed(1)} s) · ${where(s)}`}
                      onClick={() => setPicked({ name: r.name, start: s, end: e })} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {picked && (
            <p className="picked" role="status" data-testid="voice-picked">
              <strong>{picked.name}</strong> talks at <strong className="mono">{formatLength(picked.start)}</strong> in the demo for {(picked.end - picked.start).toFixed(1)} s ({where(picked.start)}).
              {' '}Jumping there in the game comes after a test in your game; for now use the demo panel's timeline.
            </p>
          )}
          <span className="note">
            Each bar is one time someone talked; hover for the time, click to select it. Times add up the bursts, so they can be a few seconds lower than the Overview's measured figure.
            {recording === 'POV' ? " A player's demo only holds his own team's voice, and not his own." : ''}
          </span>
        </>
      )}
    </section>
  );
}
