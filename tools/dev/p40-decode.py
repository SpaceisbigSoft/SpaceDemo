# Protocol 38-40 (Half-Life 1.0.0.9-1.0.1.0 / 1.0.1.3 / 1.0.1.6, 1999) + demo format 4: test decoder (Claude, 2026-11-02, plan F4).
# Walks every message of a 1999 demo and counts them; facts from the decompiled HL 1.0.1.6 engine (see docs/FORMAT.md).
# Usage: python3 -I tools/dev/p40-decode.py <demo.dem> ...  (protocol 38: movevars has one more byte; narrower playerinfo)
import struct, sys, collections
TE = {0: 24, 1: 20, 2: 6, 3: 11, 4: 6, 5: 10, 6: 12, 7: 17, 8: 16, 9: 6, 10: 6, 11: 6, 12: 8, 14: 9, 15: 19, 16: 0,
      17: 10, 18: 16, 19: 24, 20: 24, 21: 24, 22: 10, 23: 11, 24: 16, 25: 19, 26: 0, 27: 12, 28: 16, 30: 17, 31: 17,
      99: 2, 100: 10, 101: 14, 102: 12, 103: 14, 104: 9, 105: 5, 106: 17, 107: 13, 108: 24, 109: 9, 110: 17, 111: 7,
      112: 10, 113: 19, 114: 19, 115: 12, 116: 7, 117: 7, 118: 9, 119: 16, 120: 18, 121: 5, 122: 10, 123: 9, 124: 7, 125: 1, 126: 18, 127: 15}
NAMES = "bad nop disconnect updatestat version setview sound time print stufftext setangle serverinfo lightstyle updateuserinfo updatefrags clientdata stopsound updatecolors particle damage spawnstatic spawnbinary spawnbaseline temp_entity setpause signonnum centerprint killedmonster foundsecret spawnstaticsound intermission finale cdtrack restore cutscene weaponanim decalname roomtype addangle newusermsg download packetentities deltapacketentities playerinfo choke resourcelist newmovevars nextupload resourcerequest customization crosshairangle soundfade clientmaxspeed skippedupdate".split()
class R:
    def __init__(s, d): s.d = d; s.p = 0; s.bit = None
    def u8(s): v = s.d[s.p]; s.p += 1; return v
    def i8(s): v = struct.unpack_from('<b', s.d, s.p)[0]; s.p += 1; return v
    def i16(s): v = struct.unpack_from('<h', s.d, s.p)[0]; s.p += 2; return v
    def u16(s): v = struct.unpack_from('<H', s.d, s.p)[0]; s.p += 2; return v
    def i32(s): v = struct.unpack_from('<i', s.d, s.p)[0]; s.p += 4; return v
    def f32(s): v = struct.unpack_from('<f', s.d, s.p)[0]; s.p += 4; return v
    def str(s):
        e = s.d.index(0, s.p); v = s.d[s.p:e].decode('latin1'); s.p = e + 1; return v
    def skip(s, n): s.p += n
    # bits: MSB-first; StartBits consumes the current byte
    def start(s): s.bp = s.p; s.bi = 0; s.p += 1
    def bits(s, n):
        v = 0
        for _ in range(n):
            if s.bi == 8: s.bi = 0; s.bp += 1; s.p += 1
            if s.bp >= len(s.d): raise EOFError('bits past end')
            v = (v << 1) | ((s.d[s.bp] >> (7 - s.bi)) & 1); s.bi += 1
        return v
    def sbits(s, n): neg = s.bits(1); v = s.bits(n - 1); return -v if neg else v
    def peek32(s):
        save = (s.bp, s.bi, s.p); v = s.bits(32); s.bp, s.bi, s.p = save; return v
    def end(s): pass  # p already points after the last started byte
def delta_usercmd(r):  # MSG_ReadDeltaUsercmd (10067360)
    f = r.bits(8)
    if f & 1: r.bits(10)          # pitch
    if f & 2: r.bits(10)          # yaw
    if f & 4: r.bits(6)           # roll
    for b in (8, 0x10, 0x20):     # forward/side/up move
        if f & b: r.sbits(8)
    if f & 0x40: r.bits(16)       # buttons
    if f & 0x80: r.bits(8)        # impulse
    r.bits(6); r.bits(8)          # lightlevel?, msec
def playerinfo(r, F):
    f = r.u8()
    if f & 0x80: f |= r.u8() << 8
    if f & 0x8000: f |= r.u8() << 16
    if f & 0x800000: f |= r.u8() << 24
    r.start(); num = r.bits(6) & 0x3f; r.bits(5); P38 = F.get('proto') == 38
    o = [r.sbits(16) / 8 for _ in range(3)] if P38 else [r.sbits(18) / 32 for _ in range(3)]; r.bits(8)
    if f & 0x1: delta_usercmd(r)
    if f & 0x10: r.bits(8)
    vb = 9 if P38 else 14  # protocol 38: 9 bits × 4
    if f & 0x20: r.sbits(vb); r.sbits(vb)
    if f & 0x400: r.sbits(vb)
    if f & 0x100: r.bits(10)
    elif f & 0x2: r.bits(8)
    if f & 0x1000000: r.bits(8)
    if f & 0x1000: r.bits(8)
    if f & 0x200: r.bits(10)
    elif f & 0x40: r.bits(8)
    if f & 0x10000000: r.bits(4)
    if f & 0x4: r.bits(8); r.bits(8)
    if f & 0x4000000: [r.bits(8) for _ in range(6)]
    if f & 0x2000: r.bits(8)
    if f & 0x400000: r.bits(8)
    for b in (0x10000, 0x20000, 0x40000, 0x80000, 0x100000, 0x200000):
        if f & b: r.bits(8)
    if f & 0x4000: [r.sbits(16) for _ in range(3)]
    if f & 0x2000000: r.sbits(16)
    if f & 0x800: r.bits(12); r.bits(6)
    if f & 0x8: r.bits(8)
    F['players'][num] = o
def ent_header(r):
    f = r.bits(8)
    if f & 1: f |= r.bits(8) << 8
    if f & 0x100: f |= r.bits(8) << 16
    if f & 0x800000: f |= r.bits(8) << 24
    more = r.bits(8) if f & 0x80000000 else 0
    num = r.bits(10) if f & 0x8000 else r.bits(8)
    return f, more, num
def parse_delta(r, f, more):
    if f & 0x800: r.bits(10) if r.bits(1) == 1 else r.bits(8)
    if f & 0x80: r.bits(8)
    if f & 0x40: r.bits(4)
    if f & 0x40000: r.bits(16)
    if f & 0x80000: r.bits(8); r.bits(3)
    if f & 0x40000000: r.bits(16)
    if f & 0x4000: r.bits(8)
    if f & 2: r.sbits(16)
    if f & 0x200: r.bits(11)
    if f & 4: r.sbits(16)
    if f & 0x20: r.bits(13)
    if f & 8: r.sbits(16)
    if f & 0x400: r.bits(11)
    if f & 0x1000: r.bits(8); r.bits(8)
    if f & 0x10000: r.sbits(8)
    for b in (0x1000000, 0x2000000, 0x4000000, 0x8000000, 0x10000000, 0x20000000):
        if f & b: r.bits(8)
    if f & 0x400000: r.bits(8)
    if f & 0x100000: [r.bits(8) for _ in range(6)]
    for b in (1, 2, 4, 8, 0x10, 0x20):
        if more & b: r.sbits(16)
    if more & 0x40: r.bits(10)
def packetentities(r, delta, F):
    r.i16()
    if delta: r.u8()
    r.start()
    while True:
        if r.peek32() == 0: r.bits(32); break
        f, more, num = ent_header(r)
        F['ents'] += 1
        if f & 0x10: continue
        if f & 0x2000: raise NotImplementedError('beam delta')
        parse_delta(r, f, more)
def clientdata(r):
    b = r.u16()
    if b & 1: r.i8()
    if b & 2: r.i8()
    for i in range(3):
        if b & (4 << i): r.i16()
        if b & (0x20 << i): r.i8()
    if b & 0x100: r.i32()
    if b & 0x200: r.i16()
    r.i16()
def sound(r):
    r.start(); f = r.bits(9)
    if f & 1: r.bits(8)
    if f & 2: r.bits(8)
    r.bits(3); r.bits(10)
    r.bits(16) if f & 4 else r.bits(8)
    [r.sbits(16) for _ in range(3)]
    if f & 8: r.bits(8)
def baseline(r):
    r.i16(); a = r.u8(); r.i16(); r.u8(); r.u8()
    if a == 0: r.u16()
    else: r.u8()
    r.u16(); r.i16(); r.u8()
    for _ in range(3): r.i16(); r.f32(); r.i16(); r.i16()
    r.skip(6)
def decode(data, S, F):
    r = R(data); last = []
    while r.p < len(data):
        start = r.p; mid = r.u8(); name = NAMES[mid] if mid < len(NAMES) else S['um'].get(mid, (f'user{mid}', None))[0]
        last.append(name)
        try:
            if mid == 1: pass
            elif mid == 3: r.u8(); r.i32()
            elif mid == 4: r.i32()
            elif mid == 5: r.i16()
            elif mid == 6: sound(r)
            elif mid == 7: r.f32()
            elif mid in (8, 9, 26): r.str()
            elif mid == 10: r.skip(6)
            elif mid == 11:
                r.i32(); r.i32(); r.i32(); r.i32(); S['maxclients'] = r.u8(); r.u8(); r.u8(); r.str(); r.str(); r.str()
            elif mid == 12: r.u8(); r.str()
            elif mid == 13: r.u8(); r.i32(); r.str()
            elif mid == 15: clientdata(r)
            elif mid == 16: r.i16()
            elif mid == 18: r.skip(6 + 3 + 2)
            elif mid == 20: baseline_static = baseline(r)  # spawnstatic: same body without the entity number?
            elif mid == 22: baseline(r)
            elif mid == 23:
                t = r.u8()
                if t == 13:  # TE_BSPDECAL: 3 coords, texture, entity, model if entity != 0
                    r.skip(6); r.i16(); e = r.i16()
                    if e: r.i16()
                elif t == 29:  # TE_TEXTMESSAGE
                    r.u8(); r.skip(4); e = r.u8(); r.skip(6); r.skip(4 if e != 2 else 6); r.skip(4); r.str()
                elif t in TE: r.skip(TE[t])
                else: raise ValueError(f'temp entity {t}')
            elif mid in (24, 25): r.u8()
            elif mid == 29: r.skip(6); r.i16(); r.u8(); r.u8(); r.i16(); r.u8(); r.u8()
            elif mid in (30,): pass
            elif mid == 31: r.str()
            elif mid == 32: r.u8(); r.u8()
            elif mid in (33, 34): r.str()
            elif mid == 35: r.u8(); r.u8()
            elif mid == 36: r.u8(); r.str()
            elif mid == 37: r.i16()
            elif mid == 38: r.i16()
            elif mid == 39:
                i = r.u8(); sz = r.u8(); nm = r.d[r.p:r.p + 16].split(b'\0')[0].decode('latin1'); r.skip(16)
                S['um'][i] = (nm, -1 if sz == 255 else sz)
            elif mid in (41, 42): packetentities(r, mid == 42, F)
            elif mid == 43: playerinfo(r, F)
            elif mid == 44: pass
            elif mid == 45:
                r.i16(); a = r.i16(); b = r.i16()
                for _ in range(b - a):
                    r.u8(); r.str(); r.i16(); r.i32(); fl = r.u8()
                    if fl & 4: r.skip(16)
            elif mid == 46:
                if S.get('proto') == 38: r.u8()  # protocol 38: one more byte first
                r.skip(16 * 4); r.str()
            elif mid == 48: r.i32(); r.i32()
            elif mid == 50: r.i8(); r.i8()
            elif mid == 51: r.skip(4)
            elif mid == 52: r.u8(); r.f32()
            elif mid == 53: r.u8()
            elif mid > 53:
                nm, sz = S['um'][mid]
                r.skip(r.u8() if sz == -1 else sz)
            else: raise ValueError(f'message {mid} {name} not handled')
        except Exception as e:
            raise RuntimeError(f'{type(e).__name__}: {e} in {name} at byte {start}; last: {" ".join(last[-6:])}; bytes {data[start:start+40].hex(" ")}')
        F['msgs'][name] += 1
def walk(fn):
    b = open(fn, 'rb').read(); hdr = 280 if b[144:149] in (b'valve', b'cstri') and struct.unpack_from('<i', b, 12)[0] == 38 else 544
    dirp = struct.unpack_from('<I', b, hdr - 4)[0]; p = hdr; S = {'um': {}, 'proto': struct.unpack_from('<i', b, 12)[0]}; F = {'msgs': collections.Counter(), 'players': {}, 'ents': 0, 'proto': S['proto']}
    types = collections.Counter(); n = 0
    SIZES = {2: 0, 3: 28, 4: 0, 5: 64, 6: 64, 8: 0}  # 5 = console command
    while p < dirp:
        t = b[p]; p += 9; types[t] += 1
        if t in (0, 1):
            L = struct.unpack_from('<I', b, p + 24)[0]; data = b[p + 28 + 8:p + 28 + L]; p += 28 + L; n += 1
            try: decode(data, S, F)
            except Exception as e: print(fn, f'net frame {n}:', e); break
        elif t in SIZES: p += SIZES[t]
        else: print(fn, 'unknown frame type', t, 'at', p - 9, b[p - 9:p + 40].hex(' ')); break
    print(fn, 'frame types', dict(sorted(types.items())), 'net frames', n, 'entity updates', F['ents'])
    print('  messages:', dict(F['msgs'].most_common()))
for fn in sys.argv[1:]: walk(fn)
