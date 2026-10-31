// 5.r on the details page: the other recordings of the same match found in the library — the same rounds recorded by
// someone else (POV) or by HLTV, whose positions are added to the radar replay and heatmaps, and the other half of the
// match, which completes the score.
import type { CombinedData } from '../../shared/api.js';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const thousands = (n: number) => n.toLocaleString('en-US');

export function CombinedCard({ c, onOpen }: { c?: CombinedData | { error: string }; onOpen: (key: string) => void }) {
  return (
    <section className="card" aria-labelledby="combined-h" data-testid="details-combined">
      <h2 id="combined-h">Other recordings of this match</h2>
      {!c && <p className="note" role="status">Looking in the library for other recordings of this match… (a few seconds)</p>}
      {c && 'error' in c && <p className="problem">{c.error}</p>}
      {c && !('error' in c) && c.recordings.length === 0 && (
        <p className="note">None found in the library. Recordings of the same match (other players' demos or an HLTV demo) are combined automatically when you add them.</p>
      )}
      {c && !('error' in c) && c.recordings.length > 0 && (
        <>
          {c.fullMatch && (
            <p data-testid="combined-full">
              <strong>Whole match ({c.fullMatch.rounds} rounds, both halves):</strong>{' '}
              {c.fullMatch.teams.map((t) => `${t.tag} ${t.rounds}`).join(' : ')}
              <span className="note"> · {c.fullMatch.teams.map((t) => `${t.tag} ${t.halves[0]} + ${t.halves[1]}`).join(' · ')} (this half + the other half)</span>
            </p>
          )}
          <ul className="combined-list">
            {c.recordings.map((r) => (
              <li key={r.key} data-testid="combined-recording">
                <div>
                  <button type="button" className="link-btn" onClick={() => onOpen(r.key)}>{r.name}</button>
                  <span className="tag">{r.recording}</span>
                  <span className="tag">{r.relation === 'same-half' ? 'same rounds' : 'other half'}</span>
                </div>
                {r.error && <span className="problem">{r.error}</span>}
                {r.relation === 'same-half' && !r.error && (
                  <span className="note">
                    {r.killsLinedUp} of {r.kills} kills line up (largest gap {r.maxGap?.toFixed(2)} s; its clock is {Math.abs(r.offset ?? 0).toFixed(1)} s {(r.offset ?? 0) >= 0 ? 'behind' : 'ahead'}) · {r.rounds} rounds in common
                    {r.added && ` · adds ${thousands(r.added.seen + r.added.radar + r.added.heard)} positions and ${r.added.grenades} grenades`}
                    {r.added?.newPlayers.length ? ` · first positions for ${r.added.newPlayers.join(', ')}` : ''}
                  </span>
                )}
                {r.relation === 'other-half' && r.score && (
                  <span className="note">{r.score.map((s) => `${s.tag} ${s.rounds} (${s.side})`).join(' : ')}</span>
                )}
              </li>
            ))}
          </ul>
          {c.coverage && (
            <p data-testid="combined-coverage">
              Positions known while players were alive: <strong>{pct(c.coverage.before)}</strong> in this recording alone → <strong>{pct(c.coverage.after)}</strong> combined.
              <span className="note"> The Radar replay and Heatmaps use the combined positions (you can switch it off there).</span>
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** A switch for the Radar replay and Heatmaps tabs: use the other recordings' positions too. */
export function CombineSwitch({ c, on, onChange }: { c?: CombinedData | { error: string }; on: boolean; onChange: (on: boolean) => void }) {
  const n = c && !('error' in c) ? c.recordings.filter((r) => r.relation === 'same-half' && !r.error).length : 0;
  if (!n) return null;
  return (
    <button type="button" className="filter-chip" aria-pressed={on} onClick={() => onChange(!on)} data-testid="combine-switch"
      title="Add the positions from the other recordings of the same rounds (another player's demo or HLTV)">
      Combined with {n} other recording{n > 1 ? 's' : ''}
    </button>
  );
}
