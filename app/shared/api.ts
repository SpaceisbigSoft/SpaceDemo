// What the window (renderer) may ask the app (main process) for. The window never touches files or programs itself:
// every request goes through these few named calls (Electron's contextBridge), and the main process decides.

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** The Steam copy of Counter-Strike 1.6, as found by the engine's finder (plan 3.1). Read-only. */
export interface GameStatus {
  found: boolean;
  /** The Half-Life folder (has hl.exe and cstrike). */
  gameDir?: string;
  /** The Steam library it was found in, e.g. "D:\SteamLibrary". */
  library?: string;
  /** cstrike\steam.inf PatchVersion, e.g. "1.1.2.7". */
  version?: string;
  /** Steam build id from appmanifest_10.acf. */
  buildId?: string;
  steamExe?: string;
  /** Plain-language problems that stop playback (empty = ready). */
  problems: string[];
  notes: string[];
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  platform: string;
}

/** What the library shows for one demo (plan 4.3). Read from the demo once and cached. */
export interface LibraryDemo {
  /** Unique key: the file path, plus "::" and the entry name for a demo inside a zip. */
  key: string;
  /** Demo name without .dem. */
  name: string;
  /** The .dem file, or the .zip that holds it. */
  file: string;
  /** Path inside the zip, when the demo is in one. */
  zipEntry?: string;
  /** Other places with an identical copy (same name and size). */
  alsoAt: string[];
  /** The library folder it was found under. */
  folder: string;
  size: number;
  /** Recording date in ms: the zip entry's date, else the file's date. */
  date: number;
  dateSource: 'zip' | 'file';
  /** Filled after reading the demo; missing while it waits. */
  info?: DemoSummary;
  /** Plain-language reason it couldn't be read. */
  error?: string;
  map?: MapStatus;
  status: DemoStatus;
  /** The app's fixed copy of this demo, when there is a valid one (status 'fixed'). */
  fixedCopy?: string;
  /** 4.10: fixed with AI-enhanced voice (Settings → AI voice, or this demo's own choice in the library). */
  aiVoice?: boolean;
}

/** One demo in a batch fix (plan 4.6). */
export interface FixItem {
  /** Library key (or file key for files picked on the Fix page). */
  key: string;
  name: string;
  map?: string;
  state: 'waiting' | 'fixing' | 'fixed' | 'failed' | 'skipped';
  seconds?: number;
  /** "7.7 min · 332 bursts", "none in this demo", or undefined while waiting. */
  voice?: string;
  /** 5.g5: the voice was AI-enhanced. */
  ai?: boolean;
  /** While fixing with AI voice: "AI voice 120 of 405 s". */
  progress?: string;
  done: string[];
  notes: string[];
  error?: string;
  output?: string;
  /** In the library (so Watch works from the results). */
  inLibrary: boolean;
}

export interface FixBatchState {
  items: FixItem[];
  running: boolean;
  outputFolder: string;
}

/** What the Watch dialog shows before starting (plan 4.5). */
export interface WatchInfo {
  key: string;
  name: string;
  /** viewdemo (one map: the game's demo panel works) or playdemo (map changes: speed set at the start). */
  mode: 'viewdemo' | 'playdemo';
  maps: string[];
  /** The demo will be fixed first (it isn't playable as is and has no fixed copy yet). */
  needsFix: boolean;
  /** Where the fixed copy is (or will be). */
  fixedCopy?: string;
  /** Things that stop watching (game not found…). */
  problems: string[];
  /** Things to know (old map version not in place…). */
  warnings: string[];
}

export interface WatchProgress {
  key: string;
  stage: 'fixing' | 'starting' | 'playing' | 'done' | 'error';
  message: string;
  /** What fixing did, in plain words. */
  done?: string[];
  /** Things to know from fixing (not successes). */
  notes?: string[];
}

export type DemoStatus = 'waiting' | 'plays' | 'fixed' | 'needs-fix' | 'damaged' | 'not-cs' | 'unreadable';

export interface DemoSummary {
  networkProtocol: number;
  gameDir: string;
  recording: 'POV' | 'HLTV';
  map: string;
  /** All maps played, in order (more than one = the demo changes map). */
  maps: string[];
  mapChecksum: number;
  seconds: number;
  hostName?: string;
  voiceCodec?: string;
  /** Total talk time of everyone heard (Miles voice: measured; other codecs: undefined). */
  voiceSeconds?: number;
  talkBursts: number;
  /** Who is heard talking (names). */
  talkers: string[];
  players: string[];
  recorder?: string;
  directoryOk: boolean;
  problems: string[];
}

export interface MapStatus {
  kind: 'ok' | 'warn' | 'bad' | 'unknown';
  /** Short text for the table, e.g. "installed", "old version · map pool", "map missing". */
  note: string;
}

export interface LibraryState {
  folders: string[];
  demos: LibraryDemo[];
  /** Set while demos are being read. */
  scan?: { done: number; total: number };
}

/** The details page of one demo (plan 4.4). Built when the page opens; nothing is written. */
export interface DemoDetails {
  key: string;
  teams: { T: TeamDetails; CT: TeamDetails };
  /** Final score of this recording: the server's own numbers when sent, else rounds counted. */
  score?: { T: number; CT: number; source: 'server' | 'rounds'; matchesRounds: boolean };
  rounds: { number: number; winner?: 'T' | 'CT' | 'draw'; reason?: string }[];
  chat: { time: number; who?: string; team?: 'T' | 'CT'; text: string; teamOnly: boolean; dead: boolean }[];
  /** Talk time per player, most first. */
  talk: { name: string; seconds: number; team?: 'T' | 'CT' }[];
  talkBursts: number;
  map: DetailsMap;
  /** Warm-up restarts skipped (data before the last restart isn't counted). */
  restarts: number;
  /** 5.h match overview. */
  overview: OverviewInfo;
  /** 5.c rounds with their timeline. */
  roundDetails: RoundDetail[];
  /** 5.t momentum from the players-alive counts. */
  momentum: Momentum;
  /** 5.z pings, choke, lost packets and laggy moments. */
  lag: LagData;
  /** 5.d scoreboard and stats. */
  stats: StatRow[];
  /** Parts of the demo used by 5.l and 5.m: warm-up, each round, after the match. */
  periods: Period[];
  /** 5.l chat and radio log, in time order. */
  log: LogEntry[];
  /** 5.l radio calls each player chose from the radio menu (automatic calls not counted). */
  radioByPlayer: RadioSummary[];
  /** 5.m voice timeline: every talk burst per player. */
  voice: VoiceRow[];
  /** Length of the demo in seconds. */
  seconds: number;
  /** 5.k heatmaps. */
  heatmap: HeatmapData;
  /** 5.q enemy sightings (POV demos only). */
  sightings?: SightingsData;
  /** 5.n the recorder's own money, health, speed and keys (POV demos only). */
  recorder?: RecorderPanel;
  /** 5.o moments worth watching. */
  highlights: Highlight[];
  /** 5.s who could see whom (needs the map file). */
  sightlines?: SightlineData;
  /** 5.u the recorder's aim: reaction time, crosshair placement, shooting while moving (POV demos only). */
  aim?: AimPanel;
}

/** 5.r: another recording of the same match, found in the library. */
export interface CombinedRecording {
  key: string;
  name: string;
  recording: 'POV' | 'HLTV';
  /** 'same-half' = the same rounds (its positions are added); 'other-half' = the teams' other half of the match. */
  relation: 'same-half' | 'other-half';
  /** Same half: its clock + offset = this demo's clock (seconds), kills lined up and the largest gap left. */
  offset?: number;
  killsLinedUp?: number;
  kills?: number;
  maxGap?: number;
  /** Same half: rounds of this demo it also covers. */
  rounds?: number;
  /** Same half: positions it adds (points) and players this demo never placed before. */
  added?: { seen: number; radar: number; heard: number; grenades: number; deaths: number; newPlayers: string[] };
  /** Other half: its score per clan tag (or side name). */
  score?: { tag: string; side: 'T' | 'CT'; rounds: number }[];
  /** Read problem, if it couldn't be used. */
  error?: string;
}

/** 5.r: this demo combined with the other recordings of its match. */
export interface CombinedData {
  key: string;
  recordings: CombinedRecording[];
  /** Both halves found: rounds won per team over the whole match. */
  fullMatch?: { teams: { tag: string; rounds: number; halves: number[] }[]; rounds: number };
  /** Same-half recordings found: share of the time alive with a known position, before and after combining (0–1). */
  coverage?: { before: number; after: number };
  /** Heatmaps from the combined positions (only when same-half recordings were found). */
  heatmap?: HeatmapData;
}

/** 5.o: a moment worth watching; `time` is where to start watching (demo seconds). */
export interface Highlight {
  time: number;
  round: number;
  kind: 'director' | 'multikill' | 'clutch' | 'knife' | 'wallbang' | 'behind';
  title: string;
  players: string[];
  team?: 'T' | 'CT';
  /** 0–15: how interesting (the HLTV director's priority, or ours for the others). */
  priority: number;
}

/** 5.n: the recorder's own data. Times are demo seconds. */
export interface RecorderPanel {
  name: string;
  /** [time, money] at every change. */
  money: [number, number][];
  /** [time, health] at every change. */
  health: [number, number][];
  /** Running speed (units/s), flat [time, speed] about 4 a second while alive. */
  speed: number[];
  /** Keys held: [key ("forward", "jump"…), from, to]. */
  keys: [string, number, number][];
  /** Weapon in his hand from this time on. */
  weapons: [number, string][];
  rounds: {
    round: number; start: number; end: number; freezeEnd?: number; winner?: 'T' | 'CT' | 'draw';
    startMoney?: number; spent: number; endMoney?: number;
    /** Weapons he had in hand this round. */
    weapons: string[];
    kills: number; died?: number;
    damage: { time: number; amount: number }[];
    topSpeed?: number; avgSpeed?: number;
  }[];
}

/** 5.s line of sight between players. Times are demo seconds. */
export interface SightlineData {
  /** Every kill: both positions known, a clear line from the killer's eye at the kill, the angle off the victim's view
   *  (180 = his back), and how long each had been seeing the other (s; undefined = not seen). */
  kills: { time: number; round?: number; killer: string; victim: string; known: boolean; clear?: boolean; offView?: number; killerSaw?: number; victimSaw?: number }[];
  /** Per round: the first time a player saw an enemy after freeze time. */
  firsts: { round: number; time: number; seer: string; seen: string; mutual: boolean }[];
  /** Kills where one player saw the other first (by 0.15 s+), and how many of them the one who saw first won. */
  sawFirst: { fights: number; won: number };
  known: number;
  total: number;
}

/** 5.u summary numbers for a set of moments and shots. */
export interface AimSummaryData {
  /** Times an enemy appeared on his screen. */
  engagements: number;
  /** Appearances he answered with a shot (not counting the anticipated ones). */
  reactions: number;
  /** Median seconds from an enemy being drawn to the first shot at him (≈ ± margin). */
  medianReaction?: number;
  /** Shots faster than a human can react: he expected the enemy (pre-aim, pre-fire). */
  anticipated: number;
  alreadyFiring: number;
  /** Median degrees between his crosshair and the enemy's head when the enemy appeared; and its parts (+ = right/up). */
  medianCrosshair?: number;
  medianCrossH?: number;
  medianCrossV?: number;
  /** Appearances with the crosshair within 5° of the head. */
  within5: number;
  shots: number;
  accurate: number;
  moving: number;
  air: number;
}

/** 5.u the recorder's aim. Times are demo seconds; `clock` = seconds after freeze time. */
export interface AimPanel {
  name: string;
  team: 'T' | 'CT';
  /** 'sight' = on screen with a clear line through the map; 'view' = on screen only (no map file: walls not checked). */
  method: 'sight' | 'view';
  /** How often other players' positions arrived (s, median), the ± margin shown on reaction times, and how late the
   *  game drew a player after his position arrived. */
  updateInterval: number;
  margin: number;
  drawDelay: number;
  summary: AimSummaryData;
  engagements: {
    round: number; time: number; clock: number; enemy: string; distance: number;
    crosshair: number; crossH: number; crossV: number;
    reaction?: number; anticipated?: boolean; alreadyFiring?: boolean; weapon?: string; outcome?: 'won' | 'lost';
  }[];
  /** Shots per weapon: accurate, too fast (moving), in the air; limit = accurate-speed limit (null = none on the ground). */
  weapons: { weapon: string; limit: number | null; shots: number; accurate: number; moving: number; air: number; medianMovingSpeed?: number }[];
  rounds: ({ round: number } & AimSummaryData)[];
}

export type SoundKind = 'step' | 'hit' | 'death' | 'weapon' | 'other';

/** 5.q: what the recorder could know about the other team, per round. Times are demo seconds; positions picture pixels. */
export interface SightingsData {
  recorder: string;
  team: 'T' | 'CT';
  /** 'sight' = in his field of view with a clear line (map file used); 'view-area' = the server sent the enemy's
   *  position (without the map file: walls inside that area can still hide him). */
  method: 'sight' | 'view-area';
  rounds: SightRound[];
}

export interface SightRound {
  round: number;
  start: number;
  end: number;
  freezeEnd?: number;
  roundEnd?: number;
  winner?: 'T' | 'CT' | 'draw';
  /** When the recorder died (nothing after that counts: he was watching teammates). */
  recorderDied?: number;
  /** The first enemy seen or heard after freeze time. */
  firstContact?: { time: number; name: string; how: 'seen' | 'heard'; x: number; y: number; weapon?: string; sound?: SoundKind; site?: string };
  enemies: SightEnemy[];
}

export interface SightEnemy {
  name: string;
  team: 'T' | 'CT';
  /** Each time he was in the recorder's view area: from, to, weapon mostly held, % of the time crouching, where first. */
  seen: { from: number; to: number; weapon?: string; crouch: number; x: number; y: number }[];
  /** Sounds he made while not in view: footsteps, getting hit, weapon handling… */
  sounds: { time: number; x: number; y: number; kind: SoundKind }[];
  /** Where he moved while in view: flat [time, x, y], with -1,-1,-1 between sightings. */
  path: number[];
  died?: number;
  seenSeconds: number;
}

/** 5.j: one round for the radar replay. Times are demo seconds; positions are picture pixels (as the heatmaps). */
export interface ReplayData {
  round: number;
  /** From the round's start (freeze time) to the next round's start. */
  start: number;
  end: number;
  freezeEnd?: number;
  roundEnd?: number;
  winner?: 'T' | 'CT' | 'draw';
  reason?: string;
  players: ReplayPlayer[];
  kills: HeatKill[];
  bomb: { time: number; kind: string; x?: number; y?: number }[];
  recording: 'POV' | 'HLTV';
  /** True when estimated positions were worked out (needs the map file). */
  estimates: boolean;
  /** Grenades while visible: points flat [time, x, y]; the last point is where it went off (or lay smoking).
   *  Thrower = the player standing where it was first seen, when there was one. */
  grenades: { kind: 'he' | 'flash' | 'smoke'; points: number[]; thrower?: string; team?: 'T' | 'CT' }[];
  /** Who had the bomb: [from, to, name] (worked out from drops, pick-ups and who held it). */
  carrier: [number, number, string][];
  /** Picture pixels per game unit. */
  unitPx: number;
}

export interface ReplayPlayer {
  name: string;
  team?: 'T' | 'CT';
  recorder: boolean;
  /** Seen exactly: flat [time, x, y, view direction in picture degrees (0 = right, clockwise; -1 = unknown), alive 1/0] … */
  seen: number[];
  /** Teammate on the radar (POV): flat [time, x, y] … */
  radar: number[];
  /** A sound he made (footsteps, shots…): flat [time, x, y] … */
  heard: number[];
  /** Weapon in hand from this time on. */
  weapons: [number, string][];
  /** Estimated positions (2.16) every 0.25 s where none is known: flat [time, x, y, uncertainty radius (pixels),
   *  confidence %, held (1 = after his last known position), impossible (1 = couldn't be walked in the time)] … */
  est?: number[];
}

/** 5.k: what the Heatmaps tab draws, in picture pixels (width x height). */
export interface HeatmapData {
  width: number;
  height: number;
  /** True: draw over the details' overview picture (d.map.image), which fits this map version. */
  useMapPicture: boolean;
  /** Otherwise the map's floor drawn from the map file, as an SVG path. */
  floorPath?: string;
  /** Why the background is drawn or missing, in plain words. */
  note?: string;
  sites: { letter: string; x: number; y: number }[];
  kills: HeatKill[];
  /** 5.w grenades: thrown from (fx, fy) → went off / landed (tx, ty); flight in seconds. */
  grenades: { kind: 'he' | 'flash' | 'smoke'; time: number; round?: number; fx: number; fy: number; tx: number; ty: number; flight: number; thrower?: string; team?: 'T' | 'CT' }[];
  plants: { x: number; y: number; round?: number; time: number; site?: string }[];
  /** Time spent per player: [cell index, count, round] (round 0 = outside the rounds); cell index = row * (width / cell)
   *  + column; one count = `step` seconds. */
  heat: Record<string, { team?: 'T' | 'CT'; cells: [number, number, number][] }>;
  cell: number;
  step: number;
  recording: 'POV' | 'HLTV';
}

export interface HeatKill {
  time: number;
  round?: number;
  killer: string;
  killerTeam?: 'T' | 'CT';
  victim: string;
  victimTeam?: 'T' | 'CT';
  weapon: string;
  headshot: boolean;
  teamKill: boolean;
  suicide: boolean;
  /** Where the victim died: the body (corpse) or, without one, his last known position. */
  vx: number;
  vy: number;
  victimFrom: 'corpse' | 'seen' | 'radar' | 'heard';
  /** Where the killer stood, when known (within about a second). */
  kx?: number;
  ky?: number;
  killerFrom?: 'seen' | 'radar' | 'heard';
  /** Killer to victim in game units (1 unit ≈ 1 inch). */
  distance?: number;
}

/** A part of the demo: warm-up (before round 1), a round (its start to the next round's start), or after the match. */
export interface Period {
  id: string;
  label: string;
  /** Round number (rounds only). */
  round?: number;
  start: number;
  end: number;
  /** Rounds: end of freeze time and end of the round. */
  freezeEnd?: number;
  roundEnd?: number;
  winner?: 'T' | 'CT' | 'draw';
}

/** Chat channel: everyone, team only, dead players (all or team), spectators, HLTV viewers, the server. */
export type ChatChannel = 'all' | 'team' | 'dead' | 'dead-team' | 'spectator' | 'hltv' | 'server';
/** Radio kind: chosen from the radio menu, automatic (grenade thrown, round start), or the game's own announcement. */
export type RadioKind = 'player' | 'grenade' | 'round-start' | 'game';

export interface LogEntry {
  time: number;
  /** Period id (see Period). */
  period: string;
  kind: 'chat' | 'radio';
  channel?: ChatChannel;
  radio?: RadioKind;
  who?: string;
  team?: 'T' | 'CT';
  /** The message (chat), or the radio call as the game says it ("Roger that."). */
  text: string;
}

export interface RadioSummary {
  name: string;
  team?: 'T' | 'CT';
  /** Calls chosen from the radio menu. */
  calls: number;
  /** "Fire in the hole!" calls (one per grenade thrown). */
  grenades: number;
  /** Most used calls, most first. */
  top: { text: string; count: number }[];
}

export interface VoiceRow {
  name: string;
  team?: 'T' | 'CT';
  /** Talk bursts as [start, end] in demo seconds. */
  bursts: [number, number][];
  /** Sum of the bursts' lengths. */
  seconds: number;
}

export interface OverviewInfo {
  hostName?: string;
  serverBuild?: number;
  maxClients?: number;
  voiceCodec?: string;
  voiceQuality?: number;
  /** The recorder's measured network updates per second and frames per second. */
  measuredUpdatesPerSecond?: number;
  measuredFps?: number;
  restarts: number;
  liveStart?: number;
  /** Server messages, e.g. "CAL config file has been executed". */
  serverMessages: string[];
  network: NetworkRow[];
}

export interface NetworkRow {
  name: string;
  team?: 'T' | 'CT';
  rate?: string;
  updateRate?: string;
  /** cl_lw and cl_lc. */
  clientWeapons?: string;
  lagCompensation?: string;
  /** Changes during the demo, e.g. "rate 25000 at 3:12". */
  changes: string[];
  recorder: boolean;
}

export interface RoundDetail {
  number: number;
  winner?: 'T' | 'CT' | 'draw';
  reason?: string;
  scoreT?: number;
  scoreCT?: number;
  /** From the end of freeze time to the round's end. */
  seconds: number;
  /** Kills, `at` = seconds after freeze time ended. */
  kills: { at: number; killer: string; victim: string; killerTeam?: 'T' | 'CT'; victimTeam?: 'T' | 'CT'; weapon: string; headshot: boolean; teamKill: boolean }[];
  plantedAt?: number;
  bombEnd?: { kind: 'defused' | 'exploded'; at: number };
  /** Seconds from plant to defuse/explosion. */
  bombTimer?: number;
  /** 5.t players alive: at the start of the round (after freeze time) and after each change, `at` = seconds after
   *  freeze time ended; a change is a death or a player leaving the server. */
  alive: { T: number; CT: number; steps: { at: number; T: number; CT: number; who: string; left?: boolean }[] };
}

/** 5.z one player's connection as the scoreboard showed it. */
export interface LagPlayer {
  name: string;
  team?: 'T' | 'CT';
  recorder: boolean;
  /** Ping samples (at most one a second), median, 95th percentile and highest, in ms; average loss in %. */
  samples: number;
  median: number;
  p95: number;
  max: number;
  loss: number;
  /** Samples well above his usual ping. */
  spikes: number;
  /** Flat [time, ping, …]. */
  pings: number[];
}

/** 5.z a laggy moment: a ping spike, or the recorder losing / being choked several packets in 2 s. */
export interface LagMoment {
  time: number;
  end: number;
  round?: number;
  kind: 'ping' | 'lost' | 'choke';
  who: string;
  /** Highest ping (ms), or packets lost / choked in the window. */
  worst: number;
}

/** 5.z the Lag tab. */
export interface LagData {
  seconds: number;
  players: LagPlayer[];
  /** POV demos: the recorder's own connection. `lost` is flat [time, packets, …]. */
  recorder?: { name: string; choke: number[]; lost: number[]; lostTotal: number };
  moments: LagMoment[];
  rounds: { number: number; start: number; end: number }[];
  liveStart?: number;
  /** POV demos only have pings while the recorder held the scoreboard open. */
  pingsWhenScoreboardOpen: boolean;
}

/** 5.t momentum over the demo, from the players-alive counts. */
export interface Momentum {
  /** Rounds with an opening kill, and how many the side that got it won. */
  openings: number;
  openingWins: number;
  /** Rounds won by a side that was down by 2+ players at some point (round, side, worst gap). */
  comebacks: { round: number; side: 'T' | 'CT'; down: number }[];
}

export interface StatRow {
  name: string;
  team: 'T' | 'CT';
  recorder: boolean;
  kills: number;
  deaths: number;
  headshots: number;
  teamKills: number;
  suicides: number;
  /** Enemy kills per weapon. */
  weapons: Record<string, number>;
  /** Rounds with 2, 3, 4 and 5 enemy kills. */
  multiKills: { 2: number; 3: number; 4: number; 5: number };
  firstKills: number;
  firstDeaths: number;
  /** Rounds won alone against `vs` enemies. */
  clutches: { round: number; vs: number }[];
  /** Shots fired per weapon. */
  shots: Record<string, number>;
}

export interface TeamDetails {
  /** Clan tag shared by most of the team's players (e.g. "i69"), when there is one. */
  tag?: string;
  players: PlayerRow[];
  /** False when nobody on this team is heard (a POV demo holds only the recorder's team voice). */
  heard: boolean;
}

export interface PlayerRow {
  name: string;
  kills: number;
  deaths: number;
  headshots: number;
  talkSeconds: number;
  recorder: boolean;
}

export interface DetailsMap {
  /** The game's overview picture (data: URL), only when it matches this demo's map version. */
  image?: string;
  /** Bomb sites on the picture (pixels of the 1024x768 image). */
  sites: { letter: string; x: number; y: number }[];
  /** Why there is no picture, in plain words. */
  note?: string;
}

export interface AppSettingsView {
  theme: ThemeChoice;
  /** Where fixed copies are saved. */
  outputFolder: string;
  /** Game folder chosen by hand, if any (otherwise found automatically). */
  gameDir?: string;
  /** Voice cleanup when fixing (on by default). */
  voiceCleanup: boolean;
  /** Folders with old map versions (the map pool). */
  mapFolders: string[];
  /** Processor cores: what is used now, whether the person chose it, the suggested maximum and the most allowed
   * (real cores). */
  cpu: { cores: number; chosen: boolean; suggested: number; max: number };
  /** 5.g5 AI voice enhancement switch (off by default); `active` = on and the model is there. */
  aiVoice: { on: boolean; active: boolean };
  /** 6.7: check GitHub for a newer version when SpaceDemo starts (on by default). */
  updateCheck: boolean;
}

/** 6.7 Updates from GitHub releases. */
export interface UpdateState {
  /** unsupported = development build or not Windows; none = up to date; ready = downloaded, restart to install. */
  stage: 'unsupported' | 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  /** The newer version found. */
  latest?: string;
  /** Its release notes, as plain text. */
  notes?: string;
  /** Download progress, 0–100. */
  percent?: number;
  error?: string;
  /** When GitHub was last asked (ms). */
  checked?: number;
  /** The person started this (Check now / Download): show results and errors; automatic checks stay quiet on errors. */
  manual?: boolean;
}

/** The person's choice and the look actually used (for 'system': Windows' own setting). */
export interface ThemeState {
  choice: ThemeChoice;
  dark: boolean;
}

export interface SpaceDemoApi {
  info(): Promise<AppInfo>;
  findGame(): Promise<GameStatus>;
  getTheme(): Promise<ThemeState>;
  setTheme(theme: ThemeChoice): Promise<ThemeState>;
  /** Called when the look changes (the choice, or Windows switching light/dark). Returns a function that stops it. */
  onThemeChanged(listener: (state: ThemeState) => void): () => void;

  /** Library (plan 4.3). Folders are only read. */
  getLibrary(): Promise<LibraryState>;
  /** Adds folders (or single .dem / .zip files). No paths = ask with Windows' folder picker. */
  addToLibrary(paths?: string[]): Promise<LibraryState>;
  removeFromLibrary(path: string): Promise<LibraryState>;
  rescanLibrary(): Promise<LibraryState>;
  onLibraryChanged(listener: (state: LibraryState) => void): () => void;
  /** 6.1: a .dem opened from Explorer (file association): its path, to show its details. */
  onOpenDemo(listener: (path: string) => void): () => void;
  /** The .dem SpaceDemo was started with, once (then undefined). */
  takeOpenDemo(): Promise<string | undefined>;
  /** The file path of a file dropped on the window. */
  pathForFile(file: File): string;
  /** Opens Windows Explorer with this file selected (read-only). */
  showInFolder(path: string): Promise<void>;

  /** Details of a library demo (plan 4.4), by its library key. Reads the demo; changes nothing. */
  getDemoDetails(key: string): Promise<DemoDetails | { error: string }>;
  /** 5.j: one round of a library demo for the radar replay. Reads the demo (kept from the details page); changes nothing. */
  getReplay(key: string, round: number, combined?: boolean): Promise<ReplayData | { error: string }>;
  /** 5.r: the other recordings of this demo's match in the library, lined up and combined. Reads them; changes nothing. */
  getCombined(key: string): Promise<CombinedData | { error: string }>;

  /** 5.p Players page: totals over the library (reads new demos in the background; updates come through onPlayersChanged). */
  getPlayers(): Promise<PlayersView>;
  onPlayersChanged(listener: (view: PlayersView) => void): () => void;
  /** Count `alias` as `into` from now on (saved in the settings). */
  mergePlayers(alias: string, into: string): Promise<PlayersView>;
  unmergePlayer(alias: string): Promise<PlayersView>;
  /** The owner says these two are different people: don't suggest them again. */
  rejectPlayerSuggestion(a: string, b: string): Promise<PlayersView>;

  /** Watch (plan 4.5): what will happen, then fix if needed and start the game. Progress comes through onWatchProgress. */
  getWatchInfo(key: string): Promise<WatchInfo | { error: string }>;
  watch(key: string, options: { speed?: number; keepCopy?: boolean }): Promise<WatchProgress>;
  onWatchProgress(listener: (p: WatchProgress) => void): () => void;

  /** Fix & convert (plan 4.6): fix library demos, or files (no paths = Windows' file picker). Originals are only read. */
  fixDemos(keys: string[]): Promise<FixBatchState>;
  fixFiles(paths?: string[]): Promise<FixBatchState>;
  stopFixing(): Promise<FixBatchState>;
  getFixBatch(): Promise<FixBatchState>;
  onFixBatch(listener: (s: FixBatchState) => void): () => void;
  /** Opens the fixed-demos folder in Explorer. */
  openOutputFolder(): Promise<void>;
  /** 6.7 Updates. */
  getUpdate(): Promise<UpdateState>;
  checkForUpdate(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  /** Closes SpaceDemo, installs the downloaded update and starts it again. */
  installUpdate(): Promise<void>;
  setUpdateCheck(on: boolean): Promise<AppSettingsView>;
  onUpdate(listener: (s: UpdateState) => void): () => void;
  /** 6.4: opens THIRD-PARTY-NOTICES.txt (or LICENSE.txt) in Windows' text viewer; '' = opened, else the problem. */
  openLicence(which: 'notices' | 'licence'): Promise<string>;

  getSettings(): Promise<AppSettingsView>;
  /** Choose where fixed copies go (folder picker). */
  chooseOutputFolder(): Promise<AppSettingsView>;
  /** Plan 4.7: the game folder by hand (no path = folder picker); the result says why a folder can't be used. */
  chooseGameFolder(path?: string): Promise<AppSettingsView & { problem?: string }>;
  /** Back to finding the game automatically. */
  clearGameFolder(): Promise<AppSettingsView>;
  setVoiceCleanup(on: boolean): Promise<AppSettingsView>;
  /** 5.g5: AI voice enhancement on/off (fixed copies made the other way are fixed again when watched or fixed). */
  setAiVoice(on: boolean): Promise<AppSettingsView>;
  /** 4.10: AI voice on/off for one library demo (only this demo; Settings stays the default for the others). */
  setDemoAiVoice(key: string, on: boolean): Promise<void>;
  getAiModel(): Promise<AiModelState>;
  downloadAiModel(): Promise<AiModelState>;
  /** No path = Windows' file picker. */
  chooseAiModel(path?: string): Promise<AiModelState>;
  onAiModel(listener: (s: AiModelState) => void): () => void;
  /** Processor cores SpaceDemo may use; null = back to the suggested maximum. */
  setCpuCores(cores: number | null): Promise<AppSettingsView>;
  /** Adds a map-pool folder (no path = ask with the folder picker). */
  addMapFolder(path?: string): Promise<AppSettingsView>;
  removeMapFolder(path: string): Promise<AppSettingsView>;

  /** 5.v voice to text: the speech model (download it once, or choose a model file you have; no path = file picker). */
  getSpeechModel(): Promise<SpeechModelState>;
  downloadSpeechModel(): Promise<SpeechModelState>;
  chooseSpeechModel(path?: string): Promise<SpeechModelState>;
  onSpeechModel(listener: (s: SpeechModelState) => void): () => void;
  /** A demo's transcript (kept once made); start turns its voice into text in the background, updates come through
   *  onTranscript. One demo at a time. */
  getTranscript(key: string): Promise<TranscriptState>;
  startTranscript(key: string): Promise<TranscriptState>;
  stopTranscript(): Promise<void>;
  onTranscript(listener: (s: TranscriptState) => void): () => void;
}

/** 5.g5 the AI voice model (VoiceFixer, compressed): downloaded once, or a file the person has. */
export interface AiModelState {
  path?: string;
  chosenByHand: boolean;
  /** Download size (bytes). */
  size: number;
  downloading?: { done: number; total: number };
  problem?: string;
}

/** 5.v the speech model and the speech helper. */
export interface SpeechModelState {
  /** The model file to use, when there is one. */
  path?: string;
  chosenByHand: boolean;
  /** Our speech helper (spacedemo-whisper.exe) is in place. */
  helper: boolean;
  /** Download size (bytes) and progress while downloading. */
  size: number;
  downloading?: { done: number; total: number };
  problem?: string;
}

/** 5.v one talk burst as text. */
export interface TranscriptLine {
  /** Demo seconds. */
  time: number;
  end: number;
  player?: string;
  text: string;
}

export interface TranscriptState {
  key: string;
  status: 'none' | 'working' | 'done' | 'failed';
  /** Talk bursts done / to do while working. */
  done?: number;
  total?: number;
  /** Talk bursts with text (empty ones — noise, silence — are left out). */
  lines?: TranscriptLine[];
  /** Model file name it was made with, and when (ms). */
  model?: string;
  madeAt?: number;
  note?: string;
  error?: string;
}

/** IPC channel names (one place, so main and preload can't drift apart). */
export const IPC = {
  info: 'app:info',
  findGame: 'game:find',
  getTheme: 'theme:get',
  setTheme: 'theme:set',
  themeChanged: 'theme:changed',
  libraryGet: 'library:get',
  libraryAdd: 'library:add',
  libraryRemove: 'library:remove',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
  openDemo: 'app:open-demo',
  takeOpenDemo: 'app:take-open-demo',
  showInFolder: 'shell:show-in-folder',
  demoDetails: 'library:details',
  demoReplay: 'library:replay',
  demoCombined: 'library:combined',
  playersGet: 'players:get',
  playersChanged: 'players:changed',
  playersMerge: 'players:merge',
  playersUnmerge: 'players:unmerge',
  playersReject: 'players:reject',
  watchInfo: 'watch:info',
  watchStart: 'watch:start',
  watchProgress: 'watch:progress',
  outputFolderChoose: 'settings:output-folder',
  fixDemos: 'fix:demos',
  fixFiles: 'fix:files',
  fixStop: 'fix:stop',
  fixGet: 'fix:get',
  fixChanged: 'fix:changed',
  openOutput: 'shell:open-output',
  openLicence: 'shell:open-licence',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateChanged: 'update:changed',
  updateCheckSet: 'settings:update-check',
  gameFolderChoose: 'settings:game-folder',
  gameFolderClear: 'settings:game-folder-clear',
  voiceCleanupSet: 'settings:voice-cleanup',
  cpuCoresSet: 'settings:cpu-cores',
  aiVoiceSet: 'settings:ai-voice',
  aiVoiceDemoSet: 'library:ai-voice',
  aiModelGet: 'ai:model-get',
  aiModelDownload: 'ai:model-download',
  aiModelChoose: 'ai:model-choose',
  aiModelChanged: 'ai:model-changed',
  settingsGet: 'settings:get',
  mapFolderAdd: 'settings:map-folder-add',
  mapFolderRemove: 'settings:map-folder-remove',
  speechModelGet: 'speech:model-get',
  speechModelDownload: 'speech:model-download',
  speechModelChoose: 'speech:model-choose',
  speechModelChanged: 'speech:model-changed',
  transcriptGet: 'speech:transcript-get',
  transcriptStart: 'speech:transcript-start',
  transcriptStop: 'speech:transcript-stop',
  transcriptChanged: 'speech:transcript-changed',
} as const;

declare global {
  interface Window {
    spacedemo: SpaceDemoApi;
  }
}

/** 5.p: a player's userinfo fingerprint. Secret values are hashes only. */
export interface PlayerFingerprint {
  /** Public ids the server added ("*tracker", "*sid"…). */
  ids: Record<string, string>;
  /** Hashes of private settings (setinfo passwords): compared, never shown. */
  secrets: string[];
  /** The list of his userinfo keys (settings he set), sorted. */
  keys: string;
  /** Personal settings worth comparing: colours, rates… */
  settings: Record<string, string>;
}

/** 5.p: one demo's players (kept in the players cache). */
export interface DemoPlayers {
  key: string;
  name: string;
  date: number;
  map: string;
  recording: 'POV' | 'HLTV';
  rounds: number;
  /** Same text = the same match half recorded twice. */
  signature: string;
  players: {
    name: string; team: 'T' | 'CT'; recorder: boolean; tag?: string;
    kills: number; deaths: number; headshots: number; teamKills: number; suicides: number;
    firstKills: number; multi3: number; clutches: number;
    fp: PlayerFingerprint;
    otherNames: string[];
  }[];
}

export interface PlayerTotals {
  name: string;
  /** Other names merged into this one. */
  aliases: string[];
  tags: string[];
  demos: number;
  rounds: number;
  kills: number; deaths: number; headshots: number; teamKills: number;
  firstKills: number; multi3: number; clutches: number;
  demoKeys: string[];
}

export interface RenameSuggestion {
  a: string;
  b: string;
  score: number;
  reasons: string[];
}

/** 5.p: the Players page. */
export interface PlayersView {
  players: PlayerTotals[];
  suggestions: RenameSuggestion[];
  /** Demos read; countedAs = the key of the recording of the same match half that is counted instead. */
  demos: { key: string; name: string; date: number; map: string; recording: 'POV' | 'HLTV'; countedAs?: string }[];
  merges: Record<string, string>;
  /** While demos are being read. */
  progress?: { done: number; total: number };
}
