// Demo inspector: prints what each demo is and what state it is in.
//   npm run inspect -- <demo.dem | folder> [more...] [--maps <folder>]... [--json]
// --maps: folders with .bsp files (e.g. the game's cstrike\maps and an old-maps pool); checks the demo's map version.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { inspectDemo, type InspectReport } from '../engine/src/inspect.js';
import { indexMaps, matchMap, type MapFile, type MapMatch } from '../engine/src/map-index.js';

const args = process.argv.slice(2);
const mapFolders: string[] = [];
let json = false;
const inputs: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--maps') mapFolders.push(args[++i]);
  else if (args[i] === '--json') json = true;
  else inputs.push(args[i]);
}
if (inputs.length === 0) {
  console.log('Usage: npm run inspect -- <demo.dem | folder> [...] [--maps <folder>]... [--json]');
  process.exit(1);
}

const demos: string[] = [];
const collect = (p: string) => {
  if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) collect(join(p, e));
  else if (extname(p).toLowerCase() === '.dem') demos.push(p);
};
for (const i of inputs) collect(i);

const maps: MapFile[] | undefined = mapFolders.length ? indexMaps(mapFolders) : undefined;

const time = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
const mapText = (m: MapMatch) => {
  switch (m.status) {
    case 'ok': return `OK (${m.file.path})`;
    case 'renamed': return `OK under another name: ${m.file.path} (copy it as the demo's map name)`;
    case 'wrongVersion': return `WRONG VERSION installed (${m.installed.map((f) => f.checksum).join(', ')}): the old version is needed`;
    case 'missing': return 'MISSING';
  }
};

const results: (InspectReport & { file: string; mapCheck?: MapMatch })[] = [];
for (const path of demos) {
  let r: InspectReport;
  try {
    r = inspectDemo(new Uint8Array(readFileSync(path)));
  } catch (e) {
    console.log(`\n== ${basename(path)}\n  Could not read this file: ${(e as Error).message}`);
    continue;
  }
  const mapCheck = maps ? matchMap(maps, r.mapName, r.mapChecksum) : undefined;
  results.push({ file: path, ...r, mapCheck });
  if (json) continue;

  console.log(`\n== ${basename(path)}  (${(r.fileSize / 1e6).toFixed(1)} MB)`);
  console.log(`  Protocol ${r.networkProtocol} (demo ${r.demoProtocol}), ${r.gameDir}${r.serverBuild ? `, server build ${r.serverBuild}` : ''}`);
  console.log(`  ${r.recording} recording on ${r.maps.join(' → ')}${r.maps.length > 1 ? '  (map change: use playdemo, not viewdemo)' : ''}`);
  if (r.loadingOnlyMaps.length) {
    const other = [...new Set(r.loadingOnlyMaps.filter((m) => m !== r.maps[0]))];
    console.log(other.length
      ? `  Loads ${other.join(', ')} first, before the real map (the converter removes this)`
      : `  The map was loaded ${r.loadingOnlyMaps.length} extra time(s) before playback, e.g. a reconnect (the converter keeps only the last load)`);
  }
  console.log(`  Map checksum ${r.mapChecksum}${mapCheck ? `: ${mapText(mapCheck)}` : ''}`);
  if (r.hostName) console.log(`  Server "${r.hostName}", ${r.maxClients} slots`);
  console.log(`  Length ${time(r.seconds)}; directory ${r.directoryOk ? 'OK' : 'MISSING (rebuilt by scanning)'}; sections: ${r.sections
    .map((s) => `${s.description} ${time(s.seconds)} (${s.netFrames} network frames)`)
    .join(', ')}`);
  if (r.measuredUpdatesPerSecond !== undefined) console.log(`  Measured: ${r.measuredUpdatesPerSecond} server updates/s received, ${r.measuredFps} FPS (ex_interp, cl_cmdrate, cl_rate, fps_max are not stored in demos)`);
  console.log(`  Voice codec: ${r.voiceCodec === undefined ? 'none announced' : `"${r.voiceCodec || 'Steam voice'}"${r.voiceQuality !== undefined ? ` quality ${r.voiceQuality}` : ''}`}`);
  console.log('  Players:');
  for (const p of r.players) {
    const tags = [p.team, p.isRecorder ? 'recorder' : '', p.isHltv ? 'HLTV' : ''].filter(Boolean).join(', ');
    const voice = p.voicePackets === 0 ? 'no voice'
      : p.voicePackets === p.emptyVoicePackets ? `own microphone not recorded (${p.emptyVoicePackets} empty voice packets)`
      : `${p.voicePackets - p.emptyVoicePackets} voice packets${p.voiceSeconds !== undefined ? ` (${time(p.voiceSeconds)})` : ''}, ${p.talkBursts} bursts${p.emptyVoicePackets ? `, ${p.emptyVoicePackets} empty` : ''}`;
    const net = p.rate !== undefined ? ` · rate ${Number(p.rate)}, cl_updaterate ${p.updateRate ?? '?'}${p.settingChanges.length ? ` (${p.settingChanges.length} changes)` : ''}` : '';
    console.log(`    ${String(p.slot).padStart(2)} ${p.name || '(no name)'}${tags ? ` [${tags}]` : ''}: ${voice}${net}`);
  }
  if (r.problems.length) console.log('  Problems:\n    ' + r.problems.join('\n    '));
  else console.log('  No problems found.');
}
if (json) console.log(JSON.stringify(results, null, 2));
else if (demos.length > 1) {
  const bad = results.filter((r) => r.problems.length).length;
  console.log(`\n${results.length} of ${demos.length} demos read; ${bad} with problems.`);
}
