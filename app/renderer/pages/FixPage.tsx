// Fix & convert (built in plan 4.6). For now: the page frame and an empty state.
import { FixIcon } from '../icons.js';

export function FixPage() {
  return (
    <>
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h1>Fix &amp; convert</h1>
          <span className="page-sub">Repairs old demos and puts their original voice back, for today's CS 1.6.</span>
        </div>
      </div>
      <section className="card empty" aria-labelledby="fix-empty-h">
        <span className="icon"><FixIcon /></span>
        <h2 id="fix-empty-h">Nothing fixed yet</h2>
        <p>Fixed demos and what was repaired in each will be shown here. Until then, the drag-and-drop script <span className="mono">5 fix and play.cmd</span> still does the job.</p>
        <span className="chip">Coming in step 4.6</span>
      </section>
      <p className="note">Your original is never changed: a fixed copy is saved in its own folder.</p>
    </>
  );
}
