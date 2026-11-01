// Fix & convert (plan 4.6, mockup screen 5): drop or choose old demos (.dem or .zip), or fix everything in the library
// that needs it; results per demo. Originals are only read; fixed copies go to the fixed-demos folder.
import { useState, type DragEvent } from 'react';
import type { FixBatchState, FixItem, LibraryState } from '../../shared/api.js';
import { FixIcon } from '../icons.js';

const STATE_TEXT: Record<FixItem['state'], string> = { waiting: 'Waiting', fixing: 'Fixing…', fixed: 'Fixed', failed: "Didn't work", skipped: 'Not fixed (stopped)' };

export function FixPage({ batch, library, onWatch }: { batch?: FixBatchState; library?: LibraryState; onWatch: (key: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const items = batch?.items ?? [];
  const fixedCount = items.filter((i) => i.state === 'fixed').length;
  const finished = items.filter((i) => i.state !== 'waiting' && i.state !== 'fixing').length;
  const needing = (library?.demos ?? []).filter((d) => d.status === 'needs-fix' || d.status === 'damaged');

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const paths = [...e.dataTransfer.files].map((f) => window.spacedemo.pathForFile(f)).filter(Boolean);
    if (paths.length) void window.spacedemo.fixFiles(paths);
  };

  return (
    <div className="fixpage" data-testid="fixpage">
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Fix &amp; convert</h1>
          <span className="page-sub">Repairs old demos and puts their original voice back, for today's CS 1.6.</span>
        </div>
        {needing.length > 0 && (
          <button type="button" className="btn primary" disabled={batch?.running} onClick={() => void window.spacedemo.fixDemos(needing.map((d) => d.key))} data-testid="fix-all">
            Fix all {needing.length} in the library that need it
          </button>
        )}
      </div>

      <section
        className={`dropzone${dragging ? ' dragging' : ''}`}
        aria-labelledby="drop-h"
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={onDrop}
      >
        <span className="icon" aria-hidden="true"><FixIcon /></span>
        <h2 id="drop-h">Drop old demos here</h2>
        <p>Any CS 1.0–1.6 .dem file, or a .zip with demos in it. Repairs cut-off recordings, converts to today's CS 1.6 and puts the original voice back.</p>
        <button type="button" className="btn" onClick={() => void window.spacedemo.fixFiles()}>Choose files…</button>
      </section>

      {items.length > 0 && (
        <>
          <div className="fix-summary" role="status" data-testid="fix-summary">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <strong>
                {batch?.running ? `Fixing… ${finished} of ${items.length} done` : `${fixedCount} of ${items.length} demo${items.length === 1 ? '' : 's'} fixed`}
              </strong>
              <span className="note">Your originals are untouched. Fixed copies are saved to <span className="mono">{batch?.outputFolder}</span></span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {batch?.running && <button type="button" className="btn" onClick={() => void window.spacedemo.stopFixing()}>Stop after this one</button>}
              <button type="button" className="btn" onClick={() => void window.spacedemo.openOutputFolder()}>Open folder</button>
            </div>
          </div>
          {batch?.running && <progress className="fix-progress" max={items.length} value={finished} aria-label="Fixing progress" />}

          <div className="table-wrap">
            <table className="demo-table fix-table" data-testid="fix-table">
              <thead>
                <tr>
                  <th scope="col">Demo</th>
                  <th scope="col">Result</th>
                  <th scope="col">Time</th>
                  <th scope="col">Original voice</th>
                  <th scope="col">What was done</th>
                  <th scope="col"><span className="visually-hidden">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.key} data-testid="fix-row" data-state={i.state}>
                    <td>
                      <div className="cell-stack">
                        <span className="demo-name">{i.name}</span>
                        <span className="sub mono">{i.map ?? ''}</span>
                      </div>
                    </td>
                    <td><span className={`status fix-${i.state}`}>{STATE_TEXT[i.state]}</span></td>
                    <td className="mono nowrap">{i.seconds !== undefined ? `${i.seconds.toFixed(1)} s` : ''}</td>
                    <td className={`nowrap${i.voice?.startsWith('none') ? ' voice none' : i.voice === 'not restored' ? ' warn' : ''}`} data-testid="fix-voice">{i.progress ?? i.voice ?? ''}</td>
                    <td className="what">
                      {i.error && <span className="problem">{i.error}</span>}
                      {i.done.join(' · ')}
                      {i.notes.length > 0 && <span className="sub"> · {i.notes.join(' · ')}</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {i.state === 'fixed' && i.inLibrary && (
                          <button type="button" className="btn small primary" onClick={() => onWatch(i.key)} aria-label={`Watch ${i.name}`}>Watch</button>
                        )}
                        {i.output && (
                          <button type="button" className="icon-btn" title="Show the fixed copy in Explorer" aria-label={`Show the fixed copy of ${i.name}`} onClick={() => void window.spacedemo.showInFolder(i.output!)}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {items.length === 0 && needing.length === 0 && (library?.demos.length ?? 0) > 0 && <p className="note">Everything in the library is ready to watch.</p>}
    </div>
  );
}
