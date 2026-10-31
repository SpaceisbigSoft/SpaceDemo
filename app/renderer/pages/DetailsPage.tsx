// Demo details (plan 4.4, mockup screen 2): score and rounds, players, map with bomb sites, who talked, chat, health.
// Everything comes from reading the demo; nothing is changed. Watch (4.5) and Fix (4.6) come next.
import { useEffect, useState } from 'react';
import type { CombinedData, DemoDetails, LibraryDemo, PlayerRow, TeamDetails } from '../../shared/api.js';
import { CombinedCard } from './DetailsCombined.js';
import { formatDate, formatLength, formatVersion, formatVoice, STATUS_TEXT } from '../format.js';
import { HeatmapTab } from './DetailsHeatmap.js';
import { ReplayTab } from './DetailsReplay.js';
import { SightingsTab } from './DetailsSightings.js';
import { RecorderTab } from './DetailsRecorder.js';
import { HighlightsTab } from './DetailsHighlights.js';
import { ChatTab, VoiceTab } from './DetailsLog.js';
import { RoundsTab, ScoreboardTab, ServerCard } from './DetailsTabs.js';

const TEAM_NAME = { T: 'Terrorists', CT: 'Counter-Terrorists' } as const;
const REASON_TEXT: Record<string, string> = { K: 'team killed', B: 'bomb exploded', D: 'bomb defused', T: 'time ran out', '=': 'draw', O: 'other' };

export function DetailsPage({ demo, onBack, onWatch, onOpen }: { demo?: LibraryDemo; onBack: () => void; onWatch: (key: string) => void; onOpen?: (key: string) => void }) {
  const [details, setDetails] = useState<DemoDetails | { error: string } | undefined>();
  const [allChat, setAllChat] = useState(false);
  const [tab, setTab] = useState<'overview' | 'rounds' | 'scoreboard' | 'chat' | 'voice' | 'heatmap' | 'replay' | 'sightings' | 'recorder' | 'highlights'>('overview');
  // A highlight to open in the Radar replay (round, time); a new object each time so the replay starts fresh.
  const [replayStart, setReplayStart] = useState<{ round: number; time: number } | undefined>();
  // 5.r other recordings of the same match (read after the details), and whether the replay/heatmaps use them.
  const [combined, setCombined] = useState<CombinedData | { error: string } | undefined>();
  const [useCombined, setUseCombined] = useState(true);

  useEffect(() => {
    setDetails(undefined);
    setAllChat(false);
    setTab('overview');
    setReplayStart(undefined);
    setCombined(undefined);
    setUseCombined(true);
    let live = true;
    if (demo) {
      const key = demo.key;
      void window.spacedemo.getDemoDetails(key).then((x) => {
        if (!live) return;
        setDetails(x);
        if (!('error' in x)) void window.spacedemo.getCombined(key).then((c) => { if (live) setCombined(c); });
      });
    }
    return () => { live = false; };
  }, [demo?.key]);
  const comb = combined && !('error' in combined) ? combined : undefined;

  if (!demo) {
    return (
      <>
        <BackLink onBack={onBack} />
        <p className="note">This demo isn't in the library any more.</p>
      </>
    );
  }
  const i = demo.info;
  const d = details && !('error' in details) ? details : undefined;
  const tag = (t: 'T' | 'CT') => d?.teams[t].tag ?? TEAM_NAME[t];

  return (
    <div className="details" data-testid="details">
      <BackLink onBack={onBack} />
      <header className="page-header" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <h1>{demo.name}</h1>
          <span style={{ color: 'var(--text-2)' }}>
            {d && <>{tag('T')} vs {tag('CT')} · </>}
            {i && <span className="mono">{i.map}</span>} · {formatDate(demo.date)}{i?.hostName ? ` · ${i.hostName}` : ''}
          </span>
          {i && (
            <div className="chip-row">
              <span className="tag">{i.recording}{i.recorder ? ` · recorded by ${i.recorder}` : ''}</span>
              <span className="tag mono">{formatLength(i.seconds)}</span>
              <span className="tag">{formatVersion(i.networkProtocol)}</span>
              <span className={`status status-${demo.status}`}>{STATUS_TEXT[demo.status]}</span>
              {i.talkBursts > 0 && <span className="tag">Voice · {formatVoice(demo)}</span>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <button type="button" className="btn" onClick={() => void window.spacedemo.showInFolder(demo.file)}>Show file</button>
          <button type="button" className="btn primary" onClick={() => onWatch(demo.key)} data-testid="details-watch">
            {demo.status === 'needs-fix' || demo.status === 'damaged' ? 'Fix & watch' : 'Watch in CS 1.6'}
          </button>
        </div>
      </header>

      {!details && <p className="note" role="status" data-testid="details-loading">Reading the match… (a few seconds)</p>}
      {details && 'error' in details && <p className="problem" role="alert">{details.error}</p>}

      {d && (
        <div role="tablist" aria-label="Details" className="tabs">
          {([['overview', 'Overview'], ['rounds', `Rounds (${d.roundDetails.length})`], ['scoreboard', 'Scoreboard'], ['chat', `Chat & radio (${d.log.length})`], ['voice', 'Voice'], ['heatmap', 'Heatmaps'], ['replay', 'Radar replay'], ['sightings', 'Sightings'], ['recorder', 'Recorder'], ['highlights', `Highlights (${d.highlights.length})`]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} aria-controls={`panel-${id}`} className="tab" onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      )}
      {d && tab === 'rounds' && <div role="tabpanel" id="panel-rounds" aria-labelledby="tab-rounds"><RoundsTab d={d} tagT={tag('T')} tagCT={tag('CT')} /></div>}
      {d && tab === 'chat' && <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat"><ChatTab d={d} tagT={tag('T')} tagCT={tag('CT')} /></div>}
      {d && tab === 'voice' && <div role="tabpanel" id="panel-voice" aria-labelledby="tab-voice"><VoiceTab d={d} tagT={tag('T')} tagCT={tag('CT')} recording={i?.recording} /></div>}
      {d && tab === 'highlights' && <div role="tabpanel" id="panel-highlights" aria-labelledby="tab-highlights"><HighlightsTab d={d} onWatch={(h) => { setReplayStart({ round: h.round, time: h.time - 3 }); setTab('replay'); }} /></div>}
      {d && tab === 'recorder' && <div role="tabpanel" id="panel-recorder" aria-labelledby="tab-recorder"><RecorderTab d={d} /></div>}
      {d && tab === 'sightings' && <div role="tabpanel" id="panel-sightings" aria-labelledby="tab-sightings"><SightingsTab d={d} tagT={tag('T')} tagCT={tag('CT')} /></div>}
      {d && tab === 'replay' && <div role="tabpanel" id="panel-replay" aria-labelledby="tab-replay"><ReplayTab key={replayStart ? `${replayStart.round}-${replayStart.time}` : 'replay'} d={d} tagT={tag('T')} tagCT={tag('CT')} start={replayStart} combined={combined} useCombined={useCombined} onUseCombined={setUseCombined} /></div>}
      {d && tab === 'heatmap' && <div role="tabpanel" id="panel-heatmap" aria-labelledby="tab-heatmap"><HeatmapTab d={d} tagT={tag('T')} tagCT={tag('CT')} combined={combined} useCombined={useCombined} onUseCombined={setUseCombined} /></div>}
      {d && tab === 'scoreboard' && <div role="tabpanel" id="panel-scoreboard" aria-labelledby="tab-scoreboard"><ScoreboardTab d={d} /></div>}
      {d && tab === 'overview' && (
        <div className="details-grid" role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
          <div className="col-main">
            <section className="card" aria-labelledby="score-h" data-testid="details-score">
              <h2 id="score-h">Score{i?.recording === 'POV' ? ' · this recording' : ''}</h2>
              {d.score ? (
                <div className="scoreline">
                  <div className="team-label"><span className="team-name">{tag('T')}</span><span className="side t">Terrorists</span></div>
                  <span className="score mono">{d.score.T} : {d.score.CT}</span>
                  <div className="team-label"><span className="team-name">{tag('CT')}</span><span className="side ct">Counter-Terrorists</span></div>
                  <span className="note score-check">
                    {d.score.source === 'server' ? (d.score.matchesRounds ? "Matches the server's own score ✓" : "Server's score (the rounds counted here differ)") : 'Counted from the rounds'}
                  </span>
                </div>
              ) : <p className="note">No completed rounds in this recording.</p>}
              {d.rounds.length > 0 && (
                <>
                  <ol className="rounds" aria-label="Rounds">
                    {d.rounds.map((r) => (
                      <li key={r.number} className={`round ${r.winner === 'T' ? 't' : r.winner === 'CT' ? 'ct' : 'draw'}`}
                        title={`Round ${r.number}: ${r.winner === 'draw' ? 'draw' : `${r.winner ? tag(r.winner) : '?'} won`}${r.reason ? `, ${REASON_TEXT[r.reason]}` : ''}`}>
                        <span className="n">{r.number}</span>
                        <span className="w">{r.winner === 'draw' ? '=' : r.winner ?? '?'}</span>
                        <span className="r">{r.reason ?? ''}</span>
                      </li>
                    ))}
                  </ol>
                  <span className="note">D = bomb defused · K = team killed · B = bomb exploded · T = time ran out</span>
                </>
              )}
              {comb?.fullMatch && (
                <span className="note" data-testid="score-full">Whole match with the other half: {comb.fullMatch.teams.map((t) => `${t.tag} ${t.rounds}`).join(' : ')}</span>
              )}
              {d.restarts > 0 && <span className="note">Warm-up before the last restart ({d.restarts} restart{d.restarts > 1 ? 's' : ''}) isn't counted.</span>}
            </section>

            <section className="card" aria-labelledby="players-h" data-testid="details-players">
              <h2 id="players-h">Players</h2>
              <div style={{ overflowX: 'auto' }}>
                <TeamTable side="T" team={d.teams.T} label={tag('T')} recording={i?.recording} />
                <TeamTable side="CT" team={d.teams.CT} label={tag('CT')} recording={i?.recording} />
              </div>
              {i?.recording === 'POV' && <span className="note">A player's demo only holds the voice of his own team. The recorder's own voice isn't in it.</span>}
            </section>
            <CombinedCard c={combined} onOpen={(k) => onOpen?.(k)} />
            <ServerCard d={d} />
          </div>

          <div className="col-side">
            <section className="card" aria-labelledby="map-h" data-testid="details-map">
              <h2 id="map-h">Map</h2>
              {d.map.image ? (
                <div className="overview">
                  <img src={d.map.image} alt={`Overview of ${i?.map}`} width={1024} height={768} />
                  <svg viewBox="0 0 1024 768" aria-hidden="true">
                    {d.map.sites.map((s) => (
                      <g key={s.letter + s.x}>
                        <circle cx={s.x} cy={s.y} r={34} className="site-dot" />
                        <text x={s.x} y={s.y + 14} textAnchor="middle" className="site-letter">{s.letter}</text>
                      </g>
                    ))}
                  </svg>
                </div>
              ) : <p className="note">{d.map.note}</p>}
              <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
                <span className="mono">{i?.map}</span>{demo.map ? ` · ${demo.map.note}` : ''}
                {d.map.sites.length > 0 && ` · bomb sites ${d.map.sites.map((s) => s.letter).join(' and ')}`}
              </span>
            </section>

            <section className="card" aria-labelledby="talk-h" data-testid="details-talk">
              <h2 id="talk-h">Who talked</h2>
              {d.talk.length === 0 ? <p className="note">Nobody is heard in this demo.</p> : d.talk.map((t) => (
                <div key={t.name} className="talk">
                  <div className="talk-head"><span>{t.name}</span><span className="note">{(t.seconds / 60).toFixed(1)} min</span></div>
                  <div className="bar"><div style={{ width: `${Math.max(2, Math.round((t.seconds / d.talk[0].seconds) * 100))}%` }} /></div>
                </div>
              ))}
              {d.talkBursts > 0 && <span className="note">{d.talkBursts} talk bursts{i?.voiceCodec === 'voice_miles' ? ' · 2002 Miles voice, put back as Steam voice when fixed' : ''}</span>}
            </section>

            <section className="card" aria-labelledby="chat-h" data-testid="details-chat">
              <h2 id="chat-h">Chat · {d.chat.length} message{d.chat.length === 1 ? '' : 's'}</h2>
              {d.chat.length === 0 && <p className="note">No chat in this demo.</p>}
              <ul className="chat">
                {(allChat ? d.chat : d.chat.slice(0, 8)).map((c, n) => (
                  <li key={n}>
                    <span className="mono time">{formatLength(c.time)}</span>
                    <span>
                      <span className={`who ${c.team === 'T' ? 't' : c.team === 'CT' ? 'ct' : ''}`}>{c.dead ? '*dead* ' : ''}{c.teamOnly ? '(team) ' : ''}{c.who ?? 'Server'}</span>{' '}
                      {c.text}
                    </span>
                  </li>
                ))}
              </ul>
              {d.chat.length > 8 && (
                <button type="button" className="link-btn" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={() => setAllChat(!allChat)}>
                  {allChat ? 'Show fewer' : `Show all ${d.chat.length}`}
                </button>
              )}
            </section>

            <section className="card" aria-labelledby="health-h" data-testid="details-health">
              <h2 id="health-h">Health</h2>
              <ul className="health">
                {i && i.problems.length === 0 && <li>Problems found: <strong>none</strong></li>}
                {i?.problems.map((p) => <li key={p} className="problem">{p}</li>)}
                {i && !i.directoryOk && <li>The recording was cut off (the game crashed or was closed); SpaceDemo can repair it.</li>}
                {i && i.networkProtocol < 48 && <li>Recorded with network protocol {i.networkProtocol}; it gets converted to 48 for today's CS 1.6 when fixed.</li>}
                {i && i.maps.length > 1 && <li>Changes map ({i.maps.join(' → ')}): it plays with playdemo, so the game's demo panel isn't available.</li>}
                {demo.map && demo.map.kind !== 'ok' && <li className={demo.map.kind === 'bad' ? 'problem' : ''}>Map: {demo.map.note}{demo.map.kind === 'bad' ? '. Add a folder with the old map version in Settings.' : ''}</li>}
                {demo.alsoAt.length > 0 && <li>Same demo also at: {demo.alsoAt.join('; ')}</li>}
                <li className="note">Your original is only read, never changed.</li>
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="back-link" onClick={onBack}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
      Library
    </button>
  );
}

function TeamTable({ side, team, label, recording }: { side: 'T' | 'CT'; team: TeamDetails; label: string; recording?: string }) {
  const talk = (p: PlayerRow) => (p.recorder && recording === 'POV' ? 'own voice not recorded' : p.talkSeconds > 0 ? `${(p.talkSeconds / 60).toFixed(1)} min` : team.heard ? '—' : 'not heard');
  return (
    <table className="team-table">
      <thead>
        <tr>
          <th scope="col"><span className={`side ${side.toLowerCase()}`}>{label} · {side}</span></th>
          <th scope="col" className="num">Kills</th>
          <th scope="col" className="num">Deaths</th>
          <th scope="col" className="num">Headshots</th>
          <th scope="col" className="num">Talk time</th>
        </tr>
      </thead>
      <tbody>
        {team.players.map((p) => (
          <tr key={p.name}>
            <td className="pname">{p.name}{p.recorder && <span className="sub"> recorder</span>}</td>
            <td className="num mono">{p.kills}</td>
            <td className="num mono">{p.deaths}</td>
            <td className="num mono">{p.headshots}</td>
            <td className="num talkcell">{talk(p)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
