// Demo library (built in plan 4.3). For now: the page frame and an empty state.
import { FolderIcon } from '../icons.js';

export function LibraryPage() {
  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Demo library</h1>
          <span className="page-sub">No demo folders added yet.</span>
        </div>
        <button type="button" className="btn" disabled title="Arrives in the next step (4.3)">Add folder…</button>
      </div>
      <section className="card empty" aria-labelledby="lib-empty-h">
        <span className="icon"><FolderIcon /></span>
        <h2 id="lib-empty-h">Your old demos will be listed here</h2>
        <p>Add a folder of old Counter-Strike demos and SpaceDemo shows each one with its map, date, length, voice and whether it needs fixing.</p>
        <span className="chip">Coming in the next step (4.3)</span>
      </section>
      <p className="note">Your original demos are only read, never changed.</p>
    </>
  );
}
