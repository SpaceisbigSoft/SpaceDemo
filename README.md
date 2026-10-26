# CS Demo Fixer

A modern Windows app for watching old **Counter-Strike 1.0–1.6** demos (`.dem`) in today's Steam CS 1.6 — **with the original voice communication**.

> Status: **planning / early research.** Nothing to download yet.

## Goals
- Open any CS 1.0–1.6 demo (POV or HLTV) and show what it is: version, map, players, voice, problems.
- Repair what stops it playing (old network protocols, crashed recordings, wrong-map and stuck-console bugs, map version mismatches).
- **Keep the voice audio** — the top priority. Old demos use the Miles or Speex voice codecs, which today's Steam build no longer plays.
- Launch Steam CS 1.6 with in-game playback controls (pause, slow motion, fast forward).
- Never change your original demo files — fixes are always saved as a copy.

## Credits
- **compLexity Demo Player** (COL) by jpcy and contributors — https://github.com/jpcy/coldemoplayer — GPL v3. Demo conversion and voice handling in this project are based on it.
- **CS Demo Manager** by AkiVer — https://github.com/akiver/cs-demo-manager — MIT. Model for the interface.
- **SK Player** by Andreas Thorstensson — feature ideas only; no code used.
- **Speex** by Xiph.Org — BSD-style licence (when added).

Counter-Strike and Half-Life are trademarks of Valve Corporation. This project is not affiliated with Valve and does not include any Valve game files.

## Licence
GNU General Public License v3.0 — see [LICENSE](LICENSE).
