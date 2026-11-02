// Sentence numbers of 1999 demos (plan F4). A sound message can name a "sentence" (a spoken line made of several
// wav files, listed in sound/sentences.txt) by its position in the game's list. The 1999 CS betas had no list of
// their own, so the numbers point into Half-Life's list (valve/sound/sentences.txt); today's CS 1.6 reads its own,
// shorter list (cstrike/sound/sentences.txt), where the same numbers are other lines (e.g. 346/347 = Half-Life's suit
// "flatline" on death, but a scientist's greeting in CS 1.6). Both lists are read from the player's own game.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Sentence {
  name: string;
  /** The wav files it plays, as sound resource names ("fvox/flatline.wav"). */
  words: string[];
}

/** Reads a sentences.txt: one sentence per line ("NAME folder/word word, word"), // comments skipped. */
export function parseSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const [name, ...rest] = line.split(/\s+/);
    let folder = 'vox/';
    const words: string[] = [];
    for (let w of rest.join(' ').replace(/\([^)]*\)/g, ' ').split(/[\s,.]+/)) {
      if (!w) continue;
      const slash = w.lastIndexOf('/');
      if (slash >= 0) { folder = w.slice(0, slash + 1); w = w.slice(slash + 1); }
      if (w) words.push(`${folder}${w}.wav`.toLowerCase());
    }
    out.push({ name, words });
  }
  return out;
}

export interface SentenceLists {
  /** The list the 1999 demo's numbers point into (Half-Life's). */
  old: Sentence[];
  /** Today's CS 1.6 list (names only matter). */
  today: Sentence[];
  /** True when a sound file exists in the player's game (cstrike or valve). */
  hasSound?: (name: string) => boolean;
}

/** Reads both lists from the player's Half-Life folder, or returns undefined when either is missing. */
export function readSentenceLists(halfLifeDir: string): SentenceLists | undefined {
  const valve = join(halfLifeDir, 'valve', 'sound', 'sentences.txt');
  const cstrike = join(halfLifeDir, 'cstrike', 'sound', 'sentences.txt');
  if (!existsSync(valve) || !existsSync(cstrike)) return undefined;
  return {
    old: parseSentences(readFileSync(valve, 'latin1')),
    today: parseSentences(readFileSync(cstrike, 'latin1')),
    hasSound: (name) => ['cstrike', 'valve', 'cstrike_downloads'].some((m) => existsSync(join(halfLifeDir, m, 'sound', ...name.split('/')))),
  };
}

/** What one old sentence number becomes: today's number for the same name, or one plain sound (its last word). */
export type SentencePlan = { kind: 'sentence'; index: number; name: string } | { kind: 'sound'; wav: string; name: string } | { kind: 'drop'; name: string };

export function planSentence(lists: SentenceLists, oldIndex: number): SentencePlan {
  const s = lists.old[oldIndex];
  if (!s) return { kind: 'drop', name: `#${oldIndex}` };
  const t = lists.today.findIndex((x) => x.name.toUpperCase() === s.name.toUpperCase());
  if (t >= 0) return { kind: 'sentence', index: t, name: s.name };
  // Today's list lacks it (e.g. every HEV suit line): play its last word as an ordinary sound ("flatline").
  const wav = s.words[s.words.length - 1];
  if (wav && (!lists.hasSound || lists.hasSound(wav))) return { kind: 'sound', wav, name: s.name };
  return { kind: 'drop', name: s.name };
}
