// Phase 5 tab of the details page: highlights (5.o) — the HLTV director's picks, multi-kills, clutches and knife
// kills, each opening the Radar replay just before it. Jumping the game itself there waits for the dem_jump test.
import { useState } from 'react';
import type { DemoDetails, Highlight } from '../../shared/api.js';
import { formatLength } from '../format.js';

const KINDS: { id: Highlight['kind']; label: string }[] = [
  { id: 'director', label: "HLTV director's picks" },
  { id: 'multikill', label: 'Multi-kills' },
  { id: 'clutch', label: 'Clutches' },
  { id: 'knife', label: 'Knife kills' },
];

export function HighlightsTab({ d, onWatch }: { d: DemoDetails; onWatch: (h: Highlight) => void }) {
  const counts = new Map<string, number>();
  for (const h of d.highlights) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1);
  const [on, setOn] = useState<Set<string>>(new Set(KINDS.map((k) => k.id)));
  const shown = d.highlights.filter((h) => on.has(h.kind));
  const live = (round: number) => { const r = d.periods.find((p) => p.round === round); return r?.freezeEnd ?? r?.start ?? 0; };
  return (
    <section className="card" aria-labelledby="hl-h" data-testid="details-highlights">
      <h2 id="hl-h">Highlights</h2>
      <div className="chip-row" role="group" aria-label="Show">
        {KINDS.map((k) => (
          <button key={k.id} type="button" className="filter-chip" aria-pressed={on.has(k.id)} disabled={!counts.get(k.id)}
            onClick={() => setOn((s) => { const n = new Set(s); if (n.has(k.id)) n.delete(k.id); else n.add(k.id); return n; })}>
            {k.label} <span className="count">{counts.get(k.id) ?? 0}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? <p className="note">{d.highlights.length ? 'Nothing matches.' : 'No highlights found in this demo.'}</p> : (
        <ol className="highlight-list">
          {shown.map((h, i) => (
            <li key={i} data-testid="highlight">
              <span className={`round-badge ${h.team === 'T' ? 't' : h.team === 'CT' ? 'ct' : 'draw'}`}>{h.round}</span>
              <span className="hl-main">
                <span className="hl-title">{h.title}</span>
                <span className="note">round {h.round} · {formatLength(Math.max(0, h.time - live(h.round)))} into the round · {formatLength(h.time)} in the demo{h.kind === 'director' ? ` · priority ${h.priority}` : ''}</span>
              </span>
              <button type="button" className="btn small" onClick={() => onWatch(h)}>Watch on the radar</button>
            </li>
          ))}
        </ol>
      )}
      <span className="note">
        The HLTV director's picks are the moments it chose to show (priority 7 or more of 15); it moves the camera there a few seconds before the action. Watch on the radar opens the Radar replay 3 s before.
        {' '}Jumping the game itself to a highlight comes after a test in your game.
      </span>
    </section>
  );
}
