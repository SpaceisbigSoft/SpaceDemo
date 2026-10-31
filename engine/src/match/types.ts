// Match information extracted from a demo (plan 2.12). See docs/FORMAT.md "Match information in CS 1.5 demos".
// Times are demo playback seconds. Players are identified by `id` = the server's user id, which is unique per
// connection: a slot (0-based; entity number = slot + 1) can be reused by another player after someone leaves.

export type Team = 'T' | 'CT' | 'SPECTATOR' | 'UNASSIGNED';
export type Vec3 = [number, number, number];

export interface MatchPlayer {
  /** Server user id (unique per connection). */
  id: number;
  slot: number;
  /** Last name used. */
  name: string;
  /** Every name used in the demo, in order (name changes). */
  names: string[];
  /** Last team seen. */
  team?: Team;
  isHltv: boolean;
  isRecorder: boolean;
  /** Demo time the player left the server, if they did. */
  leftAt?: number;
  /** Final frags/deaths as sent by the server (ScoreInfo). */
  frags?: number;
  /** CS 1.6: bomb points in `frags` (3 per bomb that exploded after his plant, or that he defused). */
  bonusFrags?: number;
  deaths?: number;
  /** Shots fired per weapon (weapon-fire events; the recorder's own shots come from the demo's event frames). */
  shots: Record<string, number>;
  /** The player's last userinfo as the server sent it (model, colours, rates, setinfo keys…). */
  userinfo?: Record<string, string>;
}

export type RoundEndReason = 'eliminated' | 'bomb exploded' | 'bomb defused' | 'time ran out' | 'draw' | 'hostages rescued' | 'VIP escaped' | 'VIP killed' | 'other';

export interface Round {
  number: number;
  start: number;
  /** End of freeze time (when the round timer starts), if seen. */
  freezeEnd?: number;
  end?: number;
  winner?: 'T' | 'CT' | 'draw';
  reason?: RoundEndReason;
  /** Team score after this round, as sent by the server. */
  scoreT?: number;
  scoreCT?: number;
}

export interface Kill {
  time: number;
  round?: number;
  /** Killer player id, or null when the world killed (falls, bomb). */
  killer: number | null;
  victim: number;
  headshot: boolean;
  weapon: string;
  killerTeam?: Team;
  victimTeam?: Team;
  teamKill: boolean;
  suicide: boolean;
}

export interface Death {
  time: number;
  round?: number;
  /** Victim player id. CS 1.5 corpses carry no player number, so they are matched to kills: same team (model) and
   *  4–6 s after the kill (death cam ending) = "timing"; otherwise the earliest unmatched death of that team in the
   *  same round = "round"; undefined when no kill fits. */
  victim?: number;
  match?: 'timing' | 'round';
  model: string;
  position: Vec3;
}

export interface ChatLine {
  time: number;
  round?: number;
  /** Player id, or undefined for server/HLTV messages. */
  sender?: number;
  /** Text as shown in game, without colour control characters. */
  text: string;
  teamOnly: boolean;
  dead: boolean;
}

export interface RadioCall {
  time: number;
  round?: number;
  sender?: number;
  /** Radio message key, e.g. "ROGER", "ctwin", "FIREINHOLE". */
  message: string;
}

export interface BombEvent {
  time: number;
  round?: number;
  kind: 'picked up' | 'dropped' | 'planted' | 'defused' | 'exploded' | 'defusing';
  position?: Vec3;
}

export interface VoiceBurst {
  player?: number;
  slot: number;
  start: number;
  end: number;
  packets: number;
}

export interface RecorderData {
  /** Money after every change. */
  money: { time: number; money: number }[];
  health: { time: number; health: number }[];
  damageTaken: { time: number; amount: number; from?: Vec3 }[];
  /** Buy menus opened (e.g. "#Buy", "#CT_BuyRifle"). */
  menus: { time: number; menu: string }[];
  /** Weapon-fire events played locally (the recorder's own shots). */
  shots: number;
  /** The weapon in his hand from this time on (CurWeapon). */
  weapons: { time: number; weapon: string }[];
  /** Key presses recorded as console commands (+attack, +jump, …). */
  keys: { time: number; command: string }[];
}

/** One known position of a player (plan 2.13). */
export interface TrackPoint {
  time: number;
  x: number;
  y: number;
  z: number;
  /** View direction (degrees, 0 = +x, counter-clockwise), when seen. */
  yaw?: number;
  /** Weapon in hand ("ak47", "knife", …), when seen. */
  weapon?: string;
  /** False after the player died in this round (the body can stay visible). */
  alive: boolean;
  /** Crouching (the entity's small hull), when seen. */
  crouch?: boolean;
}

/** Where a player is known to be, by source (plan 2.13). POV demos: seen only within the recorder's view area. */
export interface PlayerTrack {
  player: number;
  /** Exact positions from the entity data (~10 per second while known). */
  seen: TrackPoint[];
  /** Teammate positions from the radar (POV, ~1 per second, 1/8-unit precision). */
  radar: TrackPoint[];
  /** Positions of sounds the player made (footsteps, shots, reloads…). */
  heard: (TrackPoint & { sound: string })[];
}

export interface Grenade {
  kind: 'he' | 'flash' | 'smoke';
  points: { time: number; x: number; y: number; z: number }[];
}

/** 5.z the connection over time. Times are demo seconds. */
export interface NetData {
  /** Scoreboard ping (ms) and loss (%) per player, at most one sample per player per second. Pings of 999+ (still
   *  connecting) are left out. */
  pings: { time: number; player: number; ping: number; loss: number }[];
  /** Moments the server held a packet back from the recorder (svc_choke; POV demos). */
  choke: number[];
  /** Packets from the server that never reached the recorder (gaps in the packet numbers). */
  lost: { time: number; packets: number }[];
}

/** 5.u The recorder's own view at one demo frame (POV; every frame, ~20–30 per second). */
export interface ViewSample {
  /** Demo seconds (to the millisecond). */
  time: number;
  /** View angles in degrees: pitch (+ = looking down, client convention), yaw (0 = +x, counter-clockwise). */
  pitch: number;
  yaw: number;
  /** Eye position (view origin). */
  eye: Vec3;
  /** Horizontal speed (units/s) from the client's own movement prediction (simvel). */
  speed: number;
  onGround: boolean;
  duck: boolean;
  /** Fire button held in this frame's user command (IN_ATTACK). */
  attack: boolean;
  /** Alive (health > 0 and a view height: not dead or spectating). */
  alive: boolean;
}

/** 5.u Data for recorder aim coaching (only with `extractMatch(demo, { aim: true })`, POV demos). */
export interface AimData {
  view: ViewSample[];
  /** The recorder's own weapon events (exact shot times) and the event's name ("ak47", "usp", "knife", …). */
  shots: { time: number; weapon: string }[];
  /** Every packet's position of every other player while the server sends him (not thinned like `tracks`). Flat
   *  list per player: time, x, y, z, crouch (1/0) repeated. */
  players: { player: number; points: number[] }[];
}

export interface MatchData {
  map: string;
  recording: 'POV' | 'HLTV';
  recorderSlot?: number;
  /** Player id of the recorder (POV). */
  recorderId?: number;
  /** Number of match restarts (warm-up) removed; data before the last restart is dropped. */
  restarts: number;
  liveStart?: number;
  players: MatchPlayer[];
  /** Completed rounds (winner known). */
  rounds: Round[];
  kills: Kill[];
  deaths: Death[];
  chat: ChatLine[];
  radio: RadioCall[];
  bomb: BombEvent[];
  voice: VoiceBurst[];
  /** Final team score sent by the server (may be missing in HLTV demos). */
  scoreT?: number;
  scoreCT?: number;
  recorder?: RecorderData;
  /** 5.z pings, choke and lost packets. */
  net?: NetData;
  /** HLTV director events (type 2 = highlight) with their time. */
  director: { time: number; type: number; entity1?: number; entity2?: number; flags?: number }[];
  /** Position tracks per player (only with `extractMatch(demo, { tracks: true })`). */
  tracks?: PlayerTrack[];
  /** Thrown grenades while visible (only with tracks): kind and positions; the last point is where it went off (HE,
   *  flash) or where the smoke grenade lay while smoking. POV demos only see grenades in the recorder's view area. */
  grenades?: Grenade[];
  /** 5.u recorder view, shots and full-rate player positions (only with `extractMatch(demo, { aim: true })`). */
  aim?: AimData;
}

export interface MatchCheck {
  /** Kills counted from the kill feed equal the server's final frags for every player. */
  fragsMatch: boolean;
  fragMismatches: { player: number; name: string; counted: number; server: number }[];
  /** Rounds won per team equal the server's team score. */
  roundsMatch: boolean;
  roundsWon: { T: number; CT: number };
  serverScore?: { T: number; CT: number };
}
