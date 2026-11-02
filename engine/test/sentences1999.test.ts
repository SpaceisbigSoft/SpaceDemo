// F4 1999: sentence numbers matched by name (beta 1.0 numbers point into Half-Life's list, today's CS 1.6 reads its own).
import { describe, expect, it } from 'vitest';
import { parseSentences, planSentence } from '../src/legacy/sentences.js';

// Made-up lists in the files' format (names and words invented except the shape).
const old = parseSentences(`// comment
A_ONE vox/hello there
HEV_DEAD0 fvox/beep beep, beep, flatline(p100)
SC_HI scientist/hi
`);
const today = parseSentences(`SC_HI scientist/hi
A_ONE vox/hello there
`);

describe('F4 1999: sentences', () => {
  it('reads names and wav files (folder carried over, modifiers and commas removed)', () => {
    expect(old.map((s) => s.name)).toEqual(['A_ONE', 'HEV_DEAD0', 'SC_HI']);
    expect(old[1].words).toEqual(['fvox/beep.wav', 'fvox/beep.wav', 'fvox/beep.wav', 'fvox/flatline.wav']);
  });
  it('renumbers by name, plays the last word when today has no such sentence, drops unknown numbers', () => {
    const lists = { old, today };
    expect(planSentence(lists, 0)).toEqual({ kind: 'sentence', index: 1, name: 'A_ONE' });
    expect(planSentence(lists, 1)).toEqual({ kind: 'sound', wav: 'fvox/flatline.wav', name: 'HEV_DEAD0' });
    expect(planSentence(lists, 9).kind).toBe('drop');
    expect(planSentence({ old, today, hasSound: () => false }, 1).kind).toBe('drop');
  });
});
