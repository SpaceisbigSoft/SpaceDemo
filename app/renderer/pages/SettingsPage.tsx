// Settings (plan 4.7 fills in the rest). Working now: theme (4.2), game found (3.1), old map folders (4.3), fixed-demos folder (4.5).
import { useEffect, useState } from 'react';
import type { AppInfo, AppSettingsView, GameStatus, ThemeChoice } from '../../shared/api.js';

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Same as Windows' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

export function SettingsPage({ game, looking, onLookAgain }: { game?: GameStatus; looking: boolean; onLookAgain: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice | undefined>();
  const [info, setInfo] = useState<AppInfo | undefined>();
  const [view, setView] = useState<AppSettingsView | undefined>();

  useEffect(() => {
    void window.spacedemo.getTheme().then((s) => setTheme(s.choice));
    void window.spacedemo.info().then(setInfo);
    void window.spacedemo.getSettings().then(setView);
  }, []);

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
            <dt>Status</dt><dd>Found automatically</dd>
            <dt>Game folder</dt><dd className="mono">{game.gameDir}</dd>
            {game.version && <><dt>Version</dt><dd>{game.version}{game.buildId ? ` · Steam build ${game.buildId}` : ''}</dd></>}
            {game.steamExe && <><dt>Steam</dt><dd className="mono">{game.steamExe}</dd></>}
          </dl>
        ) : (
          <p className="problem">Counter-Strike 1.6 wasn't found. Choosing the folder by hand arrives in step 4.7.</p>
        )}
        {game?.problems.map((p) => <p key={p} className="problem">{p}</p>)}
        {game?.notes.map((n) => <p key={n} className="note">{n}</p>)}
        <div><button type="button" className="btn" onClick={onLookAgain} disabled={looking}>{looking ? 'Looking…' : 'Look again'}</button></div>
        <p className="note">SpaceDemo only reads the game folder. It starts the game through Steam with -insecure and never changes game files.</p>
      </section>

      <section className="card" aria-labelledby="maps-h" data-testid="settings-maps">
        <h2 id="maps-h">Old map versions</h2>
        <p className="note" style={{ color: 'var(--text-2)' }}>Many old demos were recorded on earlier versions of a map. Add the folders where you keep old .bsp files (your map pool); SpaceDemo finds the right version by its checksum. These folders are only read.</p>
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

      <section className="card" aria-labelledby="out-h" data-testid="settings-output">
        <h2 id="out-h">Fixed demos</h2>
        <p className="note" style={{ color: 'var(--text-2)' }}>When a demo is fixed, the fixed copy is saved here. Your originals are never changed.</p>
        <span className="mono" style={{ overflowWrap: 'anywhere' }}>{view?.outputFolder ?? '…'}</span>
        <div><button type="button" className="btn" onClick={() => void window.spacedemo.chooseOutputFolder().then(setView)}>Change folder…</button></div>
      </section>

      <section className="card" aria-labelledby="about-h">
        <h2 id="about-h">About</h2>
        <dl className="facts">
          <dt>Version</dt><dd data-testid="app-version">{info ? `SpaceDemo ${info.version}` : '…'}</dd>
          <dt>Licence</dt><dd>GNU GPL v3</dd>
          <dt>Thanks</dt><dd>compLexity Demo Player (COL) and CS Demo Manager, whose work showed the way.</dd>
        </dl>
      </section>
    </>
  );
}
