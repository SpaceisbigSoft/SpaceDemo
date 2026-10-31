// Players page (plan 5.p): totals per player over every demo in the library, with the owner's name merges and
// suggestions for players who renamed. Recordings of the same match half are counted once.
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { PlayerTotals, PlayersView } from '../../shared/api.js';

type SortKey = 'kills' | 'kd' | 'hs' | 'kpr' | 'demos' | 'fk' | 'multi' | 'clutch';

export function PlayersPage() {
  const [view, setView] = useState<PlayersView | undefined>();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('kills');
  const [open, setOpen] = useState<string | undefined>();

  useEffect(() => {
    void window.spacedemo.getPlayers().then(setView);
    return window.spacedemo.onPlayersChanged(setView);
  }, []);

  const rows = useMemo(() => {
    if (!view) return [];
    const val = (p: PlayerTotals): number => {
      switch (sort) {
        case 'kills': return p.kills;
        case 'kd': return p.kills / Math.max(1, p.deaths);
        case 'hs': return p.kills ? p.headshots / p.kills : 0;
        case 'kpr': return p.kills / Math.max(1, p.rounds);
        case 'demos': return p.demos;
        case 'fk': return p.firstKills;
        case 'multi': return p.multi3;
        case 'clutch': return p.clutches;
      }
    };
    const s = q.trim().toLowerCase();
    return view.players.filter((p) => !s || p.name.toLowerCase().includes(s) || p.aliases.some((a) => a.toLowerCase().includes(s)) || p.tags.some((t) => t.toLowerCase() === s))
      .sort((a, b) => val(b) - val(a));
  }, [view, q, sort]);

  if (!view) return <p className="note" role="status">Reading players…</p>;
  const counted = view.demos.filter((d) => !d.countedAs).length;
  const twins = view.demos.filter((d) => d.countedAs);
  const th = (k: SortKey, label: string, title?: string) => (
    <th scope="col" className="num" aria-sort={sort === k ? 'descending' : undefined}>
      <button type="button" className="th-sort" onClick={() => setSort(k)} title={title}>{label}<span aria-hidden="true" className="sort-mark">{sort === k ? '▼' : ''}</span></button>
    </th>
  );
  const act = (p: Promise<PlayersView>) => void p.then(setView);

  return (
    <div className="players-page" data-testid="players-page">
      <header className="page-header">
        <div>
          <h1>Players</h1>
          <span className="note" data-testid="players-summary">
            {view.players.length} players in {counted} recording{counted === 1 ? '' : 's'}
            {twins.length ? ` · ${twins.length} more recording${twins.length === 1 ? '' : 's'} of the same match halves counted once` : ''}
          </span>
        </div>
        <input type="search" className="search" placeholder="Search players or clan tags" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" style={{ maxWidth: 360 }} />
      </header>
      {view.progress && (
        <div className="progress" role="status" data-testid="players-progress">
          <span>Reading players {view.progress.done} of {view.progress.total}…</span>
          <progress max={view.progress.total} value={view.progress.done} />
        </div>
      )}

      {view.suggestions.length > 0 && (
        <section className="card" aria-labelledby="sugg-h" data-testid="players-suggestions">
          <h2 id="sugg-h">Same player? · {view.suggestions.length}</h2>
          <ul className="sugg-list">
            {view.suggestions.map((s) => (
              <li key={`${s.a}|${s.b}`} data-testid="suggestion">
                <div className="sugg-names"><strong>{s.a}</strong> <span className="note">and</span> <strong>{s.b}</strong>
                  <span className={`tag ${s.score >= 100 ? 'sure' : ''}`}>{s.score >= 100 ? 'very likely' : 'possible'}</span></div>
                <span className="note">{s.reasons.join(' · ')}</span>
                <div className="sugg-actions">
                  <button type="button" className="btn small" onClick={() => act(window.spacedemo.mergePlayers(s.b, s.a))}>Same · keep “{s.a}”</button>
                  <button type="button" className="btn small" onClick={() => act(window.spacedemo.mergePlayers(s.a, s.b))}>Same · keep “{s.b}”</button>
                  <button type="button" className="btn small" onClick={() => act(window.spacedemo.rejectPlayerSuggestion(s.a, s.b))}>Different players</button>
                </div>
              </li>
            ))}
          </ul>
          <span className="note">Worked out from the settings each player's game sent (colours, rates, private setinfo keys — compared, never shown) and clan tags. Two names in the same match at the same time are never suggested.</span>
        </section>
      )}

      <div className="table-wrap">
        <table className="team-table scoreboard players-table" data-testid="players-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              {th('demos', 'Demos')}
              <th scope="col" className="num">Rounds</th>
              {th('kills', 'K')}
              <th scope="col" className="num">D</th>
              {th('kd', 'K/D')}{th('hs', 'HS %')}{th('kpr', 'K/round', 'Kills per round played')}
              {th('fk', 'First kills')}{th('multi', '3K+', 'Rounds with 3 or more kills')}{th('clutch', 'Clutches')}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <Fragment key={p.name}>
                <tr data-testid="player-row" className={open === p.name ? 'picked-row' : ''}>
                  <td className="pname">
                    <button type="button" className="link-btn" onClick={() => setOpen(open === p.name ? undefined : p.name)} aria-expanded={open === p.name}>{p.name}</button>
                    {p.tags.length > 0 && <span className="sub"> [{p.tags.join(', ')}]</span>}
                    {p.aliases.length > 0 && <span className="sub"> · also {p.aliases.join(', ')}</span>}
                  </td>
                  <td className="num mono">{p.demos}</td>
                  <td className="num mono">{p.rounds}</td>
                  <td className="num mono">{p.kills}</td>
                  <td className="num mono">{p.deaths}</td>
                  <td className="num mono">{(p.kills / Math.max(1, p.deaths)).toFixed(2)}</td>
                  <td className="num mono">{p.kills ? Math.round((100 * p.headshots) / p.kills) : 0}</td>
                  <td className="num mono">{(p.kills / Math.max(1, p.rounds)).toFixed(2)}</td>
                  <td className="num mono">{p.firstKills}</td>
                  <td className="num mono">{p.multi3}</td>
                  <td className="num mono">{p.clutches}</td>
                </tr>
                {open === p.name && (
                  <tr className="player-more">
                    <td colSpan={11}>
                      <div className="player-more-body">
                        <span className="note">In: {p.demoKeys.map((k) => view.demos.find((d) => d.key === k)?.name ?? k).join(', ')}</span>
                        {p.aliases.map((a) => (
                          <span key={a}>“{a}” is counted as {p.name} <button type="button" className="link-btn" onClick={() => act(window.spacedemo.unmergePlayer(a))}>Undo</button></span>
                        ))}
                        <label className="merge-into">Same player as
                          <select className="select" defaultValue="" onChange={(e) => { if (e.target.value) act(window.spacedemo.mergePlayers(p.name, e.target.value)); }} aria-label={`Merge ${p.name} into`}>
                            <option value="">choose…</option>
                            {view.players.filter((x) => x.name !== p.name).map((x) => <option key={x.name} value={x.name}>{x.name}</option>)}
                          </select>
                        </label>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <span className="note">Counted from each demo's kill feed (as on the Scoreboard tab). Rounds = rounds in the demos he played in. Merges are kept in SpaceDemo's settings; demos are only read.</span>
    </div>
  );
}
