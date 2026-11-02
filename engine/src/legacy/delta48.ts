// Protocol 48's delta descriptions (field tables), for converting 1999 demos (plan F4): protocol 38-40 demos carry
// none (their layouts were fixed in the engine), so the converter sends these. Values as sent by a CS 1.6 server in a
// protocol-48 demo (exile_csr_d2_ct.dem, Set 3), read with tools/dev/delta-dump.ts on 2026-11-02:
// [name, flags, offset, size, bits, divisor, preMultiplier]. Flags: 1 byte, 2 short, 4 float, 8 integer, 16 angle,
// 32 time window 8, 64 time window big, 0x80000000 signed. The client takes the struct offsets from these records.
import { BitWriter } from '../binary/bits.js';
import { DESCRIPTION_DESCRIPTOR, DeltaDescriptor, type DeltaRecord, type RawValue } from '../protocol/delta.js';
import { Svc } from '../protocol/ids.js';

export type DeltaRow = [name: string, flags: number, offset: number, size: number, bits: number, divisor: number, preMultiplier: number];

const S = 0x80000000;
export const DELTA48: Record<string, DeltaRow[]> = {
  event_t: [
    ['entindex', 8, 4, 1, 10, 1, 1], ['bparam1', 8, 64, 1, 1, 1, 1], ['bparam2', 8, 68, 1, 1, 1, 1],
    ['origin[0]', S | 4, 8, 1, 26, 8192, 1], ['origin[1]', S | 4, 12, 1, 26, 8192, 1], ['origin[2]', S | 4, 16, 1, 26, 8192, 1],
    ['fparam1', S | 4, 48, 1, 20, 100, 1], ['fparam2', S | 4, 52, 1, 20, 100, 1], ['iparam1', S | 8, 56, 1, 18, 1, 1],
    ['iparam2', S | 8, 60, 1, 18, 1, 1], ['angles[0]', S | 4, 20, 1, 26, 8192, 1], ['angles[1]', S | 4, 24, 1, 26, 8192, 1],
    ['angles[2]', S | 4, 28, 1, 26, 8192, 1], ['ducking', 8, 44, 1, 1, 1, 1],
  ],
  weapon_data_t: [
    ['m_flTimeWeaponIdle', S | 4, 16, 1, 22, 1000, 1], ['m_flNextPrimaryAttack', S | 4, 8, 1, 22, 1000, 1],
    ['m_flNextReload', S | 4, 28, 1, 22, 1000, 1], ['m_fNextAimBonus', S | 4, 44, 1, 22, 1000, 1],
    ['m_flNextSecondaryAttack', S | 4, 12, 1, 22, 1000, 1], ['m_iClip', S | 8, 4, 1, 10, 1, 1],
    ['m_flPumpTime', S | 4, 32, 1, 22, 1000, 1], ['m_fInSpecialReload', 8, 24, 1, 2, 1, 1], ['m_fReloadTime', 4, 36, 1, 16, 100, 1],
    ['m_fInReload', 8, 20, 1, 1, 1, 1], ['m_fAimedDamage', 4, 40, 1, 22, 1000, 1], ['m_fInZoom', 8, 48, 1, 8, 1, 1],
    ['m_iWeaponState', 8, 52, 1, 7, 1, 1], ['m_iId', 8, 0, 1, 5, 1, 1], ['fuser1', S | 4, 72, 1, 22, 1000, 1],
    ['fuser2', S | 4, 76, 1, 22, 128, 1], ['fuser3', S | 4, 80, 1, 22, 128, 1], ['iuser1', S | 8, 56, 1, 16, 128, 1],
  ],
  usercmd_t: [
    ['lerp_msec', 2, 0, 1, 9, 1, 1], ['msec', 1, 2, 1, 8, 1, 1], ['viewangles[1]', 16, 8, 1, 16, 1, 1],
    ['viewangles[0]', 16, 4, 1, 16, 1, 1], ['buttons', 2, 30, 1, 16, 1, 1], ['forwardmove', S | 4, 16, 1, 12, 1, 1],
    ['lightlevel', 1, 28, 1, 8, 1, 1], ['sidemove', S | 4, 20, 1, 12, 1, 1], ['upmove', S | 4, 24, 1, 12, 1, 1],
    ['impulse', 1, 32, 1, 8, 1, 1], ['viewangles[2]', 16, 12, 1, 16, 1, 1], ['impact_index', 8, 36, 1, 6, 1, 1],
    ['impact_position[0]', S | 4, 40, 1, 16, 8, 1], ['impact_position[1]', S | 4, 44, 1, 16, 8, 1],
    ['impact_position[2]', S | 4, 48, 1, 16, 8, 1],
  ],
  custom_entity_state_t: [
    ['rendermode', 8, 72, 1, 8, 1, 1], ['origin[0]', S | 4, 16, 1, 17, 8, 1], ['origin[1]', S | 4, 20, 1, 17, 8, 1],
    ['origin[2]', S | 4, 24, 1, 17, 8, 1], ['angles[0]', S | 4, 28, 1, 17, 8, 1], ['angles[1]', S | 4, 32, 1, 17, 8, 1],
    ['angles[2]', S | 4, 36, 1, 17, 8, 1], ['sequence', 8, 44, 1, 16, 1, 1], ['skin', 8, 56, 1, 16, 1, 1],
    ['modelindex', 8, 40, 1, 16, 1, 1], ['scale', 4, 64, 1, 8, 1, 0.1], ['body', 8, 100, 1, 8, 1, 1],
    ['rendercolor.r', 1, 80, 1, 8, 1, 1], ['rendercolor.g', 1, 81, 1, 8, 1, 1], ['rendercolor.b', 1, 82, 1, 8, 1, 1],
    ['renderfx', 8, 84, 1, 8, 1, 1], ['renderamt', 8, 76, 1, 8, 1, 1], ['frame', 4, 48, 1, 8, 1, 1], ['animtime', 4, 92, 1, 8, 1, 0.1],
  ],
  entity_state_player_t: [
    ['animtime', 32, 92, 1, 8, 1, 1], ['frame', 4, 48, 1, 8, 1, 1], ['origin[0]', S | 4, 16, 1, 18, 32, 1],
    ['angles[0]', 16, 28, 1, 16, 1, 1], ['angles[1]', 16, 32, 1, 16, 1, 1], ['origin[1]', S | 4, 20, 1, 18, 32, 1],
    ['origin[2]', S | 4, 24, 1, 18, 32, 1], ['gaitsequence', 8, 184, 1, 8, 1, 1], ['sequence', 8, 44, 1, 8, 1, 1],
    ['modelindex', 8, 40, 1, 10, 1, 1], ['movetype', 8, 88, 1, 4, 1, 1], ['solid', 2, 58, 1, 3, 1, 1],
    ['mins[0]', S | 4, 124, 1, 16, 8, 1], ['mins[1]', S | 4, 128, 1, 16, 8, 1], ['mins[2]', S | 4, 132, 1, 16, 8, 1],
    ['maxs[0]', S | 4, 136, 1, 16, 8, 1], ['maxs[1]', S | 4, 140, 1, 16, 8, 1], ['maxs[2]', S | 4, 144, 1, 16, 8, 1],
    ['weaponmodel', 8, 180, 1, 10, 1, 1], ['owner', 8, 152, 1, 5, 1, 1], ['effects', 8, 60, 1, 8, 1, 1],
    ['angles[2]', 16, 36, 1, 16, 1, 1], ['colormap', 8, 52, 1, 16, 1, 1], ['framerate', S | 4, 96, 1, 8, 16, 1],
    ['skin', S | 2, 56, 1, 9, 1, 1], ['controller[0]', 1, 104, 1, 8, 1, 1], ['controller[1]', 1, 105, 1, 8, 1, 1],
    ['controller[2]', 1, 106, 1, 8, 1, 1], ['controller[3]', 1, 107, 1, 8, 1, 1], ['blending[0]', 1, 108, 1, 8, 1, 1],
    ['blending[1]', 1, 109, 1, 8, 1, 1], ['body', 8, 100, 1, 8, 1, 1], ['rendermode', 8, 72, 1, 8, 1, 1],
    ['renderamt', 8, 76, 1, 8, 1, 1], ['renderfx', 8, 84, 1, 8, 1, 1], ['scale', 4, 64, 1, 16, 256, 1],
    ['rendercolor.r', 1, 80, 1, 8, 1, 1], ['rendercolor.g', 1, 81, 1, 8, 1, 1], ['rendercolor.b', 1, 82, 1, 8, 1, 1],
    ['friction', S | 4, 156, 1, 16, 8, 1], ['usehull', 8, 200, 1, 1, 1, 1], ['gravity', S | 4, 160, 1, 16, 32, 1],
    ['aiment', 8, 148, 1, 11, 1, 1], ['basevelocity[0]', S | 4, 188, 1, 16, 8, 1], ['basevelocity[1]', S | 4, 192, 1, 16, 8, 1],
    ['basevelocity[2]', S | 4, 196, 1, 16, 8, 1], ['spectator', 8, 176, 1, 1, 1, 1], ['iuser4', 8, 272, 1, 2, 1, 1],
  ],
  entity_state_t: [
    ['animtime', 32, 92, 1, 8, 1, 1], ['frame', 4, 48, 1, 8, 1, 1], ['origin[0]', S | 4, 16, 1, 16, 8, 1],
    ['angles[0]', 16, 28, 1, 16, 1, 1], ['angles[1]', 16, 32, 1, 16, 1, 1], ['origin[1]', S | 4, 20, 1, 16, 8, 1],
    ['origin[2]', S | 4, 24, 1, 16, 8, 1], ['sequence', 8, 44, 1, 8, 1, 1], ['modelindex', 8, 40, 1, 10, 1, 1],
    ['movetype', 8, 88, 1, 4, 1, 1], ['solid', 2, 58, 1, 3, 1, 1], ['mins[0]', S | 4, 124, 1, 16, 8, 1],
    ['mins[1]', S | 4, 128, 1, 16, 8, 1], ['mins[2]', S | 4, 132, 1, 16, 8, 1], ['maxs[0]', S | 4, 136, 1, 16, 8, 1],
    ['maxs[1]', S | 4, 140, 1, 16, 8, 1], ['maxs[2]', S | 4, 144, 1, 16, 8, 1], ['endpos[0]', S | 4, 240, 1, 13, 1, 1],
    ['endpos[1]', S | 4, 244, 1, 13, 1, 1], ['endpos[2]', S | 4, 248, 1, 13, 1, 1], ['startpos[0]', S | 4, 228, 1, 13, 1, 1],
    ['startpos[1]', S | 4, 232, 1, 13, 1, 1], ['startpos[2]', S | 4, 236, 1, 13, 1, 1], ['impacttime', 64, 252, 1, 13, 100, 1],
    ['starttime', 64, 256, 1, 13, 100, 1], ['weaponmodel', 8, 180, 1, 10, 1, 1], ['owner', 8, 152, 1, 5, 1, 1],
    ['effects', 8, 60, 1, 8, 1, 1], ['eflags', 8, 68, 1, 1, 1, 1], ['angles[2]', 16, 36, 1, 16, 1, 1],
    ['colormap', 8, 52, 1, 16, 1, 1], ['framerate', S | 4, 96, 1, 8, 16, 1], ['skin', S | 2, 56, 1, 9, 1, 1],
    ['controller[0]', 1, 104, 1, 8, 1, 1], ['controller[1]', 1, 105, 1, 8, 1, 1], ['controller[2]', 1, 106, 1, 8, 1, 1],
    ['controller[3]', 1, 107, 1, 8, 1, 1], ['blending[0]', 1, 108, 1, 8, 1, 1], ['blending[1]', 1, 109, 1, 8, 1, 1],
    ['body', 8, 100, 1, 8, 1, 1], ['rendermode', 8, 72, 1, 8, 1, 1], ['renderamt', 8, 76, 1, 8, 1, 1],
    ['renderfx', 8, 84, 1, 8, 1, 1], ['scale', 4, 64, 1, 16, 256, 1], ['rendercolor.r', 1, 80, 1, 8, 1, 1],
    ['rendercolor.g', 1, 81, 1, 8, 1, 1], ['rendercolor.b', 1, 82, 1, 8, 1, 1], ['aiment', 8, 148, 1, 11, 1, 1],
    ['basevelocity[0]', S | 4, 188, 1, 16, 8, 1], ['basevelocity[1]', S | 4, 192, 1, 16, 8, 1],
    ['basevelocity[2]', S | 4, 196, 1, 16, 8, 1], ['iuser4', 8, 272, 1, 2, 1, 1],
  ],
  clientdata_t: [
    ['flTimeStepSound', 8, 76, 1, 10, 1, 1], ['origin[0]', S | 4, 0, 1, 21, 128, 1], ['origin[1]', S | 4, 4, 1, 21, 128, 1],
    ['velocity[0]', S | 4, 12, 1, 16, 8, 1], ['velocity[1]', S | 4, 16, 1, 16, 8, 1], ['m_flNextAttack', S | 4, 124, 1, 22, 1000, 1],
    ['origin[2]', S | 4, 8, 1, 21, 128, 1], ['velocity[2]', S | 4, 20, 1, 16, 8, 1], ['ammo_nails', S | 8, 112, 1, 10, 1, 1],
    ['ammo_shells', S | 8, 108, 1, 10, 1, 1], ['ammo_cells', S | 8, 116, 1, 10, 1, 1], ['ammo_rockets', S | 8, 120, 1, 10, 1, 1],
    ['m_iId', 8, 104, 1, 5, 1, 1], ['punchangle[2]', S | 4, 36, 1, 21, 8, 1], ['flags', 8, 40, 1, 32, 1, 1],
    ['weaponanim', 8, 100, 1, 8, 1, 1], ['health', S | 4, 64, 1, 10, 1, 1], ['maxspeed', 4, 92, 1, 16, 10, 1],
    ['flDuckTime', 8, 80, 1, 10, 1, 1], ['view_ofs[2]', S | 4, 60, 1, 10, 4, 1], ['punchangle[0]', S | 4, 28, 1, 26, 8192, 1],
    ['punchangle[1]', S | 4, 32, 1, 26, 8192, 1], ['viewmodel', 8, 24, 1, 10, 1, 1], ['weapons', 8, 72, 1, 32, 1, 1],
    ['pushmsec', 8, 132, 1, 11, 1, 1], ['deadflag', 8, 136, 1, 3, 1, 1], ['fov', 4, 96, 1, 8, 1, 1],
    ['physinfo', 128, 140, 1, 1, 1, 1], ['bInDuck', 8, 68, 1, 1, 1, 1], ['flSwimTime', 8, 84, 1, 10, 1, 1],
    ['waterjumptime', 8, 88, 1, 15, 1, 1], ['waterlevel', 8, 44, 1, 2, 1, 1], ['iuser1', 8, 396, 1, 3, 1, 1],
    ['iuser2', 8, 400, 1, 5, 1, 1], ['iuser3', 8, 404, 1, 8, 1, 1], ['iuser4', 8, 408, 1, 2, 1, 1],
    ['vuser2[0]', 4, 440, 1, 9, 1, 1], ['vuser2[1]', 4, 444, 1, 9, 1, 1], ['vuser2[2]', 4, 448, 1, 9, 1, 1],
    ['vuser3[0]', 4, 452, 1, 9, 1, 1], ['vuser3[1]', 4, 456, 1, 9, 1, 1], ['vuser3[2]', 4, 460, 1, 9, 1, 1],
    ['vuser4[0]', 4, 464, 1, 9, 1, 1], ['vuser4[1]', 4, 468, 1, 9, 1, 1], ['fuser2', 4, 416, 1, 14, 1, 1],
  ],
};

/** The decoders/encoders for protocol 48 (same objects the protocol-48 reader builds from svc_deltadescription). */
export function descriptors48(): Map<string, DeltaDescriptor> {
  const out = new Map<string, DeltaDescriptor>();
  for (const [name, rows] of Object.entries(DELTA48)) {
    out.set(name, new DeltaDescriptor(name, rows.map(([n, flags, , , bits, divisor]) => DeltaDescriptor.field(n, bits, divisor, flags >>> 0))));
  }
  return out;
}

/** svc_deltadescription messages for every table (id byte included), each field sent in full. */
export function encodeDeltaDescriptions48(): Uint8Array[] {
  const D = DESCRIPTION_DESCRIPTOR;
  return Object.entries(DELTA48).map(([name, rows]) => {
    const w = new BitWriter();
    w.u8(Svc.DeltaDescription);
    w.string(name);
    w.bits(rows.length, 16);
    for (const [n, flags, offset, size, bits, divisor, pre] of rows) {
      const values: RawValue[] = [
        { negative: false, magnitude: flags >>> 0 },
        { text: n },
        { negative: false, magnitude: offset },
        { negative: false, magnitude: size },
        { negative: false, magnitude: bits },
        { negative: false, magnitude: Math.round(divisor * 4000) },
        { negative: false, magnitude: Math.round(pre * 4000) },
      ];
      D.encode(w, { mask: Uint8Array.of(0x7f), values });
    }
    w.alignToByte();
    return w.finish();
  });
}

/** Raw (encoded) value of a field: what the client reads back. Angles are fractions of 360 degrees. */
function raw(d: DeltaDescriptor, i: number, value: number): RawValue {
  const f = d.fields[i];
  const max = 2 ** (f.signed ? f.bits - 1 : f.bits) - 1;
  if (f.kind === 'angle') {
    const turn = 2 ** f.bits;
    return { negative: false, magnitude: (((Math.round((value * turn) / 360) % turn) + turn) % turn) };
  }
  const m = Math.min(max, Math.round(Math.abs(value) * f.divisor));
  return { negative: f.signed && value < 0 && m > 0, magnitude: f.signed || value >= 0 ? m : 0 };
}

/** Field values by name (e.g. "origin[0]"). */
export type Values48 = Record<string, number>;

/**
 * A delta record holding every field of `values` whose encoded value differs from `base` (the client's starting
 * state: a baseline, or zeros). Unknown names are ignored.
 */
export function deltaRecord(d: DeltaDescriptor, values: Values48, base: Values48 = {}): DeltaRecord {
  const vals: (RawValue | undefined)[] = [];
  let top = -1;
  d.fields.forEach((f, i) => {
    if (!(f.name in values)) return;
    const now = raw(d, i, values[f.name]);
    const was = raw(d, i, base[f.name] ?? 0);
    if ('magnitude' in now && 'magnitude' in was && now.magnitude === was.magnitude && now.negative === was.negative) return;
    vals[i] = now;
    top = i;
  });
  const mask = new Uint8Array(top < 0 ? 0 : (top >> 3) + 1);
  vals.forEach((v, i) => { if (v) mask[i >> 3] |= 1 << (i & 7); });
  return { mask, values: vals };
}
