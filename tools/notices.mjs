// Plan 6.4: writes THIRD-PARTY-NOTICES.txt — everyone else's work that comes with SpaceDemo, with the licence texts.
//   node tools/notices.mjs           write the file
//   node tools/notices.mjs --check   exit 1 if the file is out of date (run by the tests and the build pipeline)
// Two sources: (1) the fixed list below for parts that are not npm packages (built into our programs, shipped by
// Electron or ONNX Runtime, or downloaded later), with licence texts kept in licenses/ (see licenses/README.md);
// (2) every npm package the app ships (package-lock.json, not dev), with the licence file from node_modules.
// The installer copies the file next to SpaceDemo (package.json build.extraResources); Settings → About opens it.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'THIRD-PARTY-NOTICES.txt');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const text = (rel) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n').trimEnd();
const ver = (name) => lock.packages[`node_modules/${name}`]?.version ?? '?';

/** Parts that are not plain npm packages. `files` = licence texts in this repository. */
const BUILT_IN = [
  {
    name: 'Electron', version: ver('electron'),
    use: 'SpaceDemo.exe and the files around it are Electron (Chromium + Node.js), which runs the app.',
    licence: 'MIT; Chromium and the parts it includes: their own licences',
    home: 'https://www.electronjs.org',
    note: 'Their full texts come with SpaceDemo in the install folder: LICENSE.electron.txt (Electron) and LICENSES.chromium.html (Chromium, V8, Node.js, FFmpeg, ANGLE, SwiftShader and the rest).',
  },
  {
    name: 'Speex', version: 'git f461ff4 (decoder only)',
    use: 'Plays old Speex voice: the official decoder, compiled to WebAssembly inside SpaceDemo (helpers/speex).',
    licence: 'BSD-3-Clause (copyright holders: see the text)', home: 'https://github.com/xiph/speex', files: ['helpers/speex/COPYING'],
  },
  {
    name: 'Opus (libopus)', version: `inside opusscript ${ver('opusscript')}`,
    use: 'Makes Steam voice (Opus) for the fixed demos; compiled to WebAssembly by the opusscript package (listed below).',
    licence: 'BSD-3-Clause (copyright holders: see the text; current libopus COPYING)',
    home: 'https://opus-codec.org', files: ['licenses/opus-COPYING.txt'],
  },
  {
    name: 'whisper.cpp and ggml', version: 'v1.9.5 (d1be6fde)',
    use: 'resources\\helpers\\whisper-helper\\spacedemo-whisper.exe (voice to text) is whisper.cpp\'s command-line program, built by SpaceDemo.',
    licence: 'MIT', home: 'https://github.com/ggml-org/whisper.cpp', files: ['licenses/whisper.cpp-LICENSE.txt'],
  },
  {
    name: 'MinGW-w64 runtime and winpthreads', version: 'MinGW-w64 13 (Ubuntu 24.04)',
    use: 'Built into both helper programs (cdf-voice-helper.exe, spacedemo-whisper.exe). They also contain the GCC runtime libraries (libgcc, libstdc++), which are GPL v3 with the GCC Runtime Library Exception: no notice is required for them.',
    licence: 'mostly ZPL 2.1, MIT and public domain (see the text); winpthreads: MIT and BSD', home: 'https://www.mingw-w64.org',
    files: ['licenses/mingw-w64-runtime-COPYING.txt', 'licenses/winpthreads-COPYING.txt'],
  },
  {
    name: 'ONNX Runtime', version: ver('onnxruntime-node'),
    use: 'Runs the optional AI voice model (onnxruntime-node). Its Windows files: onnxruntime.dll, onnxruntime_binding.node, DirectML.dll, dxcompiler.dll.',
    licence: 'MIT (Microsoft Corporation); the notices of the parts it includes follow the licence', home: 'https://onnxruntime.ai',
    files: ['licenses/onnxruntime-LICENSE.txt', 'licenses/onnxruntime-ThirdPartyNotices.txt'],
  },
  {
    name: 'DirectML', version: '1.15.4 (DirectML.dll, comes with ONNX Runtime)',
    use: 'Microsoft\'s DirectX Machine Learning library, shipped inside the onnxruntime-node package. SpaceDemo runs the model on the processor and does not use it.',
    licence: 'Microsoft Software License Terms — Microsoft DirectX Machine Learning (DirectML): may be distributed in applications for Windows',
    home: 'https://www.nuget.org/packages/Microsoft.AI.DirectML/1.15.4/License', files: ['licenses/directml.txt'],
  },
  {
    name: 'DirectX Shader Compiler', version: '1.8.2502.8 (dxcompiler.dll, comes with ONNX Runtime)',
    use: 'Shipped inside the onnxruntime-node package (for DirectML); not used by SpaceDemo.',
    licence: 'University of Illinois/NCSA Open Source License (LLVM) and the notices that follow it',
    home: 'https://github.com/microsoft/DirectXShaderCompiler', files: ['licenses/dxc-LICENSE.txt', 'licenses/dxc-ThirdPartyNotices.txt'],
  },
];

/** Downloaded later, only when the user asks for the feature (not in the installer). */
const DOWNLOADED = [
  {
    name: 'VoiceFixer (AI voice model)', version: 'SpaceDemo release ai-model-v1: spacedemo-voicefixer-mixed.onnx',
    use: 'Optional AI voice enhancement. Downloaded from SpaceDemo\'s GitHub releases when the user turns it on.',
    licence: 'Trained models: Creative Commons Attribution 4.0 International (CC BY 4.0) — https://creativecommons.org/licenses/by/4.0/ ; code: MIT',
    home: 'https://github.com/haoheliu/voicefixer',
    note: 'VoiceFixer by Haohe Liu, Xubo Liu, Qiuqiang Kong, Qiao Tian, Yan Zhao, DeLiang Wang, Chuanzeng Huang and Yuxuan Wang. Trained models from Zenodo records 5600188 and 5469951 (https://zenodo.org/records/5600188, https://zenodo.org/records/5469951). Changes made by SpaceDemo: the models were combined, compressed (int8 / fp16) and converted to ONNX. No endorsement by the authors is implied.',
  },
  {
    name: 'Whisper speech model', version: 'ggml-small.en-q5_1.bin',
    use: 'Optional voice to text. Downloaded from the whisper.cpp project\'s Hugging Face page when the user asks for it.',
    licence: 'MIT (OpenAI Whisper); converted to ggml format by the whisper.cpp project (MIT)',
    home: 'https://github.com/openai/whisper',
  },
];

/** Ideas and facts only: no code from these is in SpaceDemo. */
const THANKS = [
  'compLexity Demo Player (COL) by jpcy and contributors — https://github.com/jpcy/coldemoplayer (GPL v3): the pioneering CS 1.0–1.6 demo player; a reference for how old demos differ from today\'s.',
  'CS Demo Manager by AkiVer — https://github.com/akiver/cs-demo-manager (MIT): inspiration for the interface.',
  'SK Player by Andreas Thorstensson: feature ideas.',
  'Community notes on the GoldSrc demo format, incl. the talent demo-structure notes (cgdangelo), and ReHLDS (map checksum algorithm).',
];

function licenceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f)).sort();
}

/** Every npm package that ships with the app: production entries of the lockfile. */
function npmPackages() {
  const list = [];
  for (const [path, info] of Object.entries(lock.packages)) {
    if (!path || info.dev || info.devOptional || !path.startsWith('node_modules/')) continue;
    const name = path.slice('node_modules/'.length).replace(/\/node_modules\//g, ' > ');
    const files = licenceFiles(join(root, path)).map((f) => `${path}/${f}`);
    // onnxruntime-node / -common have no licence file in the package: use ONNX Runtime's.
    if (!files.length && name.startsWith('onnxruntime-')) files.push('licenses/onnxruntime-LICENSE.txt');
    // lazy-val (used by electron-updater, 6.7) says MIT but ships no licence file.
    if (!files.length && name === 'lazy-val') files.push('licenses/lazy-val-MIT.txt');
    if (!files.length) throw new Error(`No licence file for ${name}: add one to licenses/ and to this script`);
    const p = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8'));
    const home = p.homepage ?? (typeof p.repository === 'string' ? p.repository : p.repository?.url ?? '');
    list.push({ name, version: info.version, licence: info.license ?? p.license ?? '?', home: String(home).replace(/^git\+/, '').replace(/\.git$/, ''), files });
  }
  return list.sort((a, b) => a.name.localeCompare(b.name));
}

const RULE = '='.repeat(78);
const rule = '-'.repeat(78);

function entry(e) {
  const lines = [rule, `${e.name}  ${e.version}`];
  if (e.use) lines.push(`Used for: ${e.use}`);
  lines.push(`Licence: ${e.licence}`);
  if (e.home) lines.push(`Home: ${e.home}`);
  if (e.note) lines.push('', e.note);
  for (const f of e.files ?? []) lines.push('', `--- ${f.replace(/^node_modules\//, '')} ---`, '', text(f));
  return lines.join('\n');
}

export function buildNotices() {
  const npm = npmPackages();
  const parts = [
    RULE,
    `SpaceDemo ${pkg.version} — third-party notices`,
    RULE,
    '',
    'SpaceDemo is free software under the GNU General Public License v3 or later (LICENSE.txt in the install folder).',
    'Source code: https://github.com/SpaceisbigSoft/SpaceDemo',
    '',
    'SpaceDemo includes work by other people. This file lists it, with each licence. SpaceDemo does not include any',
    'Valve game files or RAD Game Tools (Miles) files: old Miles voice is decoded with the player\'s own copy from',
    'their game folder. Counter-Strike and Half-Life are trademarks of Valve Corporation; SpaceDemo is not',
    'affiliated with Valve.',
    '',
    'Contents',
    '  A. Built into SpaceDemo or shipped with it (not npm packages)',
    `  B. npm packages shipped with SpaceDemo (${npm.length})`,
    '  C. Downloaded later, only when you turn the feature on',
    '  D. Thanks (ideas and facts; no code used)',
    '',
    'Generated by tools/notices.mjs from package-lock.json and licenses/ — do not edit by hand.',
    '',
    RULE, 'A. Built into SpaceDemo or shipped with it', RULE,
    ...BUILT_IN.map(entry),
    '', RULE, 'B. npm packages shipped with SpaceDemo', RULE,
    'React, react-dom, scheduler and the fonts are built into the window\'s code; the others are in resources\\app.asar.',
    ...npm.map(entry),
    '', RULE, 'C. Downloaded later, only when you turn the feature on', RULE,
    ...DOWNLOADED.map(entry),
    '', RULE, 'D. Thanks (ideas and facts; no code used)', RULE,
    ...THANKS.map((t) => `- ${t}`),
    '',
  ];
  return parts.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const want = buildNotices();
  if (process.argv.includes('--check')) {
    const have = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (have !== want) {
      console.error('THIRD-PARTY-NOTICES.txt is out of date: run node tools/notices.mjs');
      process.exit(1);
    }
    console.log('THIRD-PARTY-NOTICES.txt is up to date');
  } else {
    writeFileSync(OUT, want);
    console.log(`THIRD-PARTY-NOTICES.txt written (${want.length} characters)`);
  }
}
