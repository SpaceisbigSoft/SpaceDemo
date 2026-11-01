// 5.g5 AI voice model in the app: recognising the file, choosing one, downloading with progress (local stand-in server).
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AiModelService, isAiModel } from '../main/ai-model.js';
import { AI_MODEL } from '../../engine/src/voice/enhance.js';
import type { AiModelState } from '../shared/api.js';

const fakeModel = (dir: string, name = 'm.onnx', first = 0x08) => {
  const p = join(dir, name);
  const b = Buffer.alloc(11_000_000); b[0] = first;
  writeFileSync(p, b);
  return p;
};

describe('AI voice model (5.g5)', () => {
  it('recognises an .onnx model and refuses other files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-aim-'));
    expect(isAiModel(fakeModel(dir))).toBe(true);
    expect(isAiModel(fakeModel(dir, 'm.bin'))).toBe(false);
    expect(isAiModel(fakeModel(dir, 'x.onnx', 0x41))).toBe(false);
    writeFileSync(join(dir, 'small.onnx'), Buffer.from([8, 1, 2]));
    expect(isAiModel(join(dir, 'small.onnx'))).toBe(false);
    expect(AI_MODEL.url).toMatch(/^https:\/\/github\.com\/SpaceisbigSoft\/SpaceDemo\/releases\/download\//);
  });

  it('uses a chosen file, or downloads once into the data folder with progress', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-aim-'));
    let chosen: string | undefined;
    const sent: AiModelState[] = [];
    const body = Buffer.alloc(3_000_000, 7); body[0] = 8;
    const server = createServer((_q, r) => { r.writeHead(200, { 'content-length': body.length }); r.end(body); });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/m.onnx`;
    const svc = new AiModelService({ dataDir: dir, chosenModel: () => chosen, saveChosenModel: (p) => { chosen = p; }, onModel: (s) => sent.push(s), modelUrl: url });
    expect(svc.model().path).toBeUndefined();
    expect(svc.choose(join(dir, 'nope.txt')).problem).toMatch(/not the AI voice model/);
    const mine = fakeModel(dir, 'mine.onnx');
    expect(svc.choose(mine)).toMatchObject({ path: mine, chosenByHand: true, problem: undefined });
    const done = await svc.download();
    server.close();
    expect(done.path).toBe(join(dir, 'models', AI_MODEL.file));
    expect(done.chosenByHand).toBe(false);
    expect(readFileSync(done.path!).equals(body)).toBe(true);
    expect(existsSync(`${done.path}.part`)).toBe(false);
    expect(sent.some((s) => s.downloading && s.downloading.done > 0)).toBe(true);
    expect(svc.cacheDir()).toBe(join(dir, 'ai-voice'));
  });

  it('a failed download leaves nothing behind and says why', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sd-aim-'));
    const server = createServer((_q, r) => { r.writeHead(404); r.end(); });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const svc = new AiModelService({ dataDir: dir, chosenModel: () => undefined, saveChosenModel: () => undefined, onModel: () => undefined, modelUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/x` });
    const s = await svc.download();
    server.close();
    expect(s.path).toBeUndefined();
    expect(s.problem).toMatch(/Download failed: the server answered 404/);
    expect(existsSync(join(dir, 'models', `${AI_MODEL.file}.part`))).toBe(false);
  });
});
