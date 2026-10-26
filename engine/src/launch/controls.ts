// Playback controls (plan 3.3): key bindings for viewdemo, and putting the person's own settings back afterwards.
//
// The game saves every key binding and archived setting into cstrike\config.cfg when it closes, so bindings made for a
// demo would stay. Owner's choice (2026-10-26): use keys that are normally free, and when the game has closed put those
// keys (and voice_scale) back exactly as they were. A copy of config.cfg from before playback is kept in our own folder
// (cstrike\cdf_test\backup\). Only the lines for our keys and voice_scale are changed; everything else the person changed
// while the game was open is kept.
//
// The controls file lives in our folder (cstrike\cdf_test\cdf_controls.cfg) and is run with +exec on the command line.
// Commands (spike 1.5, build 10210): dem_pause 1/0, dem_speed 0.25..4, dem_jump <s> (relative, then pauses).
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeNewFile } from '../fix/safe-output.js';

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

export interface ControlKeys {
  pause: string;
  slower: string;
  faster: string;
  normal: string;
  back: string;
  forward: string;
}

/** Keys that are not bound in Steam CS 1.6's default config (checked against the owner's config.cfg, 2026-10-26). */
export const DEFAULT_KEYS: ControlKeys = { pause: 'p', slower: 'j', faster: 'l', normal: 'HOME', back: 'F6', forward: 'F7' };

export interface ControlOptions {
  keys?: ControlKeys;
  /** "Mute voice in slow motion" (owner, 2026-10-26; off by default). */
  muteVoiceInSlowMotion?: boolean;
  /** The person's own voice_scale, put back at x1 and faster. */
  voiceScale?: string;
  /** Seconds for the skip keys. */
  skipSeconds?: number;
}

export function speedLabel(s: number): string {
  return s === 0.25 ? '1/4' : s === 0.5 ? '1/2' : String(s);
}

/** The controls file run by +exec. Plain console commands only (bind, alias, echo). */
export function controlsConfig(options: ControlOptions = {}): string {
  const k = options.keys ?? DEFAULT_KEYS;
  const skip = options.skipSeconds ?? 30;
  const lines: string[] = ['// CS Demo Fixer playback keys. Written by the app; your own keys are put back when the game closes.'];
  SPEEDS.forEach((s, i) => {
    const slower = `cdf_s${Math.max(0, i - 1)}`, faster = `cdf_s${Math.min(SPEEDS.length - 1, i + 1)}`;
    const voice = options.muteVoiceInSlowMotion ? (s < 1 ? '; voice_scale 0' : `; voice_scale ${options.voiceScale ?? '1'}`) : '';
    lines.push(`alias cdf_s${i} "dem_speed ${s}${voice}; alias cdf_slower ${slower}; alias cdf_faster ${faster}; echo CDF speed x${speedLabel(s)}"`);
  });
  const normal = SPEEDS.indexOf(1);
  lines.push(
    `alias cdf_slower cdf_s${normal - 1}`,
    `alias cdf_faster cdf_s${normal + 1}`,
    'alias cdf_pause "dem_pause 1; alias cdf_pp cdf_resume; echo CDF paused"',
    'alias cdf_resume "dem_pause 0; alias cdf_pp cdf_pause; echo CDF playing"',
    'alias cdf_pp cdf_pause',
    `alias cdf_back "dem_jump -${skip}; dem_pause 0; alias cdf_pp cdf_pause; echo CDF back ${skip} s"`,
    `alias cdf_fwd "dem_jump ${skip}; dem_pause 0; alias cdf_pp cdf_pause; echo CDF forward ${skip} s"`,
    `bind "${k.pause}" "cdf_pp"`,
    `bind "${k.slower}" "cdf_slower"`,
    `bind "${k.faster}" "cdf_faster"`,
    `bind "${k.normal}" "cdf_s${normal}"`,
    `bind "${k.back}" "cdf_back"`,
    `bind "${k.forward}" "cdf_fwd"`,
    `echo CDF keys: ${k.pause.toUpperCase()} pause/resume, ${k.slower.toUpperCase()}/${k.faster.toUpperCase()} slower/faster, ${k.normal} normal speed, ${k.back}/${k.forward} back/forward ${skip} s`,
  );
  return lines.join('\r\n') + '\r\n';
}

// ---- config.cfg: read what we change, put it back afterwards ----

const BIND = /^\s*bind\s+"([^"]*)"\s+"(.*)"\s*$/i;
const CVAR = (name: string) => new RegExp(`^\\s*${name}\\s+"([^"]*)"\\s*$`, 'i');

/** The person's binding for each key (undefined = not bound) and their voice_scale. */
export function readSettings(configText: string, keys: string[]): { binds: Record<string, string | null>; voiceScale?: string } {
  const binds: Record<string, string | null> = {};
  for (const key of keys) binds[key.toLowerCase()] = null;
  let voiceScale: string | undefined;
  for (const line of configText.split(/\r?\n/)) {
    const b = BIND.exec(line);
    if (b && b[1].toLowerCase() in binds) binds[b[1].toLowerCase()] = b[2];
    const v = CVAR('voice_scale').exec(line);
    if (v) voiceScale = v[1];
  }
  return { binds, voiceScale };
}

/** config.cfg text with our keys and voice_scale put back as they were. Everything else stays as the game wrote it.
 *  `voiceScale` undefined + `dropVoiceScale`: the setting wasn't in the file before, so a line the game added is removed. */
export function restoreSettings(configText: string, saved: { binds: Record<string, string | null>; voiceScale?: string; dropVoiceScale?: boolean }): string {
  const eol = configText.includes('\r\n') ? '\r\n' : '\n';
  const out: string[] = [];
  const done = new Set<string>();
  let afterBinds = -1;
  for (const line of configText.split(/\r?\n/)) {
    const b = BIND.exec(line);
    if (b) {
      const key = b[1].toLowerCase();
      if (key in saved.binds) {
        const orig = saved.binds[key];
        if (orig !== null && !done.has(key)) out.push(`bind "${b[1]}" "${orig}"`);
        done.add(key);
      } else out.push(line);
      afterBinds = out.length;
      continue;
    }
    if (CVAR('voice_scale').test(line)) {
      if (saved.voiceScale !== undefined) out.push(`voice_scale "${saved.voiceScale}"`);
      else if (!saved.dropVoiceScale) out.push(line);
      continue;
    }
    out.push(line);
  }
  // A key that was bound before but whose line the game no longer wrote: add it back after the other binds.
  const missing = Object.entries(saved.binds).filter(([k, v]) => v !== null && !done.has(k)).map(([k, v]) => `bind "${k}" "${v}"`);
  if (missing.length) out.splice(afterBinds < 0 ? 0 : afterBinds, 0, ...missing);
  return out.join(eol);
}

// ---- One playback session: prepare before launch, restore after the game closes ----

export interface Session {
  createdAt: string;
  configPath: string;
  backupPath: string;
  binds: Record<string, string | null>;
  voiceScale?: string;
  /** voice_scale wasn't in config.cfg and we changed it (mute in slow motion): remove the line afterwards. */
  dropVoiceScale?: boolean;
}

export function sessionFile(cstrikeDir: string): string {
  return join(cstrikeDir, 'cdf_test', 'cdf_session.json');
}

/** Writes the controls file and remembers the person's settings. Returns the +exec path for the command line. */
export function prepareControls(cstrikeDir: string, options: ControlOptions = {}, now = new Date()): { execPath: string; session: Session } {
  const keys = options.keys ?? DEFAULT_KEYS;
  const folder = join(cstrikeDir, 'cdf_test');
  mkdirSync(join(folder, 'backup'), { recursive: true });
  const configPath = join(cstrikeDir, 'config.cfg');
  const configText = existsSync(configPath) ? readFileSync(configPath, 'latin1') : '';
  const settings = readSettings(configText, Object.values(keys));
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = join(folder, 'backup', `config ${stamp}.cfg`);
  if (configText) writeNewFile([configPath], backupPath, Buffer.from(configText, 'latin1'));
  // An unfinished earlier session keeps its (older, correct) saved settings.
  const sf = sessionFile(cstrikeDir);
  const earlier = existsSync(sf) ? (JSON.parse(readFileSync(sf, 'utf8')) as Session) : undefined;
  const session: Session = earlier ?? { createdAt: now.toISOString(), configPath, backupPath, binds: settings.binds, voiceScale: settings.voiceScale, dropVoiceScale: settings.voiceScale === undefined && !!options.muteVoiceInSlowMotion };
  if (!earlier) writeNewFile([configPath], sf, Buffer.from(JSON.stringify(session, null, 2), 'utf8'));
  const cfg = controlsConfig({ ...options, voiceScale: session.voiceScale ?? options.voiceScale });
  writeNewFile([configPath], join(folder, 'cdf_controls.cfg'), Buffer.from(cfg, 'latin1'), { overwrite: true });
  return { execPath: 'cdf_test/cdf_controls.cfg', session };
}

/** After the game has closed: put the saved keys and voice_scale back into config.cfg. Safe to call more than once. */
export function restoreControls(cstrikeDir: string): { restored: boolean; message: string } {
  const sf = sessionFile(cstrikeDir);
  if (!existsSync(sf)) return { restored: false, message: 'Nothing to put back.' };
  const session = JSON.parse(readFileSync(sf, 'utf8')) as Session;
  const configPath = join(cstrikeDir, 'config.cfg');
  if (existsSync(configPath)) {
    const now = readFileSync(configPath, 'latin1');
    const fixed = restoreSettings(now, session);
    if (fixed !== now) writeNewFile([sf, session.backupPath], configPath, Buffer.from(fixed, 'latin1'), { overwrite: true });
  }
  unlinkSync(sf);
  return { restored: true, message: `Your own keys and voice volume are back in config.cfg (copy from before: ${session.backupPath}).` };
}
