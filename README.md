# CS Demo Fixer

A modern Windows app for watching old **Counter-Strike 1.0–1.6** demos (`.dem`) in today's Steam CS 1.6 — **with the original voice communication**.

> Status: **early research.** Nothing to download yet.
>
> Main repository: https://github.com/SpaceisbigSoft/i69-demoviewer (moved from `SpaceisbigSoft/cs-demo-fixer` on 2026-10-26 with full history).

## Developer notes
- The engine is **original code** (see `docs/ARCHITECTURE.md`). Other projects are used only as references for facts about the demo format.
- `npm install`, then `npm test`. To include round-trip tests on real demos, set `CDF_DEMOS` to a folder of `.dem` files (demos are never committed).
- Inspect demos: `npm run inspect -- <demo.dem or folder> [--maps <folder with .bsp files>]... [--json]` — version, recording type, maps, length, voice per player, map-version check and problems.

## Goals
- Open any CS 1.0–1.6 demo (POV or HLTV) and show what it is: version, map, players, voice, problems.
- Repair what stops it playing (old network protocols, crashed recordings, wrong-map and stuck-console bugs, map version mismatches).
- **Keep the voice audio** — the top priority. Old demos use the Miles or Speex voice codecs, which today's Steam build no longer plays.
- Launch Steam CS 1.6 with in-game playback controls (pause, slow motion, fast forward).
- Never change your original demo files — fixes are always saved as a copy.

## Anti-cheat safety
CS Demo Fixer is designed so it cannot trigger Valve Anti-Cheat (VAC) or any Valve punishment:
- It never injects into, hooks, or reads/writes the memory of the game.
- It never modifies, patches or replaces game files (executables, DLLs, stock maps, models, sprites or sounds).
  It only creates new demo files and keeps extra content (such as old map versions) in its own folders.
- Demo playback is started with standard launch options and console commands, with `-insecure` (VAC off for that session).
- All processing (demo conversion, voice decoding) happens in CS Demo Fixer's own process, not inside the game.
- Nothing is sent to Valve or Steam servers.

## Credits
- **compLexity Demo Player** (COL) by jpcy and contributors — https://github.com/jpcy/coldemoplayer — GPL v3. The pioneering CS 1.0–1.6 demo player and converter; an important reference for how old demos differ from current ones. (This project's code is written from scratch.)
- **CS Demo Manager** by AkiVer — https://github.com/akiver/cs-demo-manager — MIT. Inspiration for the interface.
- **SK Player** by Andreas Thorstensson — feature ideas only; no code used.
- **Speex** by Xiph.Org — BSD-style licence (when added).
- Format notes from the community, incl. the talent GoldSrc demo-structure notes (cgdangelo) and ReHLDS (map checksum algorithm).

Counter-Strike and Half-Life are trademarks of Valve Corporation. This project is not affiliated with Valve and does not include any Valve game files.

## Licence
GNU General Public License v3.0 — see [LICENSE](LICENSE).
