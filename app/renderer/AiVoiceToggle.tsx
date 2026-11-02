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

/** Shown only where a fix happens and there is voice to enhance (CS 1.3+ demos with talking). */
export function showsAiVoice(d: LibraryDemo): boolean {
  const fixable = d.status === 'needs-fix' || d.status === 'damaged' || d.status === 'fixed';
  return fixable && !!d.info && d.info.talkBursts > 0;
}

export function AiVoiceToggle({ d, ready, long }: { d: LibraryDemo; ready: boolean; long?: boolean }) {
  // Shows the click at once; the library update that follows confirms it.
  const [shown, setShown] = useState(!!d.aiVoice);
  useEffect(() => setShown(!!d.aiVoice), [d.aiVoice]);
  if (!showsAiVoice(d)) return null;
  const why = ready
    ? 'Fix this demo with AI-enhanced voice (fuller, clearer; slower to fix). Only this demo changes; Settings → AI voice enhancement is the default for the others.'
    : 'Download the AI voice model first: Settings → AI voice enhancement.';
  return (
    <label className={`ai-toggle${ready ? '' : ' off'}`} title={why} data-testid="demo-ai-voice">
      <input
        type="checkbox"
        checked={ready && shown}
        disabled={!ready}
        onChange={(e) => { setShown(e.target.checked); void window.spacedemo.setDemoAiVoice(d.key, e.target.checked); }}
        aria-label={`AI-enhanced voice for ${d.name}`}
      />
      <span>{long ? 'AI-enhanced voice' : 'AI voice'}</span>
    </label>
  );
}
