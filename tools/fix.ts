// Fix an old demo in one step (plans 2.6–2.8): repair, convert to protocol 48, original voice as Steam voice.
//   npm run fix -- <input.dem> <output.dem> [--game <Half-Life folder>] [--asi <mssvoice.asi>] [--decoder helper|emulator] [--plain] [--overwrite]
// Voice cleanup is ON by default (owner's choice 2026-10-26 after listening); --plain keeps the voice exactly as decoded.
// The original is only read; the output must be a different, new file (see engine/src/fix/safe-output.ts).
// --game defaults to the Steam CS 1.6 found automatically; --asi defaults to <game>\mssvoice.asi. The helper (helpers/voice-helper/cdf-voice-helper.exe) is the normal decoder
// on Windows; on Linux it runs under Wine. --decoder emulator = development decoder (python3 + unicorn).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixDemo } from '../engine/src/fix/fix.js';
import { checkSafeOutput, writeNewFile } from '../engine/src/fix/safe-output.js';
import { emulatorDecoder, helperDecoder, type OldVoiceDecoder } from '../engine/src/voice/decoders.js';
import { voiceCleanup } from '../engine/src/voice/cleanup.js';
import { findGame } from '../engine/src/launch/steam.js';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const game = opt('--game'), asiArg = opt('--asi'), decoderArg = opt('--decoder') ?? 'helper', plain = flag('--plain'), cleanup = !plain, overwrite = flag('--overwrite');
flag('--cleanup'); // accepted for older notes; cleanup is the default
const [input, output] = args;
if (!input || !output) {
  console.log('Usage: npm run fix -- <input.dem> <output.dem> [--game <Half-Life folder>] [--asi <mssvoice.asi>] [--decoder helper|emulator] [--plain] [--overwrite]');
  process.exit(1);
}
// Check before the (slow) work, and again when writing. --overwrite only ever replaces an earlier output, never the input.
checkSafeOutput([input], output, { overwrite });
// No --game: find the Steam copy of CS 1.6 the same way the launcher does (plan 3.1).
const gameDir = game ?? findGame().game?.dir;
if (!game && gameDir) console.log(`Using the game in ${gameDir}`);
const asi = asiArg ?? (gameDir ? join(gameDir, 'mssvoice.asi') : undefined);
let decoder: OldVoiceDecoder | undefined;
if (asi && existsSync(asi)) {
  decoder = decoderArg === 'emulator'
    ? emulatorDecoder(asi)
    : helperDecoder(join('helpers', 'voice-helper', 'cdf-voice-helper.exe'), asi, process.platform === 'win32' ? {} : { wine: 'wine' });
}
const t0 = Date.now();
const { bytes, report } = fixDemo(new Uint8Array(readFileSync(input)), { halfLifeDir: gameDir, voiceDecoder: decoder, voiceFilter: cleanup ? voiceCleanup : undefined });
writeNewFile([input], output, bytes, { overwrite });
console.log(`Fixed: ${output} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (report.recovered) console.log(`  repaired a cut-off recording: ${report.problems.join('; ')}`);
if (report.converted) console.log(`  converted protocol ${report.sourceProtocol} → 48 (${Object.entries(report.conversion).map(([k, v]) => `${k} ${v}`).join(', ')})`);
if (report.voice) console.log(`  voice (${report.voiceCodec} → Steam voice, ${report.voice.decoder}${cleanup ? ', cleanup on' : ', plain'}): ${report.voice.seconds} s in ${report.voice.bursts} talk bursts, ${report.voice.replaced} packets; ${report.voice.emptyDropped} empty dropped`);
for (const n of report.notes) console.log(`  note: ${n}`);
