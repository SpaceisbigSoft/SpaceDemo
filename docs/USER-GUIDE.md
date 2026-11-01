# SpaceDemo user guide

SpaceDemo lets you watch old **Counter-Strike 1.0–1.6 demos** (`.dem` files) in today's Steam Counter-Strike 1.6, **with the original voice communication**. It also reads each demo and shows you the match: score, rounds, players, chat, voice, a radar replay and more.

Your demos are only ever read. SpaceDemo makes a fixed **copy** when one is needed and never changes the original.

**Contents:**
1. [What you need](#1-what-you-need)
2. [Install](#2-install)
3. [First start](#3-first-start)
4. [The library](#4-the-library)
5. [Watching a demo](#5-watching-a-demo)
6. [Fixing many demos at once](#6-fixing-many-demos-at-once)
7. [Voice](#7-voice)
8. [Demo details](#8-demo-details)
9. [Players](#9-players)
10. [Old map versions](#10-old-map-versions)
11. [Settings](#11-settings)
12. [Safety: your files, the game and VAC](#12-safety-your-files-the-game-and-vac)
13. [Troubleshooting](#13-troubleshooting)
14. [Uninstalling](#14-uninstalling)
15. [Which demos work](#15-which-demos-work)

---

## 1. What you need

- **Windows 10 or 11**, 64-bit.
- **Steam** with **Counter-Strike** (the Steam version of CS 1.6) installed. SpaceDemo plays demos in this game.
- Your old demos: loose `.dem` files, folders of them, or `.zip` files that contain demos.

You don't need the old game. Old voice recorded with the Miles codec (most 2001–2003 demos) is decoded with a file that today's Steam game still has (`mssvoice.asi` in the Half-Life folder). SpaceDemo never includes Valve's or RAD's files.

## 2. Install

1. Download `SpaceDemo Setup <version>.exe` from the [Releases page](https://github.com/SpaceisbigSoft/SpaceDemo/releases).
2. Run it. The installer isn't signed (signing costs money), so Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**.
3. Choose where to install (the suggested folder is fine). You get a desktop shortcut and a Start Menu entry.

`.dem` files now open with SpaceDemo when you double-click them: the demo is added to the library and its details open.

## 3. First start

SpaceDemo opens in dark mode on the **Library** page. You can change this under Settings → Appearance.

The card at the bottom left shows the game:

- **Found · 1.1.2.7** (the game's version): Steam and the game were found automatically.
- **Not found · open Settings:** go to **Settings → Counter-Strike 1.6 → Choose game folder…** and pick the **Half-Life** folder (the one with `hl.exe` and `cstrike` in it). It's usually `C:\Program Files (x86)\Steam\steamapps\common\Half-Life`, or `steamapps\common\Half-Life` in another Steam library.

## 4. The library

- **Add your demos:** click **Add folder…**, or drag folders, `.dem` files or `.zip` files onto the window. SpaceDemo reads demos straight from inside zips; you don't need to unpack them. Subfolders are included.
- **Reading:** each demo is read once, which takes a second or so. The title bar shows *reading demos 12/80* while it works. Later starts are instant.
- **Search** looks in demo names, players, maps and servers. The **filters** (All, Needs fixing, Ready to watch, With voice, Map problems) and the **Map** list narrow the list. Click a column heading to sort.
- **Identical copies** (same name and size in different places) are shown once, with the earliest date.
- **Version** shows the network protocol the demo was recorded with (for example *Old · p46*). Today's game plays protocol 48 (*Today's · p48*).

What the **status** means:

| Status | Meaning |
|---|---|
| Plays as is | Today's game can play it without changes. |
| Needs fixing | Recorded with an older game version. *Fix & watch* converts a copy first. |
| Damaged · repairable | The recording was cut off (the game crashed or was closed). SpaceDemo repairs a copy. |
| Fixed · ready | A fixed copy exists and is used when you watch. |
| Not Counter-Strike | A demo from another Half-Life game. |
| Can't read | The file isn't a demo or is broken beyond repair. |

Click a demo's **name** for its details (section 8), or its **Fix & watch / Watch** button to play it.

## 5. Watching a demo

1. **Close Counter-Strike** if it's open. Steam won't hand a new demo to a game that's already running.
2. Click **Fix & watch** (or **Watch in CS 1.6**). A window explains what will happen:
   - *Fixed first (a few seconds):* the demo is repaired if needed, converted for today's CS 1.6, and its original voice is put back as Steam voice. The fixed copy is saved in `Documents\SpaceDemo\Fixed demos`; your original stays as it was.
   - If the demo needs an older version of its map, SpaceDemo puts it in place (see section 10).
3. Click the button. Steam starts Counter-Strike and the demo plays.

**Controlling playback: the game's demo panel**

- Press **`~`** (the key under Esc) to open the console. The **demo panel** appears next to it, with a timeline you can drag, pause/play buttons and a speed setting from ×¼ to ×4.
- Press **`~`** again to close the console and keep watching.
- The voice keeps its normal pitch at every speed. At ×½ it can sound choppy.
- Normal key bindings don't work while a demo plays (every key opens the console). This is how the game works, not a SpaceDemo problem.

**Demos that change map** (rare) play with `playdemo`, where the demo panel doesn't work. For those, the Watch window lets you choose the speed (×½, ×1, ×2, ×4) before starting.

**Afterwards:** when you close the game, SpaceDemo removes the copy it placed in the game's `cstrike\cdf_test` folder. Tick *Keep the copy in the game folder afterwards* if you want to keep it there. The fixed copy in `Documents\SpaceDemo\Fixed demos` always stays.

The game is started with `-insecure`, which turns VAC off for that session (see section 12).

## 6. Fixing many demos at once

The **Fix & convert** page fixes demos in a batch without starting the game:

- **Fix all … that need it** on the Library page sends every demo that needs fixing here. You can also drop demos or zips onto the page, or use **Choose files…**.
- Each row shows how long the fix took, how much original voice was found, and what was done. Click the folder icon to show the fixed copy in Explorer.
- **Stop after this one** stops the batch after the current demo. The rest are marked *Not fixed (stopped)*.
- Fixed copies go to `Documents\SpaceDemo\Fixed demos`. To use a different folder, go to Settings → Fixed demos → **Change folder…**.

## 7. Voice

Old demos stored voice in codecs today's game can't play (Miles from 2001–2003, later Speex). SpaceDemo decodes it and writes it back as today's Steam voice, so you **hear the players in game**.

- A player's demo only holds **his own team's** voice. His own voice was never recorded. Some HLTV demos carry voice and some don't.
- **Voice cleanup** (Settings → Voice, on by default) removes rumble and hiss and evens out the loudness of each talk burst. Turn it off to keep the voice exactly as decoded.
- **AI voice enhancement** (Settings → AI voice enhancement, off by default) uses a free AI model (VoiceFixer) to make the 2002 voice fuller and clearer. You download the model once with **Download the AI model** (about 142 MB). It runs on your PC and takes longer than a normal fix: about 15 seconds per minute of voice on a fast PC. Demos fixed the other way are fixed again when you watch them. To get the plain voice back, switch it off.
  - The AI voice needs Microsoft's Visual C++ runtime, which most PCs already have. If it's missing, the demo is fixed with the normal voice and a note says so: install the [Microsoft Visual C++ Redistributable (x64)](https://aka.ms/vc14/vc_redist.x64.exe), then fix the demo again.
- **Voice to text** (demo details → Voice tab → *Turn voice into text*) writes down what was said, so you can read and search it. Download the speech model once (about 190 MB). It runs on your PC, takes a few minutes per demo, and is kept afterwards. Old, noisy voice gives rough text: treat it as a guide to what was said, not an exact record.
- **Processor cores** (Settings) sets how many cores the AI voice and voice to text may use. The suggested maximum is all cores but one, so Windows stays smooth.

## 8. Demo details

Click a demo's name in the library. The details come from the demo itself:

| Tab | What it shows |
|---|---|
| **Overview** | Score, rounds at a glance, players of both teams, map with bomb sites, who talked, chat, the server and network settings, and the demo's health (what needs fixing). If other recordings of the same match are in your library (the other half, an HLTV demo), they're listed and combined: whole-match score and more known positions. |
| **Rounds** | Each round: winner and how (D = defused, K = team killed, B = bomb exploded, T = time ran out), a short story of the round, and players alive over time. |
| **Scoreboard** | Kills, deaths, headshots and more per player. Click a heading to sort. |
| **Chat & radio** | Chat and radio calls in order. Search, show or hide automatic radio, and see per-player counts. |
| **Voice** | Who talked when, per round, plus *Turn voice into text*. |
| **Heatmaps** | Where players were, died, planted, and threw grenades, on the map's overview picture. |
| **Radar replay** | A top-down replay of each round: known positions (solid), radar and heard positions, estimated positions (faded, with how sure), grenades and the bomb carrier. |
| **Sightings** | Who saw or heard whom first (player demos only). |
| **Recorder** | The recording player's money, buys and keys (player demos only). |
| **Aim** | The recording player's reaction time, crosshair placement and shooting while moving (player demos only). Times are shown as ≈ value ± 0.1 s. |
| **Highlights** | Multi-kills, clutches, knife kills, kills from behind, and kills with no clear line of sight. *Watch on the radar* opens the moment in Radar replay. |
| **Lag** | Players' pings and lost packets, and laggy moments. Player demos only have pings while the recorder had the scoreboard open. |

The game shows exactly what happened. SpaceDemo works it out from the recording, so a few numbers may be estimates. Where that matters, the tab says so.

## 9. Players

The **Players** page lists everyone across all your demos, with totals (kills per round, multi-kill rounds and more). It recognises the same player under different names from the settings his game sent. Private passwords in those settings are only compared, never shown. It suggests names that belong together; accept or reject each suggestion. Several recordings of the same match half are counted once.

## 10. Old map versions

Many old demos were recorded on **earlier versions of a map** (for example the 2002 de_nuke). The game refuses to play a demo whose map doesn't match.

- Go to **Settings → Old map versions → Add map folder…** and add the folders where you keep old `.bsp` files (your "map pool"). These folders are only read.
- SpaceDemo finds the right version by its checksum and, when a demo needs it, places it in the game's `cstrike_downloads\maps` folder. If today's map has the same name, the old version gets a new name. Texture files (`.wad`) the old map needs are copied too, when SpaceDemo can find them.
- Today's maps are never replaced or changed.
- If no matching version is found, the Watch window warns you before starting.

## 11. Settings

| Setting | What it does |
|---|---|
| Appearance | Same as Windows, Dark (default) or Light. |
| Counter-Strike 1.6 | Found automatically, or choose the Half-Life folder by hand. |
| Old map versions | Your map pool folders (section 10). |
| Voice | Voice cleanup on/off (section 7). |
| AI voice enhancement | On/off, and the AI model (section 7). |
| Processor cores | How many cores the AI voice and voice to text may use. |
| Fixed demos | Where fixed copies are saved. |
| About | Version, credits, and buttons that open the licences. |

The window remembers its size and position. Settings are stored in `%APPDATA%\SpaceDemo\settings.json`.

## 12. Safety: your files, the game and VAC

- **Your demos are never changed.** Fixes are always saved as a new copy.
- **The game's own files are never changed.** SpaceDemo only adds its own files: the demo you watch (`cstrike\cdf_test`, removed when the game closes) and old map versions (`cstrike_downloads`).
- **Nothing touches the running game.** No injection, no hooks, no memory reading. Playback starts through Steam with `-insecure`, which turns VAC off for that session. To play online afterwards, just start the game normally.
- **Nothing is sent anywhere**, apart from the one-time downloads of the AI and speech models, which you start yourself.

## 13. Troubleshooting

| Problem | What to do |
|---|---|
| *Counter-Strike 1.6 wasn't found* | Settings → Counter-Strike 1.6 → **Choose game folder…** and pick the Half-Life folder (with `hl.exe` and `cstrike`). |
| *Steam wasn't found* | Install or start Steam once, then click **Find automatically** in Settings. |
| Nothing happens when you click Watch, or an old demo keeps playing | Counter-Strike was already open. Close it and try again. |
| The game starts but stops with a map error, or *couldn't open … .wad* | The demo needs an older map version or its textures. Add your old maps folder (section 10). For a missing `.wad`, put that file in the game's `cstrike_downloads` folder. |
| No voice in game | Check the library's Voice column. Many HLTV demos have no voice, and a player's own voice was never recorded. For Miles voice, `mssvoice.asi` must be in the Half-Life folder (Steam installs it). Also check the game's own voice volume. |
| Voice sounds rough | That's the 2002 voice codec. Try AI voice enhancement (section 7). |
| *Steam says Counter-Strike isn't fully installed yet* or *has an update waiting* | Let Steam finish the update, then try again. |
| Counter-Strike is on a beta branch | Switch back to the normal branch in Steam (Counter-Strike → Properties → Betas). Fixed demos are made for the normal game. |
| *This demo is for "…", not Counter-Strike* | It's a demo from another Half-Life game (for example Day of Defeat). SpaceDemo plays Counter-Strike demos only. |
| A note says *The AI voice couldn't start* | The copy has the normal voice. Install the [Microsoft Visual C++ Redistributable (x64)](https://aka.ms/vc14/vc_redist.x64.exe), then fix the demo again. |
| Windows SmartScreen blocks the installer | **More info → Run anyway** (the installer isn't signed). |

Still stuck? Open an issue on [GitHub](https://github.com/SpaceisbigSoft/SpaceDemo/issues) with the demo's name, what you clicked and what you saw.

## 14. Uninstalling

Use Windows **Settings → Apps → SpaceDemo → Uninstall**. Your settings (`%APPDATA%\SpaceDemo`) and fixed demos (`Documents\SpaceDemo\Fixed demos`) are kept. Delete those folders yourself if you don't need them any more. Old map versions SpaceDemo placed in the game's `cstrike_downloads\maps` folder can be deleted too.

## 15. Which demos work

- Counter-Strike demos recorded with network **protocol 45, 46, 47 or 48**. That covers the WON-era CS 1.x releases (2001–2003) and Steam CS 1.6. SpaceDemo has been tested with over 100 real demos from 2001–2005, player (POV) and HLTV.
- Voice: **Miles** (WON era) and **Speex** (early Steam). Demos recorded with today's game already have Steam voice and play as they are.
- Not supported yet: the very first betas and releases (protocol 43 and older).

---

SpaceDemo is free software under the GNU GPL v3 or later. Credits and every licence: Settings → About, or [THIRD-PARTY-NOTICES.txt](../THIRD-PARTY-NOTICES.txt). Counter-Strike and Half-Life are trademarks of Valve Corporation. SpaceDemo is not affiliated with Valve.
