// Decoders for old voice (plan 2.8). All speak one batch protocol, so the engine doesn't care which one runs:
//   request:  u32 count, then per packet u32 stream (one decoder per player), u32 length, bytes
//   response: per packet u32 byte length, then 8 kHz 16-bit mono PCM (length 0 for an empty packet)
// - helperDecoder: our own small Windows program (helpers/voice-helper) that loads the user's own mssvoice.asi from
//   their game folder. It runs as its own process — never inside the game — and no Valve/RAD file is shipped.
// - emulatorDecoder: development and tests only (Python + Unicorn running the same mssvoice.asi in a CPU emulator).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { OldVoicePacket } from './restore.js';

export interface OldVoiceDecoder {
  name: string;
  /** Decodes every packet (in demo order); returns one PCM array per packet. */
  decodeAll(packets: OldVoicePacket[]): Int16Array[];
}

/** Each slot gets its own decoder stream; a new talker in a reused slot keeps the slot's stream (as the game did). */
export function batchRequest(packets: OldVoicePacket[]): Buffer {
  const size = 4 + packets.reduce((n, p) => n + 8 + p.data.length, 0);
  const b = Buffer.alloc(size);
  b.writeUInt32LE(packets.length, 0);
  let at = 4;
  for (const p of packets) {
    b.writeUInt32LE(p.slot, at);
    b.writeUInt32LE(p.data.length, at + 4);
    b.set(p.data, at + 8);
    at += 8 + p.data.length;
  }
  return b;
}

export function parseBatchResponse(b: Buffer, count: number): Int16Array[] {
  const out: Int16Array[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 4 > b.length) throw new Error(`Voice decoder stopped after ${i} of ${count} packets.`);
    const n = b.readUInt32LE(at);
    const bytes = b.subarray(at + 4, at + 4 + n);
    out.push(new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + n)));
    at += 4 + n;
  }
  return out;
}

function run(cmd: string, args: string[], input: Buffer, what: string): Buffer {
  const r = spawnSync(cmd, args, { input, maxBuffer: 1 << 30, env: { ...process.env, WINEDEBUG: '-all' } });
  if (r.error) throw new Error(`${what} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${what} failed (exit ${r.status}): ${r.stderr.toString().trim().slice(0, 500)}`);
  return r.stdout;
}

/**
 * Our Windows helper (helpers/voice-helper/cdf-voice-helper.exe) with the user's own mssvoice.asi.
 * On Linux (development) it runs under Wine when `wine` is given.
 */
export function helperDecoder(helperExe: string, mssvoiceAsi: string, options: { wine?: string } = {}): OldVoiceDecoder {
  return {
    name: 'voice helper',
    decodeAll(packets) {
      const input = batchRequest(packets);
      const out = options.wine ? run(options.wine, [helperExe, mssvoiceAsi], input, 'Voice helper') : run(helperExe, [mssvoiceAsi], input, 'Voice helper');
      return parseBatchResponse(out, packets.length);
    },
  };
}

/** Development/test decoder: tools/dev/miles-emu (needs python3 with unicorn and pefile). */
export function emulatorDecoder(mssvoiceAsi: string, python = 'python3'): OldVoiceDecoder {
  const here = dirname(fileURLToPath(import.meta.url));
  const script = join(here, '..', '..', '..', 'tools', 'dev', 'miles-emu', 'decode_batch.py');
  return {
    name: 'emulator',
    decodeAll(packets) {
      return parseBatchResponse(run(python, [script, mssvoiceAsi], batchRequest(packets), 'Voice emulator'), packets.length);
    },
  };
}
