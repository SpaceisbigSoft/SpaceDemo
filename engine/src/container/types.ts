// Typed model of a GoldSrc .dem file. See docs/FORMAT.md for the layout and its sources.

export const HEADER_SIZE = 544;
export const DIRECTORY_ENTRY_SIZE = 92;
export const MAX_DIRECTORY_ENTRIES = 1024;

export interface DemoHeader {
  magic: string;
  demoProtocol: number;
  networkProtocol: number;
  mapName: string;
  gameDir: string;
  mapChecksum: number;
  directoryOffset: number;
  /** The original 544 header bytes, kept so unchanged headers are written back exactly. */
  raw: Uint8Array;
}

export interface DirectoryEntry {
  type: number;
  description: string;
  flags: number;
  cdTrack: number;
  trackTime: number;
  frameCount: number;
  offset: number;
  length: number;
}

export const enum FrameType {
  NetMessagesLoading = 0,
  NetMessages = 1,
  DemoStart = 2,
  ConsoleCommand = 3,
  ClientData = 4,
  SectionEnd = 5,
  Event = 6,
  WeaponAnimation = 7,
  Sound = 8,
  DemoBuffer = 9,
}

interface FrameBase {
  time: number;
  /** The engine's frame counter stored in the frame header. */
  index: number;
}

/** A frame carrying server network messages. */
export interface NetFrame extends FrameBase {
  type: FrameType.NetMessages | FrameType.NetMessagesLoading;
  /** Client view/sequence info stored before the messages (fixed size per protocol). Kept as raw bytes. */
  info: Uint8Array;
  messages: Uint8Array;
}

export interface CommandFrame extends FrameBase {
  type: FrameType.ConsoleCommand;
  command: string;
  /** The full 64-byte field (bytes after the text are kept as found). */
  raw: Uint8Array;
}

/** Frames whose content we keep as raw bytes. */
export interface OpaqueFrame extends FrameBase {
  type: FrameType.DemoStart | FrameType.ClientData | FrameType.SectionEnd | FrameType.Event | FrameType.WeaponAnimation | FrameType.Sound | FrameType.DemoBuffer;
  payload: Uint8Array;
}

export type Frame = NetFrame | CommandFrame | OpaqueFrame;

export interface Section {
  /** The directory entry this section came from (null when the directory was missing and sections were found by scanning). */
  entry: DirectoryEntry | null;
  frames: Frame[];
}

export interface DemoFile {
  header: DemoHeader;
  sections: Section[];
  /** Problems found while reading, in plain language. Empty for a healthy file. */
  problems: string[];
  /** True when the directory was missing or unusable and the frames were recovered by scanning. */
  recovered: boolean;
}

/** Size of the info block in front of network messages. Protocol 44+: 436 bytes view info + 28 bytes sequence info. */
export function netInfoSize(networkProtocol: number): number {
  return networkProtocol <= 43 ? 560 : 464;
}
