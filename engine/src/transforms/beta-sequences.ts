// F4 (2026-11-02): CS beta player animations -> today's CS 1.6 player model, matched by name.
// The betas' player models still use Half-Life's animation list (look_idle, crowbar, python, gauss ...): beta 6.6
// (protocol 41) has 126 animations, beta 7.1 (protocol 42) 144, CS 1.0 92, CS 1.6 111. The lists below are read from
// the Old CS Lab's terror.mdl files (B66, B71, CS11; CS 1.6 = CS 1.1-1.5 plus 16 shield animations at 83).

/** Animation names of the beta 6.6 player model (protocol 41). */
export const BETA66_SEQUENCES = [
  'look_idle', 'idle', 'deep_idle', 'run2', 'walk2handed', '2handshoot', 'crawl', 'crouch_idle', 'jump', 'long_jump',
  'swim', 'treadwater', 'run', 'walk', 'aim_2', 'shoot_2', 'aim_1', 'shoot_1', 'die_simple', 'die_backwards1',
  'die_backwards', 'die_forwards', 'headshot', 'die_spin', 'gutshot', 'ref_aim_crowbar', 'ref_shoot_crowbar',
  'crouch_aim_crowbar', 'crouch_shoot_crowbar', 'ref_aim_trip', 'ref_shoot_trip', 'crouch_aim_trip',
  'crouch_shoot_trip', 'ref_aim_onehanded', 'ref_shoot_onehanded', 'crouch_aim_onehanded', 'crouch_shoot_onehanded',
  'ref_aim_python', 'ref_shoot_python', 'crouch_aim_python', 'crouch_shoot_python', 'ref_aim_shotgun',
  'ref_shoot_shotgun', 'crouch_aim_shotgun', 'crouch_shoot_shotgun', 'ref_aim_gauss', 'ref_shoot_gauss',
  'crouch_aim_gauss', 'crouch_shoot_gauss', 'ref_aim_mp5', 'ref_shoot_mp5', 'crouch_aim_mp5', 'crouch_shoot_mp5',
  'ref_aim_silenced_rifle', 'ref_shoot_silenced_rifle', 'crouch_aim_silenced_rifle', 'crouch_shoot_silenced_rifle',
  'ref_aim_rpg', 'ref_shoot_rpg', 'crouch_aim_rpg', 'crouch_shoot_rpg', 'ref_aim_egon', 'ref_shoot_egon',
  'crouch_aim_egon', 'crouch_shoot_egon', 'ref_aim_squeak', 'ref_shoot_squeak', 'crouch_aim_squeak',
  'crouch_shoot_squeak', 'ref_aim_hive', 'ref_shoot_hive', 'crouch_aim_hive', 'crouch_shoot_hive', 'ref_aim_sniper',
  'ref_shoot_sniper', 'crouch_aim_sniper', 'crouch_shoot_sniper', 'ref_aim_silentsniper', 'ref_shoot_silentsniper',
  'crouch_aim_silentsniper', 'crouch_shoot_silentsniper', 'ref_aim_m249', 'ref_shoot_m249', 'crouch_aim_m249',
  'crouch_shoot_m249', 'ref_aim_tmp', 'ref_shoot_tmp', 'crouch_aim_tmp', 'crouch_shoot_tmp', 'ref_aim_p90',
  'ref_shoot_p90', 'crouch_aim_p90', 'crouch_shoot_p90', 'ref_aim_aug', 'ref_shoot_aug', 'crouch_aim_aug',
  'crouch_shoot_aug', 'deadback', 'deadsitting', 'deadstomach', 'deadtable', 'flinch_head1', 'flinch_rightarm1',
  'flinch_rightleg1', 'flinch_leftleg1', 'flinch_leftarm1', 'flinch_stomach1', 'flinch_crouch1', 'flinch_crouch2',
  'sflinch_head1', 'sflinch_rightarm1', 'sflinch_leftleg1', 'sflinch_rightleg1', 'sflinch_leftarm1',
  'sflinch_stomach1', 'sflinch_stomach2', 'die_head1', 'die_head2', 'die_head3', 'die_rightarm1', 'die_leftarm1',
  'die_leftarm2', 'die_legs1', 'die_legs2', 'die_stomach1', 'die_crouch1',
];

/** Animation names of the beta 7.1 player model (protocol 42). */
export const BETA71_SEQUENCES = [
  'look_idle', 'idle', 'deep_idle', 'run2', 'walk2handed', '2handshoot', 'crawl', 'crouch_idle', 'jump', 'long_jump',
  'swim', 'treadwater', 'run', 'walk', 'aim_2', 'shoot_2', 'aim_1', 'shoot_1', 'die_simple', 'die_backwards1',
  'die_backwards', 'die_forwards', 'headshot', 'die_spin', 'gutshot', 'ref_aim_crowbar', 'ref_shoot_crowbar',
  'crouch_aim_crowbar', 'crouch_shoot_crowbar', 'ref_aim_trip', 'ref_shoot_trip', 'crouch_aim_trip',
  'crouch_shoot_trip', 'ref_aim_onehanded', 'ref_shoot_onehanded', 'crouch_aim_onehanded', 'crouch_shoot_onehanded',
  'ref_aim_shotgun', 'ref_shoot_shotgun', 'crouch_aim_shotgun', 'crouch_shoot_shotgun', 'ref_aim_mp5',
  'ref_shoot_mp5', 'crouch_aim_mp5', 'crouch_shoot_mp5', 'ref_aim_silenced_rifle', 'ref_shoot_silenced_rifle',
  'crouch_aim_silenced_rifle', 'crouch_shoot_silenced_rifle', 'ref_aim_sniper', 'ref_shoot_sniper',
  'crouch_aim_sniper', 'crouch_shoot_sniper', 'ref_aim_silentsniper', 'ref_shoot_silentsniper',
  'crouch_aim_silentsniper', 'crouch_shoot_silentsniper', 'ref_aim_m249', 'ref_shoot_m249', 'crouch_aim_m249',
  'crouch_shoot_m249', 'ref_aim_tmp', 'ref_shoot_tmp', 'crouch_aim_tmp', 'crouch_shoot_tmp', 'ref_aim_p90',
  'ref_shoot_p90', 'crouch_aim_p90', 'crouch_shoot_p90', 'ref_aim_aug', 'ref_shoot_aug', 'crouch_aim_aug',
  'crouch_shoot_aug', 'ref_aim_dualpistols', 'ref_shoot_dualpistols', 'ref_shoot2_dualpistols',
  'crouch_aim_dualpistols', 'crouch_shoot_dualpistols', 'crouch_shoot2_dualpistols', 'reload_dualpistols',
  'reload_aug', 'reload_onehanded', 'reload_tmp', 'reload_m249', 'reload_p90', 'reload_mp5', 'reload_silentsniper',
  'reload_silenced_rifle', 'reload_sniper', 'reload_shotgun', 'run_dualpistols', 'run_aug', 'run_onehanded',
  'run_tmp', 'run_m249', 'run_p90', 'run_mp5', 'run_silentsniper', 'run_sniper', 'run_silenced_rifle', 'run_shotgun',
  'deadback', 'deadsitting', 'deadstomach', 'deadtable', 'flinch_head1', 'flinch_rightarm1', 'flinch_rightleg1',
  'flinch_leftleg1', 'flinch_leftarm1', 'flinch_stomach1', 'flinch_crouch1', 'flinch_crouch2', 'sflinch_head1',
  'sflinch_rightarm1', 'sflinch_leftleg1', 'sflinch_rightleg1', 'sflinch_leftarm1', 'sflinch_stomach1',
  'sflinch_stomach2', 'lflinch_stomach1', 'lflinch_rightarm1', 'lflinch_leftarm1', 'lflinch_head1', 'lflinch_chest1',
  'lflinch_chest2', 'die_head1', 'die_head2', 'die_head3', 'die_head4', 'die_rightarm1', 'die_rightarm2',
  'die_leftarm1', 'die_leftarm2', 'die_leftarm3', 'die_legs1', 'die_legs2', 'die_legs3', 'die_legs4', 'die_stomach1',
  'die_stomach2', 'die_chest1', 'die_chest2', 'die_crouch1',
];

/** Animation names of today's CS 1.6 player model ('' = shield animations, never targets). */
export const CS16_SEQUENCES = [
  'dummy', 'idle1', 'crouch_idle', 'walk', 'run', 'crouchrun', 'jump', 'longjump', 'swim', 'treadwater',
  'crouch_aim_carbine', 'crouch_shoot_carbine', 'crouch_reload_carbine', 'ref_aim_carbine', 'ref_shoot_carbine',
  'ref_reload_carbine', 'crouch_aim_onehanded', 'crouch_shoot_onehanded', 'crouch_reload_onehanded',
  'ref_aim_onehanded', 'ref_shoot_onehanded', 'ref_reload_onehanded', 'crouch_aim_dualpistols',
  'crouch_shoot_dualpistols', 'crouch_shoot2_dualpistols', 'crouch_reload_dualpistols', 'ref_aim_dualpistols',
  'ref_shoot_dualpistols', 'ref_shoot2_dualpistols', 'ref_reload_dualpistols', 'crouch_aim_rifle',
  'crouch_shoot_rifle', 'crouch_reload_rifle', 'ref_aim_rifle', 'ref_shoot_rifle', 'ref_reload_rifle',
  'crouch_aim_mp5', 'crouch_shoot_mp5', 'crouch_reload_mp5', 'ref_aim_mp5', 'ref_shoot_mp5', 'ref_reload_mp5',
  'crouch_aim_shotgun', 'crouch_shoot_shotgun', 'crouch_reload_shotgun', 'ref_aim_shotgun', 'ref_shoot_shotgun',
  'ref_reload_shotgun', 'crouch_aim_m249', 'crouch_shoot_m249', 'crouch_reload_m249', 'ref_aim_m249',
  'ref_shoot_m249', 'ref_reload_m249', 'I_am_a_stupid_placeholder', 'so_am_I', 'ref_aim_grenade',
  'ref_shoot_grenade', 'crouch_aim_grenade', 'crouch_shoot_grenade', 'crouch_aim_c4', 'crouch_shoot_c4',
  'ref_aim_c4', 'ref_shoot_c4', 'ref_reload_c4', 'crouch_aim_dualpistols', 'crouch_shoot_dualpistols',
  'crouch_shoot2_dualpistols', 'crouch_reload_dualpistols', 'ref_aim_dualpistols', 'ref_shoot_dualpistols',
  'ref_shoot2_dualpistols', 'ref_reload_dualpistols', 'crouch_aim_knife', 'crouch_shoot_knife', 'ref_aim_knife',
  'ref_shoot_knife', 'crouch_aim_ak47', 'crouch_shoot_ak47', 'crouch_reload_ak47', 'ref_aim_ak47', 'ref_shoot_ak47',
  'ref_reload_ak47', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'gut_flinch', 'head_flinch',
  'death1', 'death2', 'death3', 'head', 'gutshot', 'left', 'back', 'right', 'forward', 'crouch_die',
];

/** Beta weapon animation groups -> CS 1.6 groups (Half-Life leftovers go to the closest two-handed one). */
const GROUP: Record<string, string> = {
  crowbar: 'knife', trip: 'c4', onehanded: 'onehanded', python: 'onehanded', tmp: 'onehanded', dualpistols: 'dualpistols',
  shotgun: 'shotgun', mp5: 'mp5', p90: 'carbine', aug: 'carbine', silenced_rifle: 'rifle', sniper: 'rifle',
  silentsniper: 'rifle', m249: 'm249', gauss: 'carbine', rpg: 'carbine', egon: 'carbine', squeak: 'grenade', hive: 'carbine',
};

/** Plain (non-weapon) beta animations -> CS 1.6 names. */
const PLAIN: Record<string, string> = {
  look_idle: 'idle1', idle: 'idle1', deep_idle: 'idle1', crouch_idle: 'crouch_idle', walk: 'walk', walk2handed: 'walk',
  run: 'run', run2: 'run', crawl: 'crouchrun', jump: 'jump', long_jump: 'longjump', swim: 'swim', treadwater: 'treadwater',
  '2handshoot': 'ref_shoot_carbine', aim_2: 'ref_aim_carbine', shoot_2: 'ref_shoot_carbine', aim_1: 'ref_aim_onehanded',
  shoot_1: 'ref_shoot_onehanded', die_simple: 'death1', die_backwards1: 'back', die_backwards: 'back', die_forwards: 'forward',
  headshot: 'head', die_spin: 'death2', gutshot: 'gutshot', deadback: 'death1', deadsitting: 'death3', deadstomach: 'forward',
  deadtable: 'back', die_crouch1: 'crouch_die',
};

function cs16Name(beta: string): string {
  if (PLAIN[beta]) return PLAIN[beta];
  let m = /^(ref|crouch)_(aim|shoot2?)_(.+)$/.exec(beta);
  if (m) {
    const g = GROUP[m[3]] ?? 'carbine';
    const shot = m[2] === 'shoot2' && g !== 'dualpistols' ? 'shoot' : m[2];
    // Knife and grenade have aim/shoot only; every group has them.
    return `${m[1]}_${shot}_${g}`;
  }
  m = /^(reload|run)_(.+)$/.exec(beta);
  if (m) {
    // Beta upper-body animations while reloading / running: CS 1.6 reloads per group (none for knife/grenade).
    const g = GROUP[m[2]] ?? 'carbine';
    return m[1] === 'reload' && g !== 'knife' && g !== 'grenade' ? `ref_reload_${g}` : `ref_aim_${g}`;
  }
  if (/head/.test(beta)) return /^die/.test(beta) ? 'head' : 'head_flinch';
  if (/flinch/.test(beta)) return 'gut_flinch';
  if (/^die_rightarm/.test(beta)) return 'right';
  if (/^die_leftarm/.test(beta)) return 'left';
  if (/^die_(stomach|chest)/.test(beta)) return 'gutshot';
  if (/^die_legs/.test(beta)) return 'death3';
  return 'idle1';
}

function table(names: readonly string[]): number[] {
  return names.map((n) => {
    const i = CS16_SEQUENCES.indexOf(cs16Name(n));
    if (i < 0) throw new Error(`No CS 1.6 animation for beta "${n}"`);
    return i;
  });
}

const TABLES: Record<number, number[]> = { 41: table(BETA66_SEQUENCES), 42: table(BETA71_SEQUENCES) };

/** Beta player animation number (protocol 41/42) -> today's CS 1.6 number; unknown numbers become idle. */
export function betaPlayerSequence(sequence: number, protocol: number): number {
  const t = TABLES[protocol];
  if (!t) return sequence;
  return t[sequence] ?? 1;
}

/** For tests and docs: the CS 1.6 animation name chosen for a beta animation name. */
export const betaToCs16Name = cs16Name;
