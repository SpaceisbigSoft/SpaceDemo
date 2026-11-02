// Settings (plan 4.7): theme (4.2), the game (found automatically or chosen by hand), old map folders (4.3), voice cleanup,
// fixed-demos folder (4.5), about.
import { useEffect, useState } from 'react';
import { UpdatesCard } from '../UpdateBanner.js';
import { SpeechModelCard } from './DetailsTranscript.js';
import type { AiModelState, AppInfo, AppSettingsView, GameStatus, ThemeChoice } from '../../shared/api.js';

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Same as Windows' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

/** 5.g5 AI voice enhancement: the switch and the model (downloaded once, or a file the person has). */
function AiVoiceCard({ view, setView }: { view?: AppSettingsView; setView: (v: AppSettingsView) => void }) {
  const [m, setM] = useState<AiModelState | undefined>();
  useEffect(() => {
    void window.spacedemo.getAiModel().then(setM);
    return window.spacedemo.onAiModel((s) => { setM(s); void window.spacedemo.getSettings().then(setView); });
  }, [setView]);
  const mb = (n: number) => `${Math.round(n / 1_000_000)} MB`;
  const on = view?.aiVoice.on ?? false;
  return (
    <section className="card" aria-labelledby="ai-h" data-testid="settings-ai">
      <h2 id="ai-h">AI voice enhancement</h2>
      <label className="check-row">
        <input type="checkbox" checked={on} disabled={!view} onChange={(e) => void window.spacedemo.setAiVoice(e.target.checked).then(setView)} data-testid="ai-voice" />
        <span>
          <span>Make the old voice clearer with AI</span>
          <span className="note">A free AI model (VoiceFixer) rebuilds the 2002 voice so it sounds fuller and clearer. It runs on this PC and takes longer than a normal fix (about 15 seconds per minute of voice on a fast PC). While it's on, voice cleanup isn't used. This is the default for every demo; the AI voice box next to Fix in the Library switches it for single demos. Applies to demos fixed from now on; copies made the other way are fixed again when you watch or fix them. The plain voice is always available: switch this off.</span>
        </span>
      </label>
      {m?.downloading ? (
        <>
          <p className="note" data-testid="ai-progress">Downloading the AI model… {mb(m.downloading.done)} of {mb(m.downloading.total)}</p>
          <progress max={m.downloading.total} value={m.downloading.done} className="tr-progress" />
        </>
      ) : m?.path ? (
        <p className="note" data-testid="ai-ready">AI model ready{m.chosenByHand ? ' (your file)' : ''}: <span className="mono" style={{ overflowWrap: 'anywhere' }}>{m.path}</span></p>
      ) : (
        <p className={on ? 'problem' : 'note'} data-testid="ai-missing">{on ? 'The AI model isn\'t downloaded yet, so demos are still fixed with the plain voice. ' : ''}The AI model is downloaded once, about {mb(m?.size ?? 142_000_000)}.</p>
      )}
      {m?.problem && <p className="problem" data-testid="ai-problem">{m.problem}</p>}
      <div className="btn-row">
        {!m?.path && <button type="button" className={`btn${on ? ' primary' : ''}`} disabled={!!m?.downloading} onClick={() => void window.spacedemo.downloadAiModel().then(setM)} data-testid="ai-download">Download the AI model</button>}
        <button type="button" className="btn" disabled={!!m?.downloading} onClick={() => void window.spacedemo.chooseAiModel().then(setM)}>Use a model file I have…</button>
      </div>
    </section>
  );
}

export function SettingsPage({ game, looking, onLookAgain }: { game?: GameStatus; looking: boolean; onLookAgain: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice | undefined>();
  const [info, setInfo] = useState<AppInfo | undefined>();
  const [view, setView] = useState<AppSettingsView | undefined>();
  const [licenceProblem, setLicenceProblem] = useState('');

  useEffect(() => {
    void window.spacedemo.getTheme().then((s) => setTheme(s.choice));
    void window.spacedemo.info().then(setInfo);
    void window.spacedemo.getSettings().then(setView);
  }, []);

  const [gameProblem, setGameProblem] = useState<string | undefined>();
  const chooseGame = async () => {
    const r = await window.spacedemo.chooseGameFolder();
    setGameProblem(r.problem);
    setView(r);
    if (!r.problem) onLookAgain();
  };

  const choose = async (t: ThemeChoice) => {
    setTheme(t);
    setTheme((await window.spacedemo.setTheme(t)).choice);
  };

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      <section className="card" aria-labelledby="look-h">
        <h2 id="look-h">Appearance</h2>
        <fieldset style={{ margin: 0, padding: 0, border: 0 }}>
          <legend style={{ padding: 0, marginBottom: 10, fontWeight: 600 }}>Theme</legend>
          <div className="choice-row">
            {THEMES.map(({ id, label }) => (
              <label key={id} className="choice">
                <input type="radio" name="theme" value={id} checked={theme === id} onChange={() => void choose(id)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="card" aria-labelledby="game-h" data-testid="settings-game">
        <h2 id="game-h">Counter-Strike 1.6</h2>
        {looking && !game ? (
          <p className="note">Looking for Steam and the game…</p>
        ) : game?.found ? (
          <dl className="facts">
            <dt>Status</dt><dd>{view?.gameDir ? 'Chosen by you' : 'Found automatically'}</dd>
            <dt>Game folder</dt><dd className="mono">{game.gameDir}</dd>
            {game.version && <><dt>Version</dt><dd>{game.version}{game.buildId ? ` · Steam build ${game.buildId}` : ''}</dd></>}
            {game.steamExe && <><dt>Steam</dt><dd className="mono">{game.steamExe}</dd></>}
          </dl>
        ) : (
          <p className="problem">Counter-Strike 1.6 wasn't found. Choose its folder (the Half-Life folder with hl.exe and cstrike).</p>
        )}
        {game?.problems.map((p) => <p key={p} className="problem">{p}</p>)}
        {game?.notes.map((n) => <p key={n} className="note">{n}</p>)}
        {gameProblem && <p className="problem" role="alert">{gameProblem}</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={onLookAgain} disabled={looking}>{looking ? 'Looking…' : 'Look again'}</button>
          <button type="button" className="btn" onClick={() => void chooseGame()} data-testid="choose-game">Choose game folder…</button>
          {view?.gameDir && <button type="button" className="btn" onClick={() => void window.spacedemo.clearGameFolder().then((v) => { setView(v); onLookAgain(); })}>Find automatically</button>}
        </div>
        <p className="note">SpaceDemo never changes the game's own files. It only adds its own: a copy of the demo you watch (cstrike\cdf_test, removed when the game closes) and old map versions a demo needs (cstrike_downloads, under a new name when today's map has the same name). It starts the game through Steam with -insecure.</p>
      </section>

      <section className="card" aria-labelledby="maps-h" data-testid="settings-maps">
        <h2 id="maps-h">Old map versions</h2>
        <p className="note" style={{ color: 'var(--text-2)' }}>Many old demos were recorded on earlier versions of a map. Add the folders where you keep old .bsp files (your map pool); SpaceDemo finds the right version by its checksum and puts it in place when a demo needs it. These folders are only read.</p>
        {view && view.mapFolders.length > 0 ? (
          <ul className="folder-list" aria-label="Map pool folders">
            {view.mapFolders.map((f) => (
              <li key={f}>
                <span className="mono">{f}</span>
                <button type="button" className="link-btn" onClick={() => void window.spacedemo.removeMapFolder(f).then(setView)} aria-label={`Remove ${f}`}>Remove</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="note">No map pool folder yet. Today's maps in your game folder are always checked.</p>
        )}
        <div><button type="button" className="btn" onClick={() => void window.spacedemo.addMapFolder().then(setView)}>Add map folder…</button></div>
      </section>

      <section className="card" aria-labelledby="voice-h" data-testid="settings-voice">
        <h2 id="voice-h">Voice</h2>
        <label className="check-row">
          <input type="checkbox" checked={view?.voiceCleanup ?? true} onChange={(e) => void window.spacedemo.setVoiceCleanup(e.target.checked).then(setView)} data-testid="voice-cleanup" />
          <span>
            <span>Voice cleanup</span>
            <span className="note">Makes the 2002 voice clearer: removes rumble and hiss and evens out the loudness of each talk burst. Turn it off to keep the voice exactly as decoded. Applies to demos fixed from now on.</span>
          </span>
        </label>
      </section>

      <AiVoiceCard view={view} setView={setView} />

      <SpeechModelCard />

      <section className="card" aria-labelledby="cpu-h" data-testid="settings-cpu">
        <h2 id="cpu-h">Processor cores</h2>
        <p className="note" style={{ color: 'var(--text-2)' }}>How many of this PC's processor cores SpaceDemo may use for heavy work: turning voice into text and AI voice enhancement. More cores is faster; fewer leaves more room for other programs while it works.</p>
        <label className="check-row" style={{ alignItems: 'center' }}>
          <select className="select"
            value={view?.cpu.cores ?? ''}
            disabled={!view}
            onChange={(e) => {
              const n = Number(e.target.value);
              void window.spacedemo.setCpuCores(view && n === view.cpu.suggested ? null : n).then(setView);
            }}
            data-testid="cpu-cores"
            aria-label="Processor cores SpaceDemo may use"
          >
            {view && Array.from({ length: view.cpu.max }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n}{n === view.cpu.suggested ? ' (suggested maximum)' : ''}</option>
            ))}
          </select>
          <span className="note" data-testid="cpu-note">
            {view ? `Suggested maximum: ${view.cpu.suggested} of ${view.cpu.max} — all cores but one, so Windows stays smooth.${view.cpu.chosen && view.cpu.cores !== view.cpu.suggested ? ' You chose a different number.' : ''}` : '…'}
          </span>
        </label>
      </section>

      <section className="card" aria-labelledby="out-h" data-testid="settings-output">
        <h2 id="out-h">Fixed demos</h2>
        <p className="note" style={{ color: 'var(--text-2)' }}>When a demo is fixed, the fixed copy is saved here. Your originals are never changed.</p>
        <span className="mono" style={{ overflowWrap: 'anywhere' }}>{view?.outputFolder ?? '…'}</span>
        <div><button type="button" className="btn" onClick={() => void window.spacedemo.chooseOutputFolder().then(setView)}>Change folder…</button></div>
      </section>

      <UpdatesCard on={view?.updateCheck} onChange={(on) => void window.spacedemo.setUpdateCheck(on).then(setView)} />

      <section className="card" aria-labelledby="about-h">
        <h2 id="about-h">About</h2>
        <dl className="facts">
          <dt>Version</dt><dd data-testid="app-version">{info ? `SpaceDemo ${info.version}` : '…'}</dd>
          <dt>Licence</dt><dd>GNU GPL v3 or later — free software; source code at <span className="mono">github.com/SpaceisbigSoft/SpaceDemo</span></dd>
          <dt>Thanks</dt><dd>compLexity Demo Player (COL) and CS Demo Manager, whose work showed the way; SK Player for ideas; the community's notes on the demo format.</dd>
          <dt>Old voice</dt><dd>Speex by Xiph.Org (BSD). Old Miles voice is decoded with your own game's files; SpaceDemo includes no Valve or RAD files.</dd>
          <dt>Steam voice</dt><dd>Opus by Xiph.Org and others (BSD), via opusscript (MIT).</dd>
          <dt>AI voice</dt><dd data-testid="credit-ai">VoiceFixer by Haohe Liu et al. (code MIT; trained model CC BY 4.0, <span className="mono">zenodo.org/records/5600188</span> and <span className="mono">5469951</span>). SpaceDemo's copy is changed: combined, compressed (int8/fp16) and converted to ONNX. Runs with ONNX Runtime (MIT, Microsoft).</dd>
          <dt>Voice to text</dt><dd>OpenAI Whisper (MIT) via whisper.cpp (MIT).</dd>
          <dt>App</dt><dd>Electron, Chromium and Node.js; React (MIT); Inter and JetBrains Mono fonts (SIL Open Font Licence 1.1).</dd>
          <dt>Trademarks</dt><dd>Counter-Strike and Half-Life are trademarks of Valve Corporation. SpaceDemo is not affiliated with Valve.</dd>
        </dl>
        <div className="btn-row">
          <button type="button" className="btn" data-testid="open-notices" onClick={() => void window.spacedemo.openLicence('notices').then(setLicenceProblem)}>Open-source licences…</button>
          <button type="button" className="btn" data-testid="open-licence" onClick={() => void window.spacedemo.openLicence('licence').then(setLicenceProblem)}>GNU GPL v3 text…</button>
        </div>
        <p className="note" style={{ color: 'var(--text-2)' }}>The full list of other people's work in SpaceDemo, with every licence, is in THIRD-PARTY-NOTICES.txt in the install folder.</p>
        {licenceProblem && <p className="note" role="alert" data-testid="licence-problem">{licenceProblem}</p>}
      </section>
    </>
  );
}
