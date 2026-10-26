import { readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

/** Real demos for tests come from the folder in CDF_DEMOS (never committed). Returns [] if unset. */
export function fixtureDemos(): string[] {
  const root = process.env.CDF_DEMOS;
  if (!root) return [];
  const out: string[] = [];
  const walk = (p: string) => {
    for (const e of readdirSync(p)) {
      const q = join(p, e);
      if (statSync(q).isDirectory()) walk(q);
      else if (extname(q).toLowerCase() === '.dem') out.push(q);
    }
  };
  walk(root);
  return out.sort();
}
