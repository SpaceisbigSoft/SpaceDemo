# SpaceDemo — Engine architecture

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
- `engine/src/map/` — map facts for the radar (plan 2.14): bomb sites (with letters A/B: map-file order, per-version
  corrections in `SITE_LETTER_OVERRIDES`), spawns and floor polygons from the .bsp (read-only), the game's overview images
  (`overview.ts`: world → image mapping, checked against player positions).
  - `hull.ts` — the map's player collision ("clip hulls": the world grown by the player's box): does a standing or
    crouching player fit with his origin here, where is the ground below. 99.75–100 % of Set 1 positions fit (allowing
    the demos' whole-unit rounding and crouching).
  - `walk.ts` — walkable-area map (plan 2.15): 32×32-unit spots on every floor (columns scanned with the collision),
    links for walk/step/jump (≤ 64 up)/drop (≤ 220 down)/ladder, plus spots and links from players' real movements in
    demos of the same map version (boost spots, trick jumps). Kept: what is reachable from a spawn or a spot players
    stood on (big drops count one way, so roofs are left out). Shortest paths (Dijkstra), nearest spot for a position,
    compact JSON for caching per map checksum. Used by position estimates (2.16).
- `engine/src/match/estimate.ts` — position estimates between sightings (plan 2.16): per player and round life, anchors
  (seen, radar, heard, spawn during freeze time, death spot at the kill time) and, between them, the shortest walkable
  route at the weapon's top speed (`WEAPON_SPEED`, from the game code); timing 'adaptive' (even spread in short gaps,
  go-then-wait in long ones); every point has a source, an uncertainty radius and a confidence, calibrated on Set 1
  (POV knowledge vs the HLTV recording of the same half: `tools/dev/estimate-check.ts`). `estimateMatch()` = whole demo.
- POV demos: the recorder's own exact position comes from each network frame's view info (`viewInfo()` in
  `match/extract.ts`: simorg, on-ground, view height, health, view angles).
- `engine/src/zip.ts` — reads files straight out of .zip files (stored/deflate, CRC checked, entry dates); read-only.
- `engine/src/map-index.ts` — finds the exact map version a demo needs among folders of .bsp files (by checksum).
- `engine/test/` — Vitest tests. Tests that need real demos read them from the folder in `CDF_DEMOS`
  (demos are never committed).
- `tools/` — command-line tools for development.
- `app/` — the SpaceDemo window (plan 4.x), Electron + React + TypeScript, built with esbuild (`app/build.mjs` → `out/app/`):
  - `main/` — the app process: one window (sandboxed, no Node.js in the page, links open in the normal browser, one
    SpaceDemo at a time), settings in `%APPDATA%\SpaceDemo\settings.json` (`settings.ts`), the game finder (`game.ts`
    → `engine/src/launch/steam.ts`).
  - `preload/` — the only bridge: the named calls in `shared/api.ts` (`window.spacedemo`).
  - `renderer/` — the page (React): title bar (Windows' own min/max/close buttons drawn over it, coloured per theme),
    left navigation, pages. Colours are CSS tokens; `<html data-theme="light|dark">` is set from the app (Settings:
    same as Windows / dark / light), so the look never depends on the page guessing the system colours.
  - Library (plan 4.3): `main/library.ts` (find demos in folders and inside zips, merge identical copies — same name and
    size — into one row with the earliest date, status, map check, cache in `%APPDATA%\SpaceDemo\library-cache.json`),
    `main/library-service.ts` (lists, shows cached rows at once, reads the rest and sends progress), `main/scan-worker.ts`
    (background thread: inspector + map index, so the window never waits). Folders and zips are only read.
  - Details (plan 4.4): `main/details.ts` (match data 2.12 + inspector voice numbers + bomb sites 2.14 → what the page
    shows; clan tag = a name part most of a team shares; the game's overview picture only when the demo's map is the
    installed version, never for old versions), read in the background thread when the page opens.
  - Watch (plan 4.5): `main/watch-service.ts` (fix first when needed → `main/fixer.ts` in the background thread, the same
    one-step fix as `npm run fix`, written with writeNewFile into the fixed-demos folder; then the 3.2 launcher and the
    3.5 cleanup when the game closes), `main/fixed-store.ts` (which demos have a valid fixed copy: `%APPDATA%\SpaceDemo\fixed.json`;
    a copy counts only while the original is unchanged). Bundles get `import.meta.url` from a banner (`app/build.mjs`).
  - Fix & convert (plan 4.6): `main/fix-service.ts` — one fixing path for Watch and batches (library "Fix all", files
    picked or dropped on the Fix page, .dem or .zip); one demo at a time in the background thread; Stop skips the rest;
    results per demo (time, voice restored, what was done).
  - `test/` — `*.test.ts` run with `npm test`; `*.e2e.ts` start the real window (`npm run test:app`, Playwright).

## Fixing a demo (plan 2.8)
- `engine/src/fix/fix.ts` — `fixDemo()`: recover a cut-off recording, convert to protocol 48 (sprites/models today's game
  lacks are dropped: checked in the player's `cstrike`/`valve` folders, or the known build-10210 list), and put old
  Miles voice back as Steam voice. `npm run fix -- <in> <out> [--game <Half-Life>] [--asi <mssvoice.asi>] [--decoder helper|emulator] [--plain]` (voice cleanup on by default).
- `engine/src/voice/restore.ts` — old voice packets → decoder → one Opus stream per talk burst (libopus 1.4 as
  WebAssembly, `opusscript`, MIT; 8 kHz in, 24 kbps, 20 ms frames) → frames shared out over the burst's original packets.
- `engine/src/voice/decoders.ts` — decoders behind one batch protocol: `helperDecoder` (our Windows program
  `helpers/voice-helper/`, loads the user's own `mssvoice.asi` itself; built with `npm run build:helper`, MinGW-w64
  i686) and `emulatorDecoder` (development: Python + Unicorn). Both decode bit-identically.
- `engine/src/voice/cleanup.ts` — optional "voice cleanup" (high-pass 110 Hz, low-pass 3.4 kHz, +3 dB at 2.2 kHz,
  per-burst level), on by default (owner's choice after listening); `--plain` turns it off.

