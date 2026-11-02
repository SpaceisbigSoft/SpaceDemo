import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDemo } from '../src/container/read.js';
import { FrameType } from '../src/container/types.js';
import { createState, decodeMessages, encodeMessages, type Message } from '../src/protocol/messages.js';
import { encodeBaseline, encodeClientData, encodeEntities, encodeEvents, encodeNewUserMsg, encodeResourceList, encodeServerInfo, encodeUserMessage, encodeVoiceInit } from '../src/protocol/encode.js';
import { fixtureDemos } from './fixtures.js';

const demos = fixtureDemos();

/** Re-encodes a decoded message from its body (where we have an encoder). Returns undefined if not encodable. */
function reencode(m: Message, state: ReturnType<typeof createState>): Uint8Array | undefined {
  const b = m.body;
  if (!b) return undefined;
  switch (b.kind) {
    // Protocol 43 has no host name/extra block, and some protocol 45 servers omit the map cycle: no exact re-encode.
    case 'serverInfo': return b.protocol <= 43 || (b.protocol === 45 && !b.extra.length) ? undefined : encodeServerInfo(b, { protocol: b.protocol });
    case 'events': return encodeEvents(b, state.deltas);
    case 'newUserMsg': return encodeNewUserMsg(b.def, b.nameField);
    case 'voiceInit': return encodeVoiceInit(b.codec, b.quality);
    case 'clientData': return encodeClientData(b, state.deltas, state.weaponIndexBits);
    case 'entities': return encodeEntities(b, state.deltas);
    case 'baseline': return encodeBaseline(b, state.deltas);
    case 'resourceList': return b.hadConsistencyList ? undefined : encodeResourceList(b);
    case 'user': return encodeUserMessage(m.id, b.payload, b.sized);
    default: return undefined;
  }
}

describe.skipIf(demos.length === 0)('real demos: network messages (CDF_DEMOS)', () => {
  it.each(demos.map((d) => [basename(d), d]))('%s: every message decodes, and re-encodes identically', (_n, path) => {
    const demo = readDemo(new Uint8Array(readFileSync(path)));
    const state = createState(demo.header.networkProtocol, demo.header.gameDir);
    let checked = 0;
    for (const section of demo.sections) {
      for (const f of section.frames) {
        if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) continue;
        const msgs = decodeMessages(f.messages, state);
        // Untouched messages reassemble to the original bytes.
        expect(Buffer.from(encodeMessages(f.messages, msgs)).equals(Buffer.from(f.messages))).toBe(true);
        // Messages we can encode come out bit-identical.
        for (const m of msgs) {
          const again = reencode(m, state);
          if (!again) continue;
          // Protocol 43: encoders write the 44+ bit order, which the decoder's transcoded copy (`lsb`) must equal.
          const orig = m.lsb ?? f.messages.subarray(m.start!, m.end!);
          if (!Buffer.from(again).equals(Buffer.from(orig))) throw new Error(`${m.name} at t=${f.time} re-encoded differently`);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
