// Builds the SpaceDemo app into out/app/ with esbuild (one tool for all three parts):
//   main/     the app process (Node.js, includes the engine)
//   preload/  the small bridge between window and app
//   renderer/ the window (React), with its fonts
// Usage: node app/build.mjs [--watch]
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out', 'app');
const watch = process.argv.includes('--watch');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'renderer'), { recursive: true });
copyFileSync(join(root, 'app/renderer/index.html'), join(out, 'renderer/index.html'));

const common = { bundle: true, sourcemap: true, logLevel: 'info', target: 'es2022', legalComments: 'none' };
// The engine is ES modules; a few files use import.meta.url (e.g. to load opusscript from node_modules). In the
// CommonJS bundles below it is given the bundle file's own address.
const cjsImportMeta = {
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__importMetaUrl' },
};

const builds = [
  {
    ...common,
    entryPoints: [join(root, 'app/main/main.ts')],
    outfile: join(out, 'main/main.cjs'),
    ...cjsImportMeta,
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'onnxruntime-node'],
    target: 'node22',
  },
  {
    ...common,
    entryPoints: [join(root, 'app/main/scan-worker.ts')],
    outfile: join(out, 'main/scan-worker.cjs'),
    ...cjsImportMeta,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
  },
  {
    ...common,
    entryPoints: [join(root, 'app/preload/preload.ts')],
    outfile: join(out, 'preload/preload.cjs'),
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'onnxruntime-node'],
    target: 'node22',
  },
  {
    ...common,
    entryPoints: [join(root, 'app/renderer/main.tsx')],
    outfile: join(out, 'renderer/main.js'),
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.woff2': 'file', '.woff': 'file' },
    assetNames: 'fonts/[name]-[hash]',
    define: { 'process.env.NODE_ENV': '"production"' },
    minify: true,
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
