import { describe, expect, it } from 'vitest';
import { BETA66_SEQUENCES, BETA71_SEQUENCES, CS16_SEQUENCES, betaPlayerSequence, betaToCs16Name } from '../src/transforms/beta-sequences.js';

const name = (i: number) => CS16_SEQUENCES[i];

describe('beta player animations (F4)', () => {
  it('maps every beta animation to a real CS 1.6 animation', () => {
    for (const [p, list] of [[41, BETA66_SEQUENCES], [42, BETA71_SEQUENCES]] as const) {
      expect(list.length).toBe(p === 41 ? 126 : 144);
      list.forEach((_, i) => expect(name(betaPlayerSequence(i, p))).toBeTruthy());
    }
  });
  it('matches by name', () => {
    expect(betaToCs16Name('ref_shoot_crowbar')).toBe('ref_shoot_knife');
    expect(betaToCs16Name('crouch_aim_sniper')).toBe('crouch_aim_rifle');
    expect(betaToCs16Name('reload_mp5')).toBe('ref_reload_mp5');
    expect(betaToCs16Name('die_head2')).toBe('head');
    expect(name(betaPlayerSequence(BETA71_SEQUENCES.indexOf('run'), 42))).toBe('run');
    expect(name(betaPlayerSequence(BETA66_SEQUENCES.indexOf('crouch_idle'), 41))).toBe('crouch_idle');
  });
  it('leaves other protocols alone and turns unknown numbers into idle', () => {
    expect(betaPlayerSequence(50, 43)).toBe(50);
    expect(name(betaPlayerSequence(500, 41))).toBe('idle1');
  });
});
