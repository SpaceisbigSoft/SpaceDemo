// Replaces the voice in a protocol-48 demo: switches the demo to Steam voice (empty codec name, quality 0)
// and asks a provider for the new data of each svc_voicedata message.
import { FrameType, type DemoFile, type Frame } from '../container/types.js';
import { encodeVoiceData, encodeVoiceInit } from '../protocol/encode.js';
import { createState, decodeMessages, encodeMessages, type Message } from '../protocol/messages.js';

export interface VoicePacketInfo {
  slot: number;
  time: number;
  data: Uint8Array;
}

/** Returns new packet data, or null to drop the message. */
export type VoiceProvider = (packet: VoicePacketInfo) => Uint8Array | null;

export interface ReplaceVoiceReport {
  replaced: number;
  dropped: number;
}

export function replaceVoice(demo: DemoFile, provider: VoiceProvider): { demo: DemoFile; report: ReplaceVoiceReport } {
  if (demo.header.networkProtocol !== 48) throw new Error('Voice replacement needs a protocol-48 demo (convert it first).');
  const state = createState(48, demo.header.gameDir);
  const report: ReplaceVoiceReport = { replaced: 0, dropped: 0 };
  const sections = demo.sections.map((section) => ({
    ...section,
    frames: section.frames.map((f): Frame => {
      if (f.type !== FrameType.NetMessages && f.type !== FrameType.NetMessagesLoading) return f;
      const messages = decodeMessages(f.messages, state);
      if (!messages.some((m) => m.body?.kind === 'voiceInit' || m.body?.kind === 'voiceData')) return f;
      const out: Message[] = [];
      for (const m of messages) {
        if (m.body?.kind === 'voiceInit') {
          out.push({ ...m, bytes: encodeVoiceInit('', 0) });
        } else if (m.body?.kind === 'voiceData') {
          const next = provider({ slot: m.body.slot, time: f.time, data: m.body.data });
          if (next === null) {
            report.dropped++;
            continue;
          }
          report.replaced++;
          out.push({ ...m, bytes: encodeVoiceData(m.body.slot, next) });
        } else out.push(m);
      }
      return { ...f, messages: encodeMessages(f.messages, out) };
    }),
  }));
  return { demo: { ...demo, sections }, report };
}
