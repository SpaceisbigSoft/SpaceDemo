// Turns the engine's finder result (plan 3.1) into the small, plain status the window shows. Read-only.
import { basename, dirname } from 'node:path';
import { findGame, type FindOptions, type FindResult } from '../../engine/src/launch/steam.js';
import type { GameStatus } from '../shared/api.js';

export function toGameStatus(found: FindResult): GameStatus {
  const g = found.game;
  return {
    found: !!g,
    gameDir: g?.dir,
    library: g?.library ?? (g ? libraryOf(g.dir) : undefined),
    version: g?.patchVersion,
    buildId: g?.manifest?.buildId,
    steamExe: found.steam?.exe,
    problems: [...found.problems],
    notes: [...found.notes],
  };
}

/** "D:\SteamLibrary\steamapps\common\Half-Life" → "D:\SteamLibrary" (used only when the finder gave no library). */
function libraryOf(gameDir: string): string | undefined {
  const common = dirname(gameDir);
  const steamapps = dirname(common);
  if (basename(common).toLowerCase() === 'common' && basename(steamapps).toLowerCase() === 'steamapps') return dirname(steamapps);
  return undefined;
}

export function gameStatus(options: FindOptions = {}): GameStatus {
  try {
    return toGameStatus(findGame(options));
  } catch (err) {
    return { found: false, problems: [`Looking for the game failed: ${(err as Error).message}`], notes: [] };
  }
}
