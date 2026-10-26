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

## Map checksum
CRC-32 of all BSP lumps except entities (bshift: except lump 1), in lump order, **without** the final inversion.
*Source: ReHLDS `crc.cpp` (algorithm); measured against the owner's maps.*
