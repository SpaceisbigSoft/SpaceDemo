// 5.v Voice to text on the Voice tab: turn the demo's voice into text (once; kept afterwards), then read and search what
// was said, per player and round. Made on this PC by the speech model (Settings → Voice to text).
import { useEffect, useMemo, useState } from 'react';
import type { DemoDetails, SpeechModelState, TranscriptState } from '../../shared/api.js';
import { formatLength } from '../format.js';

export function TranscriptCard({ demoKey, d, onSettings }: { demoKey: string; d: DemoDetails; onSettings?: () => void }) {
  const [t, setT] = useState<TranscriptState | undefined>();
  const [model, setModel] = useState<SpeechModelState | undefined>();
  const [q, setQ] = useState('');
  const [who, setWho] = useState('all');

  useEffect(() => {
    let live = true;
    void window.spacedemo.getTranscript(demoKey).then((s) => { if (live) setT(s); });
    void window.spacedemo.getSpeechModel().then((s) => { if (live) setModel(s); });
    const off = window.spacedemo.onTranscript((s) => { if (s.key === demoKey) setT(s); });
    const offM = window.spacedemo.onSpeechModel(setModel);
    return () => { live = false; off(); offM(); };
  }, [demoKey]);

  const teamOf = useMemo(() => {
    const m = new Map<string, 'T' | 'CT'>();
    for (const r of d.voice) if (r.team === 'T' || r.team === 'CT') m.set(r.name, r.team);
    return m;
  }, [d]);
  const where = (time: number) => {
    const p = d.periods.find((x) => time >= x.start && time < x.end);
    if (!p) return formatLength(time);
    if (p.round === undefined) return p.label;
    return `R${p.round} ${p.freezeEnd !== undefined && time < p.freezeEnd ? 'freeze' : formatLength(time - (p.freezeEnd ?? p.start))}`;
  };

  const lines = t?.lines ?? [];
  const players = [...new Set(lines.map((l) => l.player ?? '?'))].sort();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = lines.filter((l) => (who === 'all' || (l.player ?? '?') === who) && words.every((w) => l.text.toLowerCase().includes(w)));
  const working = t?.status === 'working';
  const ready = !!model?.path && model.helper;

  return (
    <section className="card" aria-labelledby="tr-h" data-testid="details-transcript">
      <h2 id="tr-h">Voice to text</h2>
      {t?.status === 'done' ? (
        lines.length === 0 ? <p className="note">{t.note ?? 'Nothing could be made out.'}</p> : (
          <>
            <div className="tr-tools">
              <input type="search" placeholder="Search what was said…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search what was said" data-testid="tr-search" />
              <select className="select" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Player" data-testid="tr-player">
                <option value="all">Everyone</option>
                {players.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <span className="note" data-testid="tr-count">{shown.length} of {lines.length} lines</span>
            </div>
            <ol className="tr-list" data-testid="tr-lines">
              {shown.map((l) => (
                <li key={l.time + (l.player ?? '')} data-testid="tr-line">
                  <span className="mono tr-when">{where(l.time)}</span>
                  <span className={`side ${teamOf.get(l.player ?? '') === 'T' ? 't' : teamOf.get(l.player ?? '') === 'CT' ? 'ct' : ''} tr-who`}>{l.player ?? '?'}</span>
                  <span className="tr-text">{l.text}</span>
                </li>
              ))}
            </ol>
            <span className="note">Made on this PC by the speech model ({t.model}). About 5 in 6 lines of the 2002 voice and 9 in 10 of later voice come out right or mostly right (owner's test); quick or mumbled calls can be wrong.</span>
          </>
        )
      ) : working ? (
        <>
          <p className="note" data-testid="tr-progress">Turning the voice into text… {t?.total ? `${t.done ?? 0} of ${t.total} talk bursts` : 'reading the voice'}{t?.lines?.length ? ` · ${t.lines.length} lines so far` : ''}</p>
          <progress max={t?.total ?? 1} value={t?.done ?? 0} className="tr-progress" />
          <div><button type="button" className="btn" onClick={() => void window.spacedemo.stopTranscript()}>Stop</button></div>
        </>
      ) : (
        <>
          <p className="note">Turn what the players said into text you can read and search. It runs on this PC (nothing is sent anywhere) and takes a few minutes per demo; it's kept afterwards.</p>
          {t?.status === 'failed' && <p className="problem" data-testid="tr-error">{t.error}</p>}
          {!ready && <p className="note">{!model?.helper ? 'The speech helper is missing (helpers\\whisper-helper\\spacedemo-whisper.exe).' : 'First get the speech model (about 190 MB, once):'} {model?.helper && onSettings && <button type="button" className="link-btn" onClick={onSettings}>Settings → Voice to text</button>}</p>}
          <div><button type="button" className="btn primary" disabled={!ready || d.voice.length === 0} onClick={() => void window.spacedemo.startTranscript(demoKey).then(setT)} data-testid="tr-start">Turn voice into text</button></div>
        </>
      )}
    </section>
  );
}

/** Settings → Voice to text: the speech model (download once, or use a file you have). */
export function SpeechModelCard() {
  const [m, setM] = useState<SpeechModelState | undefined>();
  useEffect(() => {
    void window.spacedemo.getSpeechModel().then(setM);
    return window.spacedemo.onSpeechModel(setM);
  }, []);
  const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
  return (
    <section className="card" aria-labelledby="speech-h" data-testid="settings-speech">
      <h2 id="speech-h">Voice to text</h2>
      <p className="note" style={{ color: 'var(--text-2)' }}>To turn the players' voice into text (Voice tab), SpaceDemo uses a free speech model (OpenAI Whisper "small", English) that runs on this PC. It is downloaded once, about {mb(m?.size ?? 190_000_000)}.</p>
      <p className="note" data-testid="speech-accuracy">How good the text is depends on how good the recorded voice is. Old, noisy or quiet voice (like most 2002 demos) gives rougher text, and some words can come out wrong — treat it as a guide to what was said, not an exact record.</p>
      {m?.downloading ? (
        <>
          <p className="note" data-testid="speech-progress">Downloading… {mb(m.downloading.done)} of {mb(m.downloading.total)}</p>
          <progress max={m.downloading.total} value={m.downloading.done} className="tr-progress" />
        </>
      ) : m?.path ? (
        <p className="note" data-testid="speech-ready">Ready{m.chosenByHand ? ' (your file)' : ''}: <span className="mono" style={{ overflowWrap: 'anywhere' }}>{m.path}</span></p>
      ) : (
        <p className="note" data-testid="speech-missing">Not downloaded yet.</p>
      )}
      {!m?.helper && <p className="problem">The speech helper is missing (helpers\whisper-helper\spacedemo-whisper.exe).</p>}
      {m?.problem && <p className="problem" data-testid="speech-problem">{m.problem}</p>}
      <div className="btn-row">
        {!m?.path && <button type="button" className="btn primary" disabled={!!m?.downloading} onClick={() => void window.spacedemo.downloadSpeechModel().then(setM)} data-testid="speech-download">Download the speech model</button>}
        <button type="button" className="btn" disabled={!!m?.downloading} onClick={() => void window.spacedemo.chooseSpeechModel().then(setM)}>Use a model file I have…</button>
      </div>
    </section>
  );
}
