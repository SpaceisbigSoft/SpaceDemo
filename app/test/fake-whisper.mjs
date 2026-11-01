#!/usr/bin/env node
// Stand-in for the speech helper in tests: writes "<file>.json" with a made-up text for each -f file (no model needed).
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
const a = process.argv.slice(2);
for (let i = 0; i < a.length; i++) if (a[i] === '-f') writeFileSync(`${a[i + 1]}.json`, JSON.stringify({ transcription: [{ text: ` rush B number ${basename(a[i + 1], '.wav')}` }] }));
