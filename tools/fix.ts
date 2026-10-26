// Fix an old demo in one step (plans 2.6–2.8): repair, convert to protocol 48, original voice as Steam voice.
//   npm run fix -- <input.dem> <output.dem> [--game <Half-Life folder>] [--asi <mssvoice.asi>] [--decoder helper|emulator] [--cleanup]
// --asi defaults to <game>\mssvoice.asi. The helper (helpers/voice-helper/cdf-voice-helper.exe) is the normal decoder
// on Windows; on Linux it runs under Wine. --decoder emulator = development decoder (python3 + unicorn).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fixDemo } from '../engine/src/fix/fix.js';
import { emulatorDecoder, helperDecoder, type OldVoiceDecoder } from '../engine/src/voice/decoders.js';
import { voiceCleanup } from '../engine/src/voice/cleanup.js';

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? (args.splice(i, 1), true) : false; };
const game = opt('--game'), asiArg = opt('--asi'), decoderArg = opt('--decoder') ?? 'helper', cleanup = flag('--cleanup');
const [input, output] = args;
if (!input || !output || input === output) {
  console.log('Usage: npm run fix -- <input.dem> <output.dem> [--game <Half-Life folder>] [--asi <mssvoice.asi>] [--decoder helper|emulator] [--cleanup]');
  process.exit(1);
}
const asi = asiArg ?? (game ? join(game, 'mssvoice.asi') : undefined);
let decoder: OldVoiceDecoder | undefined;
if (asi && existsSync(asi)) {
  decoder = decoderArg === 'emulator'
    ? emulatorDecoder(asi)
    : helperDecoder(join('helpers', 'voice-helper', 'cdf-voice-helper.exe'), asi, process.platform === 'win32' ? {} : { wine: 'wine' });
}
const t0 = Date.now();
const { bytes, report } = fixDemo(new Uint8Array(readFileSync(input)), { halfLifeDir: game, voiceDecoder: decoder, voiceFilter: cleanup ? voiceCleanup : undefined });
writeFileSync(output, bytes);
console.log(`Fixed: ${output} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (report.recovered) console.log(`  repaired a cut-off recording: ${report.problems.join('; ')}`);
if (report.converted) console.log(`  converted protocol ${report.sourceProtocol} → 48 (${Object.entries(report.conversion).map(([k, v]) => `${k} ${v}`).join(', ')})`);
if (report.voice) console.log(`  voice (${report.voiceCodec} → Steam voice, ${report.voice.decoder}${cleanup ? ', cleanup on' : ''}): ${report.voice.seconds} s in ${report.voice.bursts} talk bursts, ${report.voice.replaced} packets; ${report.voice.emptyDropped} empty dropped`);
for (const n of report.notes) console.log(`  note: ${n}`);
