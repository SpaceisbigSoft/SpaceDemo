# GoldSrc demo format notes

Facts used by the engine, in our own words, with where each came from. "Measured" means verified by our tests on
real demos (CS 1.5, protocol 46, 25 demos) or on the owner's CS 1.6 build 10210.

## File layout
- Header (544 bytes): magic `HLDEMO` (8), demo protocol (u32, = 5), network protocol (u32), map name (260),
  game directory (260), map checksum (u32), directory offset (u32). *Source: talent demo-structure notes; measured.*
- Directory at the directory offset: entry count (u32, 1–1024), then 92-byte entries: type, description (64),
  flags, CD track, track time (f32), frame count, offset, length. Normally two entries: `LOADING` and `Playback`.
  *Source: talent notes; measured.*
- A directory offset of 0 means the game closed or crashed while recording; the frames are usually intact.
- **A section may contain several end-of-section frames** (left over from map changes during recording), so a
  section must be read up to its directory length, not to the first end marker. *Measured (several Set 1 demos).*
- Frame header: type (u8), time (f32), engine frame counter (u32). Frame types and payload sizes:
  0/1 network messages (info block + u32 length + data); 2 demo start (0); 3 console command (64);
  4 client data (32); 5 end of section (0); 6 event (84); 7 weapon animation (8);
  8 sound (24 + name length, the length is the second i32); 9 demo buffer (4 + length).
  *Source: talent notes, cross-checked against COL's reader; measured.*
- Network message info block: 464 bytes for protocol 44+ (436 view info + 28 sequence info). *Measured.*
  Protocol ≤ 43 is believed to use 560 bytes (from COL; not yet verified).

## Network messages
- Message ids 1–58 are engine messages (see `engine/src/protocol/ids.ts`); 64+ are game ("user") messages defined
  by `svc_newusermsg` (id, size or −1 = sized by first byte, 16-byte name).
- Bit order inside messages is least-significant-bit first. Several messages (entities, client data, events,
  sound, pings, delta descriptions, resource list) are bit-packed and end on a byte boundary.
- Delta compression: `svc_deltadescription` defines named structures (field name, bit count, divisor, flags).
  A delta is a 3-bit mask-byte count, mask bytes, then each flagged field: signed numbers as sign bit + (n−1) bits,
  unsigned as n bits, angles as n bits, strings null-terminated. *Measured: every delta in Set 1 re-encodes
  bit-identically.*
- Voice: `svc_voiceinit` = codec name (+ quality byte from protocol 47); `svc_voicedata` = player slot (u8),
  length (u16), data. Old demos use `voice_miles`; the recorder's own packets are empty. *Measured.*

## Protocol 46 (CS 1.4/1.5) vs 48 (CS 1.6 today)
What the upgrade changes, and why:
| Change | Reason | Source |
|---|---|---|
| Header and `svc_serverinfo` protocol → 48 | Current engine refuses other protocols ("Server is protocol … instead of 48") | Baseline test 2026-10-25 |
| `svc_serverinfo` extra block (flag + 21 bytes) → single 0 byte | Layout differs in 48 | COL behaviour (reference), to be confirmed in testing |
| `svc_voiceinit` gains a quality byte | Field added in protocol 47 | COL notes; measured layout difference |
| `svc_clientdata` weapon index 5 → 6 bits | More weapon slots in 1.6 | COL behaviour (reference) |
| Player animation numbers ≥ 83 → +16 | CS 1.6 player model inserted shield animations | COL behaviour (reference) |
| Resource list: drop files the game no longer has; drop consistency list | Missing files would stop loading | Measured on build 10210: 24 old scope sprites are gone |
| `SendAudio` gains a pitch (2 bytes, 100) | 1.6 client reads a pitch | COL behaviour (reference) |
| Remove `CDChallenge`/`CDSalt` (Cheating-Death) | Unknown to current clients | COL behaviour (reference) |
| Remove `svc_hltv` command 2 (multicast) | Not understood by current clients | COL behaviour (reference) |
| Old HLTV demos: add director "start" + "first person" | Spectator HUD otherwise not initialised | COL behaviour (reference) |
| Keep only the last map load in the loading section | Fixes demos that load the wrong map | SK Player/COL notes; measured (MoD train: 114 frames of an earlier map) |

## Protocol 47 (2003–2007 Steam CS 1.6) vs 48 (checked on Set 3, 2026-10-31)
Protocol 47 demos (server builds 2827–3651 in Set 3) are already CS 1.6: they register the same 82 game messages as
today's 48 (CS 1.5 had 57), `SendAudio` already carries a pitch, `svc_voiceinit` already has its quality byte, the
weapon index in `svc_clientdata` is already 6 bits and the player model already has the shield animations. The upgrade
only writes protocol 48 into the header and `svc_serverinfo`, replaces the server info's extra block (flag 1 + 21
bytes, as in 46) with a single 0, and drops the resource consistency list (plus files the game no longer has).
Kills, rounds and chat read the same before and after on all 12 tried (POV + HLTV, builds 2827–4352).

## Speex voice (`voice_speex`, CS 1.6 era)
Narrowband Speex, 8 kHz, 20 ms frames of 160 samples. GoldSrc writes whole frames back to back in each voice packet
(no header), all the same size, set by the voice quality in `svc_voiceinit`: Valve's encoder uses Speex quality 2, 3,
4, 6, 8 for voice quality 1–5 → frames of 15, 15, 20, 28, 38 bytes. Measured on Set 3: quality 5 → 38-byte frames,
quality 3 (fta-talent_playoffs_t) → 20-byte frames; packets hold 1–4 frames; no damaged frames when decoded per player
slot in demo order. SpaceDemo decodes it with the official Xiph decoder built to WebAssembly (`helpers/speex/`) and puts
it back as Steam voice like the old Miles voice.

## Map checksum
CRC-32 of all BSP lumps except entities (bshift: except lump 1), in lump order, **without** the final inversion.
*Source: ReHLDS `crc.cpp` (algorithm); measured against the owner's maps.*

## Voice in today's CS 1.6 (build 10210) — Steam voice
*Measured from `voicetest.dem` (owner, build 10210, `voice_loopback 1`): 158 packets, all checksums valid, all rebuild
byte-identically.*
- `svc_voiceinit`: empty codec name and quality 0 → Steam voice.
- `svc_voicedata` payload:
  `SteamID (u64)` · chunks · `CRC-32 (u32)` of everything before it.
  - `0x0B` sample rate (u16) — 24000 in every packet seen.
  - `0x00` silence: number of silent samples (u16), e.g. 1500.
  - `0x06` Opus frames: byte length (u16), then frames of `[length u16][sequence u16][Opus packet]`; a lone `0xFFFF`
    ends a talk burst. Frames are 20 ms; TOC byte 0x68 (SILK wideband, 20 ms, mono).
  - A packet may contain several chunks in any order (e.g. Opus, silence, Opus).
- Old demos' Miles (Voxware) voice cannot be played by this path, which explains "talking icon but no sound".

## Old voice: `voice_miles` (CS 1.0–1.5 era) — Voxware MetaVoice VR12
*Measured 2026-10-25 on Set 1 (`modCTside.dem`, protocol 46) by decoding with the owner's `mssvoice.asi`
(Miles Sound System plugin, PE timestamp 1353973871) in an emulator — see `tools/dev/miles-emu/`.*
- `mssvoice.asi` registers three codecs: VR12 encoder, **VR12 decoder** (input `.V12 files`, wave tag 0x77, maximum
  frame size 6 bytes) and RT24 decoder (`.V24 files`, wave tag 0x74, 7 bytes). The RT29 name is in the file but not
  registered.
- **`voice_miles` packets are VR12.** Evidence: VR12 output has normal speech levels and a speech recogniser
  (pocketsphinx) finds English phrases in it; RT24 output is clipped noise and random input gives no words.
- `svc_voicedata` payload = raw VR12 bytes, no header. Packet sizes 12 / 24 / 36 bytes; each 12 bytes decode to
  360 samples at 8 kHz, 16-bit mono (45 ms). Measured arrival rate while talking ≈ 250 bytes/s, matching 12 bytes per
  45 ms (≈ 267 bytes/s) with network jitter.
- Use one decoder per player and feed that player's packets in order (the codec keeps state between frames).
- The recorder's own slot sends 0-byte packets (nothing to decode).

## Putting old voice back (route A)
`tools/voice-transcode-test.ts`: each player's talk burst (packets ≤ 0.3 s apart) is resampled 8 → 24 kHz and
encoded with Opus (voice mode, 24 kbit/s, 20 ms frames). The Opus frames are shared over the burst's original packets
in step with the audio each one carried; the last packet ends the burst (0xFFFF). Sequence numbers run on per player.
On `modCTside`: 314 bursts, 8,366 packets, 20,517 frames (410 s); playback queue lag median 0.036 s, worst 0.225 s.
- Same result with the 2002-era decoder: Half-Life 1.1.1.0's `Mssv12.asi` (Miles 6.0m, built 2000-11-13) decodes the
  Set 1 voice bit-identically to the 2012 `mssvoice.asi` (with Windows' FPU settings). In 2002, `voice_miles.dll`
  (2001-05-08) loaded `Mss32.dll` + `Mssv12.asi`; the 2002 engine (`hw.dll`) did not load Miles itself.

## Match information in CS 1.5 demos (spike 1.8, checked on Set 1)
Game ("user") messages, CS 1.5 layouts as found in the demos (sizes: -1 = sized by first byte):
- `DeathMsg` (-1): killer entity u8, victim entity u8, **headshot u8**, weapon string ("world" = fall/suicide). Entity = slot + 1.
- `ScoreInfo` (9): entity u8, frags i16, deaths i16, class i16, team i16 (1 T, 2 CT).
- `ScoreAttrib` (2): entity u8, flags u8 (1 dead, 2 bomb, 4 VIP). `TeamInfo` (-1): entity u8, team string.
- `TeamScore` (-1): team string, score i16. `RoundTime` (2): seconds i16 (freeze time at round start, then round length).
- `TextMsg` (-1): destination u8, message string (`#CTs_Win`, `#Terrorists_Win`, `#Target_Bombed`, `#Bomb_Defused`,
  `#Target_Saved`, `#Round_Draw`, `#Bomb_Planted`, `#Game_will_restart_in` + seconds, `#Game_Commencing`, …), up to 4 strings.
- `SayText` (-1): sender u8, text (CS 1.5: one preformatted string, e.g. "\x02(Counter-Terrorist) name :    text"). HLTV demos also
  carry spectator/HLTV chat ("<name> text").
- `SendAudio` (-1): sender u8, sound string (`%!MRAD_ROGER`, `%!MRAD_ctwin`, …). No pitch field in 1.5 (1.6 adds one).
- `BombDrop` (6): x, y, z coords (i16/8), flag u8 (1 = planted). `BombPickup` (0).
- `ClCorpse` (-1): model string, origin x/y/z as i32/128, angles (3 coords), delay i32, sequence u8, body u8 — **no player
  number in 1.5**; corpses come in death order (match to `DeathMsg` victims by order and team model).
- `Radar` (7): entity u8, x, y, z coords — teammates' positions, sent to the recorder (POV).
- Recorder only (POV): `Money` (5) i32 + flag, `Health` (1), `Battery` (2), `Damage` (12) armor u8, health u8, bits i32, from
  x/y/z coords, `CurWeapon` (3), `AmmoX`, `StatusIcon` (buyzone, c4, defuser), `BarTime` (plant/defuse), `ShowMenu` (buy menus),
  `WeapPickup`/`ItemPickup`/`AmmoPickup`, `StatusValue` (crosshair target: 1 relation, 2 player, 3 health).
- `svc_event`: per event a 10-bit event index (→ `events/*.sc` resource, e.g. `ak47` = one shot), then optionally an 11-bit
  **position in the frame's packet-entity list** (not the entity number) and an `event_t` delta. The recorder's own shots are not
  sent; they are the demo's type-6 (event) frames.
- Player entities (`entity_state_player_t`): origin, angles, `weaponmodel` (→ `models/p_*.mdl`: weapon in hand), sequence/gait.
  POV demos only contain players in the recorder's view area (median 28–56 % of frames); HLTV demos about 76–88 %.
- Server text (`svc_print`): welcome text with `BUILD n`, cvar changes (`"mp_freezetime" changed to "…"`), `status` output.
- `svc_sound`: 9-bit flags, volume/attenuation (if flagged), channel 3 bits, **entity 11 bits** (= player when 1–32), sound index
  8 or 16 bits, origin per axis as a bit-coord (int/frac flags, sign, 12-bit int, 3-bit eighths), pitch if flagged. Gives positions
  of footsteps, shots, reloads, jumps — also of enemies the recorder only *heard*.
- **Packet entities are deltas against an older frame:** `svc_deltapacketentities` names its reference frame with a sequence
  byte (Set 1: 2 frames back 89 %, 3 back 9 %, previous frame only 2 %). Keep the last 64 frames by the frame's incoming
  sequence (first i32 of the 28-byte sequence info at the end of the frame's info block) and build each frame from the one
  named; unlisted entities keep the reference frame's state (`engine/src/match/entities.ts`).
- **POV knowledge of other players** (Set 1, exact tracks, per 1 s of alive time): teammates 70 % (seen 52 %, `Radar` 41 %,
  sounds 29 %), enemies 32 % (seen 19 %, sounds 21 %); 2 s window: 74 % / 36 %. HLTV: 94 %. At POV kills both positions are
  known ±1 s for 85 % (both seen 72 %). Track position at a kill is within 50 units of the corpse for 84 % (median 3–9 units).
- HLTV `svc_director` types seen: 1 start, 2 event (highlights: kills etc.), 5 time scale, 6 message, 8 status.

## Maps for the radar (plan 2.14, checked on Set 1)
- Overview images (`cstrike/overviews/<map>.bmp`, 1024×768, 8-bit) + `.txt` (ZOOM, ORIGIN, ROTATED): **pixel x = 512 + (x − originX)·zoom/8,
  pixel y = 384 − (y − originY)·zoom/8.** ROTATED does not change this mapping. Positions land on drawn floor: de_train 100 %,
  de_inferno 100 %, de_prodigy 99 %, de_nuke 98 % (HLTV de_train: free fit gave 0.1965 px/unit vs zoom/8 = 0.195).
  **The images show today's map versions:** the 2002 de_cbble (checksum 3163797097) only fits 58 % → use the drawn fallback.
- Bomb sites: `func_bomb_target` brush bounds (models lump), `info_bomb_target` point ±256; join touching pieces (de_prodigy has
  4 brushes = 2 sites); compare height too (de_nuke: A at z −416..−320 above B at −768..−672). Site letters A/B are not in the map.
- **Plant position (CS 1.5 sends none):** `BombDrop` is 6 bytes (x, y, z, no flag) and only for dropped bombs; CT POV demos never get it.
  Use the planted C4 object (`models/w_c4.mdl` entity origin) or the C4 plant/beep sounds' origin: 144 of 150 Set 1 plants located,
  all inside a site.
- Fallback top-down map: upward faces (normal z ≥ 0.7) of model 0, keeping heights from the lowest to the 99.5th-percentile
  player origin −36 ±24 (removes roofs); 99 % of positions lie over a kept polygon (2002 de_cbble, de_prodigy).
