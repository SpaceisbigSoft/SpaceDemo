// 4.10 (owner, 2026-11-01): the AI-enhanced voice choice next to Fix, per demo. Settings → AI voice stays the default;
// ticking or unticking here changes only this demo (remembered for it), so its fixed copy matches the choice.
import { useEffect, useState } from 'react';
import type { LibraryDemo } from '../shared/api.js';

/** True once the AI voice model is on this PC (downloaded, or a file the person chose). */
export function useAiModelReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void window.spacedemo.getAiModel().then((m) => setReady(!!m.path));
    return window.spacedemo.onAiModel((m) => setReady(!!m.path));
  }, []);
  return ready;
}

/** Why the box can't be ticked for this demo (undefined = it can). Every demo gets the box; this explains the grey ones. */
export function aiVoiceBlocked(d: LibraryDemo, ready: boolean): string | undefined {
  if (!d.info) return d.status === 'waiting' ? 'Reading the demo…' : "This demo can't be read.";
  if (d.info.talkBursts === 0) return 'No voice in this demo (voice chat came with CS 1.3; many HLTV demos have none).';
  if (d.status === 'plays') return 'This demo plays as it is (today\'s Steam voice): it isn\'t fixed, so there is nothing to enhance.';
  if (d.status !== 'needs-fix' && d.status !== 'damaged' && d.status !== 'fixed') return "This demo can't be fixed.";
  if (!ready) return 'Download the AI voice model first: Settings → AI voice enhancement.';
  return undefined;
}

/** `long`: the details page's wording; in the library table the column heading says what the box is. */
export function AiVoiceToggle({ d, ready, long }: { d: LibraryDemo; ready: boolean; long?: boolean }) {
  // Shows the click at once; the library update that follows confirms it.
  const [shown, setShown] = useState(!!d.aiVoice);
  useEffect(() => setShown(!!d.aiVoice), [d.aiVoice]);
  const blocked = aiVoiceBlocked(d, ready);
  const why = blocked ?? 'Fix this demo with AI-enhanced voice (fuller, clearer; slower to fix). Only this demo changes; Settings → AI voice enhancement is the default for the others.';
  return (
    <label className={`ai-toggle${blocked ? ' off' : ''}`} title={why} data-testid="demo-ai-voice">
      <input
        type="checkbox"
        checked={!blocked && shown}
        disabled={!!blocked}
        onChange={(e) => { setShown(e.target.checked); void window.spacedemo.setDemoAiVoice(d.key, e.target.checked); }}
        aria-label={`AI-enhanced voice for ${d.name}`}
      />
      {long ? <span>AI-enhanced voice</span> : <span className="visually-hidden">AI voice</span>}
    </label>
  );
}
