// Help (plan 6.3): the short version of docs/USER-GUIDE.md, available offline, with a link to the full guide.
// Keep it in step with the guide (the same words for buttons, folders and statuses as the app uses).
export const GUIDE_URL = 'https://github.com/SpaceisbigSoft/SpaceDemo/blob/main/docs/USER-GUIDE.md';
const ISSUES_URL = 'https://github.com/SpaceisbigSoft/SpaceDemo/issues';

export function HelpPage({ onGo }: { onGo: (page: 'library' | 'fix' | 'settings') => void }) {
  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Help</h1>
          <span className="page-sub">Watch old Counter-Strike demos in today's CS 1.6, with the original voice.</span>
        </div>
        <a className="btn" href={GUIDE_URL} target="_blank" rel="noreferrer" data-testid="help-guide">Full user guide (opens in your browser)</a>
      </div>

      <div className="help-grid">
        <section className="card" aria-labelledby="help-start">
          <h2 id="help-start">Getting started</h2>
          <ol className="help-steps">
            <li><strong>Check the game.</strong> The card at the bottom left should say <em>Found</em>. If not, open{' '}
              <button type="button" className="linkish" onClick={() => onGo('settings')}>Settings</button> and choose the Half-Life folder (the one with <span className="mono">hl.exe</span> and <span className="mono">cstrike</span>).</li>
            <li><strong>Add your demos.</strong> In the{' '}
              <button type="button" className="linkish" onClick={() => onGo('library')}>Library</button>, click <em>Add folder…</em> or drag folders, <span className="mono">.dem</span> or <span className="mono">.zip</span> files onto the window. Zips don't need unpacking.</li>
            <li><strong>Close Counter-Strike</strong> if it's open: Steam won't give a running game a new demo.</li>
            <li><strong>Click <em>Fix &amp; watch</em>.</strong> A fixed copy is made (a few seconds; your original is never changed) and the demo starts in CS 1.6 with its voice.</li>
          </ol>
        </section>

        <section className="card" aria-labelledby="help-panel">
          <h2 id="help-panel">While the demo plays</h2>
          <p>Press <kbd>~</kbd> (under Esc) to open the console: the game's <strong>demo panel</strong> appears next to it. Drag the timeline, pause and play, and set the speed from ×¼ to ×4. Press <kbd>~</kbd> again to keep watching.</p>
          <p className="note">Other keys don't work during a demo; that's the game, not SpaceDemo. Demos that change map can't use the panel: choose their speed in the Watch window instead.</p>
          <p className="note">When you close the game, SpaceDemo removes its copy from <span className="mono">cstrike\cdf_test</span>. Fixed copies stay in your Fixed demos folder.</p>
        </section>

        <section className="card" aria-labelledby="help-voice">
          <h2 id="help-voice">Voice</h2>
          <ul className="help-list">
            <li>A player's demo holds only <strong>his own team's</strong> voice, never his own. Some HLTV demos have no voice at all.</li>
            <li><strong>Voice cleanup</strong> (Settings, on) removes rumble and hiss. <strong>AI voice enhancement</strong> (Settings, off) makes 2002 voice fuller and clearer; the model is a one-time download.</li>
            <li><strong>Voice to text</strong>: open a demo → <em>Voice</em> tab. Rough on old, noisy voice: a guide to what was said, not an exact record.</li>
          </ul>
        </section>

        <section className="card" aria-labelledby="help-maps">
          <h2 id="help-maps">Old map versions</h2>
          <p>Many old demos need an earlier version of their map. Add the folders where you keep old <span className="mono">.bsp</span> files in{' '}
            <button type="button" className="linkish" onClick={() => onGo('settings')}>Settings → Old map versions</button>. SpaceDemo puts the right one in <span className="mono">cstrike_downloads</span> when a demo needs it; today's maps are never replaced.</p>
        </section>

        <section className="card help-wide" aria-labelledby="help-trouble">
          <h2 id="help-trouble">If something goes wrong</h2>
          <dl className="facts help-facts">
            <dt>Game not found</dt><dd>Settings → Counter-Strike 1.6 → <em>Choose game folder…</em></dd>
            <dt>Nothing happens on Watch</dt><dd>Counter-Strike was already open. Close it and try again.</dd>
            <dt>Map error, or "couldn't open … .wad"</dt><dd>The demo needs an old map version or its textures: add your old maps folder; put a missing <span className="mono">.wad</span> in <span className="mono">cstrike_downloads</span>.</dd>
            <dt>No voice in game</dt><dd>Check the library's Voice column; many HLTV demos have none. Old Miles voice needs <span className="mono">mssvoice.asi</span> in the Half-Life folder (Steam installs it).</dd>
            <dt>Update or beta branch</dt><dd>Let Steam finish updating Counter-Strike, and use the normal branch (not a beta).</dd>
            <dt>AI voice problem</dt><dd>Install the Microsoft Visual C++ Redistributable (x64), then try again.</dd>
          </dl>
          <p className="note">Still stuck? <a href={ISSUES_URL} target="_blank" rel="noreferrer">Report it on GitHub</a> with the demo's name, what you clicked and what you saw.</p>
        </section>

        <section className="card help-wide" aria-labelledby="help-safe">
          <h2 id="help-safe">Safe for your files and your Steam account</h2>
          <p>Your demos and the game's own files are never changed. SpaceDemo doesn't touch the running game (no injection, no memory reading), and starts demos through Steam with <span className="mono">-insecure</span>, which turns VAC off for that session only. Nothing is sent anywhere except the model downloads you start yourself.</p>
        </section>
      </div>
    </>
  );
}
