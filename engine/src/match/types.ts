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
  deaths?: number;
  /** Shots fired per weapon (weapon-fire events; the recorder's own shots come from the demo's event frames). */
  shots: Record<string, number>;
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
  /** Key presses recorded as console commands (+attack, +jump, …). */
  keys: { time: number; command: string }[];
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
  /** HLTV director events (type 2 = highlight) with their time. */
  director: { time: number; type: number }[];
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
