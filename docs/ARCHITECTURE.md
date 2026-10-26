# CS Demo Fixer — Engine architecture

This engine is original code. Other projects (compLexity Demo Player, SK Player, CS Demo Manager) are used only as
references for **facts** about the GoldSrc demo format; no code is copied or translated from them. Facts are recorded
in `docs/FORMAT.md` with where they came from.

## Layers

```
tools / app            inspect, convert, (later) the Windows app
    │
transforms             small named, tested changes (e.g. "protocol 46 → 48: server info")
    │
protocol               network messages: lossless, copy-on-write message stream + delta codec
    │
container              the .dem file: header, directory, frames  ⇄  typed model  ⇄  bytes
    │
binary                 ByteReader, BitReader, BitWriter
```

Each layer depends only on the layer below it.

## Principles
- **Lossless by default.** Reading then writing a demo without changes gives back the same bytes. Every decoded
  message keeps the exact byte range it came from; when nothing changes, those original bytes are written back.
- **Copy-on-write changes.** A transform never edits a buffer in place. It returns a new message (or a list of
  messages) for the parts it changes; everything else passes through untouched.
- **Typed models.** Frames and messages are TypeScript discriminated unions, so the compiler checks every case.
- **Plain-language errors.** Errors say what was being read and where (frame number, time, byte offset).
- **Never modify inputs.** Functions take buffers and return new ones; the owner's files are never written to.

## Folders
- `engine/src/binary/` — byte and bit readers/writers.
- `engine/src/container/` — demo file model, reader and writer.
- `engine/src/protocol/` — message ids, protocol state, message decoder, delta codec.
- `engine/src/transforms/` — repairs and protocol conversion.
- `engine/src/mapcrc.ts` — engine-exact map checksum.
- `engine/src/inspect.ts` — demo inspector: version, recording type, maps played, sections, voice codec, players with voice
  statistics, problems in plain language (basis of the app's health report).
- `engine/src/match/` — match data (plan 2.12): players (by server user id), rounds with winner/reason/score, kills,
  death spots (corpses matched to kills), chat, radio, bomb, shots, voice bursts, recorder data, HLTV director events;
  `checkMatch` compares the result with the server's own frags and team score.
- `engine/src/map/` — map facts for the radar (plan 2.14): bomb sites, spawns and floor polygons from the .bsp (read-only),
  the game's overview images (`overview.ts`: world → image mapping, checked against player positions).
- `engine/src/map-index.ts` — finds the exact map version a demo needs among folders of .bsp files (by checksum).
- `engine/test/` — Vitest tests. Tests that need real demos read them from the folder in `CDF_DEMOS`
  (demos are never committed).
- `tools/` — command-line tools for development.
