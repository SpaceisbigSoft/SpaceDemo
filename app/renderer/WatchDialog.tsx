// Watch dialog (plan 4.5, mockup screen 3): what will happen, the speed (only for map-change demos), keep-the-copy,
// then progress: fixing → starting → playing → done. Plan 3.4: the guide to the game's own demo panel.
import { useEffect, useRef, useState } from 'react';
import type { LibraryDemo, WatchInfo, WatchProgress } from '../shared/api.js';
import { formatLength, formatVoice } from './format.js';

const SPEEDS = [0.5, 1, 2, 4];
const speedLabel = (s: number) => (s === 0.5 ? '×½' : `×${s}`);

export function WatchDialog({ demo, onClose }: { demo: LibraryDemo; onClose: () => void }) {
  const [info, setInfo] = useState<WatchInfo | { error: string } | undefined>();
  const [speed, setSpeed] = useState(1);
  const [keep, setKeep] = useState(false);
  const [progress, setProgress] = useState<WatchProgress | undefined>();
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => { void window.spacedemo.getWatchInfo(demo.key).then(setInfo); }, [demo.key]);
  useEffect(() => window.spacedemo.onWatchProgress((p) => { if (p.key === demo.key) setProgress(p); }), [demo.key]);
  useEffect(() => { ref.current?.focus(); }, []);

  const start = async () => {
    setRunning(true);
    const p = await window.spacedemo.watch(demo.key, { speed, keepCopy: keep });
    setProgress((cur) => (cur && cur.stage === 'done' ? cur : p));
    setRunning(false);
  };

  const i = demo.info;
  const w = info && !('error' in info) ? info : undefined;
  const busy = running || progress?.stage === 'fixing' || progress?.stage === 'starting';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-h"
        tabIndex={-1}
        className="modal"
        data-testid="watch-dialog"
        onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onClose(); }}
      >
        <div className="modal-head">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 id="watch-h">Watch {demo.name}</h1>
            <span style={{ color: 'var(--text-2)' }}>
              {i && <><span className="mono">{i.map}</span> · {formatLength(i.seconds)}{i.talkBursts > 0 ? ` · voice ${formatVoice(demo)}` : ''}</>}
            </span>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose} disabled={busy}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        {!info && <p className="note">Checking…</p>}
        {info && 'error' in info && <p className="problem" role="alert">{info.error}</p>}

        {w && !progress && (
          <>
            {w.needsFix && (
              <div className="callout" data-testid="watch-fix-note">
                <strong>Fixed first (a few seconds)</strong>
                <span>Repaired, converted for today's CS 1.6 and the original voice put back as Steam voice. Your original isn't changed; the fixed copy is saved as <span className="mono">{w.fixedCopy}</span>.</span>
              </div>
            )}
            {!w.needsFix && w.fixedCopy && <p className="note">Uses the fixed copy made earlier: <span className="mono">{w.fixedCopy}</span></p>}

            <div className="callout info" data-testid="watch-guide">
              {w.mode === 'viewdemo' ? (
                <>
                  <strong>How it plays: with the game's demo panel</strong>
                  <span>This demo stays on one map, so it opens in <strong>viewdemo</strong>. In the game, press <kbd>~</kbd> to open the console: the demo panel appears next to it. Drag the timeline, pause and play, and change the speed from ×¼ to ×4. Press <kbd>~</kbd> again to watch.</span>
                </>
              ) : (
                <>
                  <strong>How it plays: playdemo</strong>
                  <span>This demo changes map ({w.maps.join(' → ')}), so it plays with <strong>playdemo</strong>. The game's demo panel doesn't work then, so choose the speed here before starting.</span>
                </>
              )}
            </div>

            <fieldset className="plain-fieldset">
              <legend>Speed at start</legend>
              <div className="choice-row">
                {SPEEDS.map((s) => (
                  <label key={s} className="choice">
                    <input type="radio" name="speed" checked={speed === s} disabled={w.mode === 'viewdemo'} onChange={() => setSpeed(s)} />
                    {speedLabel(s)}
                  </label>
                ))}
              </div>
              {w.mode === 'viewdemo' && <span className="note">Only for demos that change map. For this demo, use the panel.</span>}
            </fieldset>

            <label className="check-row">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              <span><span>Keep the copy in the game folder afterwards</span><span className="note">Normally it's removed from cstrike\cdf_test when you close the game.</span></span>
            </label>

            {w.warnings.map((x) => <p key={x} className="warn" role="note">{x}</p>)}
            {w.problems.map((x) => <p key={x} className="problem" role="alert">{x}</p>)}

            <div className="modal-foot">
              <span>Steam starts Counter-Strike with -insecure. Nothing is added to the game, and your original demo isn't changed.</span>
              <span>If Counter-Strike is already open, close it first: Steam won't hand it a new demo.</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" onClick={() => void start()} disabled={w.problems.length > 0 || running} data-testid="watch-start">
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" fill="currentColor" /></svg>
                {w.needsFix ? 'Fix and watch' : 'Watch in CS 1.6'}
              </button>
            </div>
          </>
        )}

        {progress && (
          <div className="watch-progress" role="status" aria-live="polite" data-testid="watch-progress" data-stage={progress.stage}>
            <p className={progress.stage === 'error' ? 'problem' : ''}>{progress.message}</p>
            {progress.done && progress.done.length > 0 && (
              <ul className="health">{progress.done.map((x) => <li key={x}>✓ {x}</li>)}</ul>
            )}
            {progress.notes && progress.notes.length > 0 && (
              <ul className="health">{progress.notes.map((x) => <li key={x} className="note">Note: {x}</li>)}</ul>
            )}
            {progress.stage === 'playing' && <p className="note">Enjoy the demo. You can close this window; SpaceDemo tidies up when the game closes.</p>}
            <div className="modal-actions">
              <button type="button" className="btn" onClick={onClose} disabled={busy}>{progress.stage === 'error' ? 'Close' : 'Done'}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
