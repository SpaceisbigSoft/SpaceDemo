# Developing SpaceDemo

SpaceDemo is an Electron + React + TypeScript app (`app/`) on top of a demo engine written from scratch (`engine/`, see [ARCHITECTURE.md](ARCHITECTURE.md) and [FORMAT.md](FORMAT.md)). Other projects (COL, CS Demo Manager) were used only as references for facts about the demo format; no code is reused.

## Setup and tests
- `npm ci`, then `npm test` (type check: `npm run typecheck`).
- Tests on real demos: set `CDF_DEMOS` to a folder of `.dem` files. Demos are never committed.
- **The app:** `npm run app` builds it into `out/app/` and opens the window (Electron downloads itself the first time). Interface tests: `npm run test:app` (on Linux: `xvfb-run -a npm run test:app`; screenshots in `out/screenshots/`; library tests on real demos: `CDF_ZIPS=<folder of demo zips>`, optional `CDF_POOL=<old maps>` and `SPACEDEMO_GAME_DIR=<Half-Life folder>`).
- `SPACEDEMO_FAKE_UPDATE=<version>` makes the app pretend GitHub has that version (for the update bar); `SPACEDEMO_NO_UPDATES=1` turns update checks off.

## Command-line tools
- **Fix a demo** (repair, convert, original voice back as Steam voice): `npm run fix -- <old.dem> <fixed.dem> --game <Half-Life folder>`. It uses your own `mssvoice.asi` through our voice helper (`npm run build:helper` first).
- **Play** a fixed demo in Steam CS 1.6: `npm run play -- <fixed.dem> [--mode auto|viewdemo|playdemo] [--speed N]`.
- **Inspect** demos: `npm run inspect -- <demo.dem or folder> [--maps <folder with .bsp files>]... [--json]`. Shows version, recording type, maps, length, voice per player, map-version check and problems.
- **Match data**: `npm run match -- <demo.dem or folder> [--json <out folder>]`. Gives rounds, kills, score, chat, radio, bomb, shots and voice, checked against the server's own scores.
- **Walkable-area map**: `npm run walk -- <map.bsp> [--demos <folder>] [--json <out.json>] [--route <x,y,z> <x,y,z>]`. Shows where players can stand and walk, and the shortest routes.
- Repair only: `npm run repair -- <in> <out>` · convert only: `npm run convert -- <in> <out>`.

## Builds and releases (`.github/workflows/build.yml`)
- Every push and pull request runs the type check, the tests and both helper builds (MinGW-w64 on Ubuntu 24.04). The helpers are reproducible: the same source gives the same file (see `helpers-SHA256.txt` in the run's files).
- **Run workflow** (by hand) also builds the Windows installer `SpaceDemo-Setup-<version>.exe` on a Windows runner. Tick **release** to also create a **draft** GitHub release for `v<package.json version>`; the tag is created when the draft is published. A `v*` tag push does the same.
- A version with "-" (e.g. `0.9.0-beta.2`) becomes a **pre-release**. The release text comes from `docs/release-notes/<tag>.md`.
- Each release carries the installer, its `.blockmap` and `latest.yml` / `beta.yml` / `alpha.yml`: the in-app updater (electron-updater) reads these.
- Before a release: bump the version (`npm version <v> --no-git-tag-version`), then run `npm run notices` (the tests fail if `THIRD-PARTY-NOTICES.txt` is out of date).
- Local equivalent: `sh helpers/voice-helper/build.sh`, `sh helpers/whisper-helper/build.sh`, then `npm run dist:win`.

## Rules
- **Original demos are never changed:** every write goes through `writeNewFile()` (`engine/src/fix/safe-output.ts`).
- **Anti-cheat safety:** no injection, hooks or memory access to the game; never modify or replace game files; playback with `-insecure`. See the README.
- Never commit or bundle Valve or RAD files (`mssvoice.asi`, `Mss32.dll`, …), demos or decoded audio.
