// Small display helpers for the window.
import type { DemoStatus, LibraryDemo } from '../shared/api.js';

export function formatLength(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatVoice(d: LibraryDemo): string {
  const i = d.info;
  if (!i) return '';
  if (i.talkBursts === 0) return 'none';
  if (i.voiceSeconds !== undefined) return `${(i.voiceSeconds / 60).toFixed(1)} min`;
  return 'yes';
}

export function formatVersion(protocol: number): string {
  return protocol < 48 ? `Old · p${protocol}` : protocol === 48 ? "Today's · p48" : `Newer · p${protocol}`;
}

export const STATUS_TEXT: Record<DemoStatus, string> = {
  waiting: 'Reading…',
  plays: 'Plays as is',
  fixed: 'Fixed · ready',
  'needs-fix': 'Needs fixing',
  damaged: 'Damaged · repairable',
  'not-cs': 'Not Counter-Strike',
  unreadable: "Can't read",
};

/** Text that search looks in: name, map, server, players, file path. */
export function searchText(d: LibraryDemo): string {
  const i = d.info;
  return [d.name, d.file, d.zipEntry ?? '', i?.maps.join(' ') ?? '', i?.hostName ?? '', ...(i?.players ?? [])].join('\n').toLowerCase();
}
