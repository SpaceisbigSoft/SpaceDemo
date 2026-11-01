// 6.7: a banner at the top of every page when a newer SpaceDemo is available, downloading, or ready to install.
// Hidden for "Later" until the next change; errors only show when the person started the check or download.
import { useEffect, useState } from 'react';
import type { UpdateState } from '../shared/api.js';

export function useUpdateState(): UpdateState | undefined {
  const [s, setS] = useState<UpdateState | undefined>();
  useEffect(() => {
    void window.spacedemo.getUpdate().then(setS);
    return window.spacedemo.onUpdate(setS);
  }, []);
  return s;
}

export function UpdateBanner() {
  const s = useUpdateState();
  const [hidden, setHidden] = useState<string | undefined>();
  const [notes, setNotes] = useState(false);
  if (!s) return null;
  const key = `${s.stage}:${s.latest ?? ''}`;
  const show = s.stage === 'available' || s.stage === 'downloading' || s.stage === 'ready' || (s.stage === 'error' && s.manual && !!s.latest);
  if (!show || hidden === key) return null;
  return (
    <section className="update-banner" role="status" aria-live="polite" aria-label="SpaceDemo update" data-testid="update-banner" data-stage={s.stage}>
      <div className="update-text">
        {s.stage === 'available' && <><strong>SpaceDemo {s.latest} is available.</strong> <span>You have {s.current}. It installs over this version: your settings, library and demos stay.</span></>}
        {s.stage === 'downloading' && <><strong>Downloading SpaceDemo {s.latest}… {s.percent ?? 0} %</strong> <span>You can keep using SpaceDemo.</span></>}
        {s.stage === 'ready' && <><strong>SpaceDemo {s.latest} is ready.</strong> <span>Restart to finish (a few seconds). Or choose Later: it installs when you close SpaceDemo.</span></>}
        {s.stage === 'error' && <><strong>The update didn't download.</strong> <span>{s.error}</span></>}
        {s.stage === 'downloading' && <progress max={100} value={s.percent ?? 0} aria-label="Download progress" />}
        {notes && s.notes && <pre className="update-notes" data-testid="update-notes">{s.notes}</pre>}
      </div>
      <div className="update-actions">
        {(s.stage === 'available' || s.stage === 'error') && <button type="button" className="btn primary" onClick={() => void window.spacedemo.downloadUpdate()} data-testid="update-download">Download</button>}
        {s.stage === 'ready' && <button type="button" className="btn primary" onClick={() => void window.spacedemo.installUpdate()} data-testid="update-install">Restart now</button>}
        {s.notes && s.stage !== 'downloading' && <button type="button" className="btn" aria-expanded={notes} onClick={() => setNotes(!notes)}>{notes ? "Hide what's new" : "What's new"}</button>}
        {s.stage !== 'downloading' && <button type="button" className="btn" onClick={() => setHidden(key)} data-testid="update-later">Later</button>}
      </div>
    </section>
  );
}

/** Settings → Updates. */
export function UpdatesCard({ on, onChange }: { on?: boolean; onChange: (on: boolean) => void }) {
  const s = useUpdateState();
  const when = s?.checked ? new Date(s.checked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : undefined;
  let status = '…';
  if (s) {
    status = {
      unsupported: 'Updates work in the installed SpaceDemo (not in this development copy).',
      idle: on ? 'Checks shortly after SpaceDemo starts.' : 'Not checked yet.',
      checking: 'Checking GitHub…',
      none: `You have the newest version${when ? ` (checked ${when})` : ''}.`,
      available: `SpaceDemo ${s.latest} is available: see the bar at the top.`,
      downloading: `Downloading SpaceDemo ${s.latest}… ${s.percent ?? 0} %`,
      ready: `SpaceDemo ${s.latest} is ready: restart to finish, or it installs when you close SpaceDemo.`,
      error: s.error ?? 'The update check didn\'t work.',
    }[s.stage];
  }
  return (
    <section className="card" aria-labelledby="upd-h" data-testid="settings-updates">
      <h2 id="upd-h">Updates</h2>
      <label className="check-row">
        <input type="checkbox" checked={!!on} disabled={on === undefined} onChange={(e) => onChange(e.target.checked)} data-testid="update-check" />
        <span><span>Check for a new version when SpaceDemo starts</span><span className="note">SpaceDemo asks GitHub for the newest release (nothing about you is sent) and asks you before downloading. Updates install over the old version: your settings and demos stay.</span></span>
      </label>
      <dl className="facts">
        <dt>This version</dt><dd>{s?.current ?? '…'}</dd>
        <dt>Status</dt><dd><span role="status" data-testid="update-status">{status}</span></dd>
      </dl>
      <div className="btn-row">
        <button type="button" className="btn" disabled={!s || s.stage === 'unsupported' || s.stage === 'checking' || s.stage === 'downloading'} onClick={() => void window.spacedemo.checkForUpdate()} data-testid="update-check-now">Check now</button>
      </div>
    </section>
  );
}
