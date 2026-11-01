# SpaceDemo

A modern Windows app for watching old **Counter-Strike 1.0–1.6** demos (`.dem`) in today's Steam CS 1.6 — **with the original voice communication**.

> **Download:** the Windows installer is on the [Releases page](https://github.com/SpaceisbigSoft/SpaceDemo/releases) (unsigned: SmartScreen → More info → Run anyway).
> **How to use it:** the [user guide](docs/USER-GUIDE.md) (also the Help page inside the app).
>
> Status: version 0.9.0 beta 1 (test version), working on Windows 10/11 with Steam CS 1.6: demo library (folders and zips), fix & watch with the original voice, batch fixing, old map versions, match details (rounds, scoreboard, chat, voice, heatmaps, radar replay, aim and more), players across demos, optional AI voice and voice to text. Tested with over 100 demos from 2001–2005.
>
> Main repository: https://github.com/SpaceisbigSoft/SpaceDemo (renamed from `i69-demoviewer` on 2026-10-26; earlier `cs-demo-fixer`). Working name during development: CS Demo Fixer.

## Developer notes
- The engine is **original code** (see `docs/ARCHITECTURE.md`). Other projects are used only as references for facts about the demo format.
- `npm install`, then `npm test`. To include round-trip tests on real demos, set `CDF_DEMOS` to a folder of `.dem` files (demos are never committed).
- Match data: `npm run match -- <demo.dem or folder> [--json <out folder>]` — rounds, kills, score, chat, radio, bomb, shots, voice, with a check against the server's own scores.
- **Fix a demo** (repair, convert, original voice back as Steam voice): `npm run fix -- <old.dem> <fixed.dem> --game <Half-Life folder>` — uses your own `mssvoice.asi` through our voice helper (`npm run build:helper` first).
- Walkable-area map (where players can stand and walk, shortest routes): `npm run walk -- <map.bsp> [--demos <folder>] [--json <out.json>] [--route <x,y,z> <x,y,z>]` — map files are only read; demos teach it boost spots and trick jumps.
- **The app** (Electron + React): `npm run app` builds it into `out/app/` and opens the window (Electron downloads itself the first time). Interface test: `npm run test:app` (on Linux: `xvfb-run -a npm run test:app`; screenshots in `out/screenshots/`; library tests on real demos: `CDF_ZIPS=<folder of demo zips>`, optional `CDF_POOL=<old maps>` and `SPACEDEMO_GAME_DIR=<Half-Life folder>`).
- **Builds (GitHub Actions, `.github/workflows/build.yml`):** every push runs the type check, the tests and both helper builds (MinGW-w64 on Ubuntu 24.04; reproducible: the same source gives the same file, see `helpers-SHA256.txt` in the run's files). A `v*` tag (or "Run workflow") also builds the Windows installer and, for a tag, a **draft** release. Local equivalent: `sh helpers/voice-helper/build.sh`, `sh helpers/whisper-helper/build.sh`, then `npm run dist:win`.
- Inspect demos: `npm run inspect -- <demo.dem or folder> [--maps <folder with .bsp files>]... [--json]` — version, recording type, maps, length, voice per player, map-version check and problems.

## Goals
- Open any CS 1.0–1.6 demo (POV or HLTV) and show what it is: version, map, players, voice, problems.
- Repair what stops it playing (old network protocols, crashed recordings, wrong-map and stuck-console bugs, map version mismatches).
- **Keep the voice audio** — the top priority. Old demos use the Miles or Speex voice codecs, which today's Steam build no longer plays.
- Launch Steam CS 1.6 with in-game playback controls (pause, slow motion, fast forward).
- Never change your original demo files — fixes are always saved as a copy.

## Anti-cheat safety
SpaceDemo is designed so it cannot trigger Valve Anti-Cheat (VAC) or any Valve punishment:
- It never injects into, hooks, or reads/writes the memory of the game.
- It never modifies, patches or replaces game files (executables, DLLs, stock maps, models, sprites or sounds).
  It only creates new demo files and keeps extra content (such as old map versions) in its own folders.
- Demo playback is started with standard launch options and console commands, with `-insecure` (VAC off for that session).
- All processing (demo conversion, voice decoding) happens in SpaceDemo's own process, not inside the game.
- Nothing is sent to Valve or Steam servers.

## Credits
- **compLexity Demo Player** (COL) by jpcy and contributors — https://github.com/jpcy/coldemoplayer — GPL v3. The pioneering CS 1.0–1.6 demo player and converter; an important reference for how old demos differ from current ones. (This project's code is written from scratch.)
- **CS Demo Manager** by AkiVer — https://github.com/akiver/cs-demo-manager — MIT. Inspiration for the interface.
- **SK Player** by Andreas Thorstensson — feature ideas only; no code used.
- **Inter** (Rasmus Andersson) and **JetBrains Mono** fonts — SIL Open Font Licence 1.1, via Fontsource.
- **Speex** by Xiph.Org — BSD-style licence (see helpers/speex/COPYING); built from source to WebAssembly.
- **VoiceFixer** by Haohe Liu — https://github.com/haoheliu/voicefixer — code MIT, trained models CC BY 4.0 (Zenodo 5600188, 5469951). SpaceDemo's optional AI voice model is a changed copy: combined, compressed (int8/fp16) and converted to ONNX.
- **OpenAI Whisper** (MIT) via **whisper.cpp** (MIT) — optional voice to text.
- **ONNX Runtime** (MIT), **opusscript** / libopus (MIT / BSD), Electron and React (MIT).
- **Opus** (libopus, Xiph.Org and others — BSD) inside opusscript; **MinGW-w64** runtime (ZPL/MIT) in the helper programs; ONNX Runtime ships Microsoft's DirectML and DirectX Shader Compiler files.
- The full list with every licence text: [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) (made by `npm run notices`; also in the install folder and behind Settings → About → Open-source licences).
- Format notes from the community, incl. the talent GoldSrc demo-structure notes (cgdangelo) and ReHLDS (map checksum algorithm).

Counter-Strike and Half-Life are trademarks of Valve Corporation. This project is not affiliated with Valve and does not include any Valve game files, nor RAD Game Tools' Miles files: old Miles voice is decoded with the player's own copy from their game folder.

## Licence
GNU General Public License v3.0 — see [LICENSE](LICENSE).
