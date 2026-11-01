// 5.g5 AI voice enhancement in the app: the model file (downloaded once into the app's data folder from the SpaceDemo
// GitHub release, checked by SHA-256, or a file the person already has). The model itself runs in the background
// thread while fixing (fixer.ts). Nothing leaves the PC except the one-time download.
import { createHash } from 'node:crypto';
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { AI_MODEL } from '../../engine/src/voice/enhance.js';
import type { AiModelState } from '../shared/api.js';

export interface AiModelDeps {
  dataDir: string;
  /** Model chosen by hand (settings), and saving a new choice. */
  chosenModel: () => string | undefined;
  saveChosenModel: (path: string | undefined) => void;
  onModel: (s: AiModelState) => void;
  /** Tests: download from here instead (no checksum check). */
  modelUrl?: string;
}

/** True if the file looks like an ONNX model (a protobuf starting with the ir_version field) of a sensible size. */
export function isAiModel(path: string): boolean {
  try {
    if (!/\.onnx$/i.test(path) || statSync(path).size < 10_000_000) return false;
    const fd = openSync(path, 'r');
    const b = Buffer.alloc(1);
    readSync(fd, b, 0, 1, 0);
    closeSync(fd);
    return b[0] === 0x08;
  } catch { return false; }
}

export class AiModelService {
  private downloading?: { done: number; total: number };
  private problem?: string;

  constructor(private readonly d: AiModelDeps) {}

  private defaultModel(): string { return join(this.d.dataDir, 'models', AI_MODEL.file); }

  /** The model file to use, when there is one. */
  modelPath(): string | undefined {
    const chosen = this.d.chosenModel();
    if (chosen && existsSync(chosen)) return chosen;
    return existsSync(this.defaultModel()) ? this.defaultModel() : undefined;
  }

  /** Where finished AI voice is kept (same demo + model + rate = no second run). */
  cacheDir(): string { return join(this.d.dataDir, 'ai-voice'); }

  model(): AiModelState {
    const chosen = this.d.chosenModel();
    return { path: this.modelPath(), chosenByHand: !!chosen && existsSync(chosen), size: AI_MODEL.bytes, downloading: this.downloading, problem: this.problem };
  }

  /** Uses a model file the person has (checked: an .onnx model). */
  choose(path: string): AiModelState {
    if (!isAiModel(path)) this.problem = `${basename(path)} is not the AI voice model (.onnx).`;
    else { this.problem = undefined; this.d.saveChosenModel(path); }
    const s = this.model();
    this.d.onModel(s);
    return s;
  }

  /** Downloads the model once (about 142 MB), checks it, then keeps it in the app's data folder. */
  async download(): Promise<AiModelState> {
    if (this.downloading) return this.model();
    const target = this.defaultModel();
    const part = `${target}.part`;
    mkdirSync(join(this.d.dataDir, 'models'), { recursive: true });
    this.problem = undefined;
    this.downloading = { done: 0, total: AI_MODEL.bytes };
    this.d.onModel(this.model());
    try {
      const res = await fetch(this.d.modelUrl ?? AI_MODEL.url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`the server answered ${res.status}`);
      const total = Number(res.headers.get('content-length')) || AI_MODEL.bytes;
      this.downloading = { done: 0, total };
      const hash = createHash('sha256');
      const out = createWriteStream(part);
      let lastSent = 0;
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
        this.downloading.done += chunk.length;
        if (this.downloading.done - lastSent > total / 100) { lastSent = this.downloading.done; this.d.onModel(this.model()); }
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      if (!this.d.modelUrl && hash.digest('hex') !== AI_MODEL.sha256) throw new Error('the downloaded file is not the expected model (checksum differs)');
      renameSync(part, target);
      this.d.saveChosenModel(undefined);
    } catch (err) {
      try { rmSync(part, { force: true }); } catch { /* nothing to remove */ }
      this.problem = `Download failed: ${(err as Error).message}. Try again, or choose a model file you have.`;
    }
    this.downloading = undefined;
    const s = this.model();
    this.d.onModel(s);
    return s;
  }
}
