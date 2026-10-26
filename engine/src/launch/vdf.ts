// Reader for Valve's text KeyValues files (libraryfolders.vdf, appmanifest_*.acf, loginusers.vdf, ...).
// Format: "key" "value" pairs and "key" { ... } blocks; strings in double quotes with backslash escapes
// (\\ \" \n \t); unquoted tokens are allowed; // starts a comment; [$WIN32]-style conditions after a value are skipped.
// Keys are matched without regard to letter case by the helpers below, as Steam does.

export type VdfValue = string | VdfObject;
export interface VdfObject { [key: string]: VdfValue }

export class VdfError extends Error {}

export function parseVdf(text: string): VdfObject {
  let i = 0;
  const n = text.length;

  function skip(): void {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿') i++;
      else if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; }
      else break;
    }
  }

  function token(): string | null {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') { i++; return c; }
    if (c === '"') {
      i++;
      let s = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else s += text[i++];
      }
      if (i >= n) throw new VdfError('A quoted text in the file never ends (missing closing ").');
      i++;
      return '\u0000' + s; // marks a string token (so a quoted "{" is not a brace)
    }
    let s = '';
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return '\u0000' + s;
  }

  function block(depth: number): VdfObject {
    const obj: VdfObject = {};
    for (;;) {
      const k = token();
      if (k === null) { if (depth > 0) throw new VdfError('The file ends inside a { } block.'); return obj; }
      if (k === '}') { if (depth === 0) throw new VdfError('Unexpected } in the file.'); return obj; }
      if (k === '{') throw new VdfError('Unexpected { where a name was expected.');
      const key = k.slice(1);
      const v = token();
      if (v === null) throw new VdfError(`"${key}" has no value.`);
      if (v === '}') throw new VdfError(`"${key}" has no value.`);
      const value: VdfValue = v === '{' ? block(depth + 1) : v.slice(1);
      // Optional condition such as [$WIN32] after a value.
      skip();
      if (text[i] === '[') { while (i < n && text[i] !== ']') i++; i++; }
      if (!(key in obj)) obj[key] = value; // first one wins on duplicates
    }
  }

  return block(0);
}

/** Child of an object by key, ignoring letter case. */
export function vdfGet(obj: VdfValue | undefined, key: string): VdfValue | undefined {
  if (!obj || typeof obj === 'string') return undefined;
  if (key in obj) return obj[key];
  const lower = key.toLowerCase();
  for (const k of Object.keys(obj)) if (k.toLowerCase() === lower) return obj[k];
  return undefined;
}

export function vdfString(obj: VdfValue | undefined, key: string): string | undefined {
  const v = vdfGet(obj, key);
  return typeof v === 'string' ? v : undefined;
}

export function vdfObject(obj: VdfValue | undefined, key: string): VdfObject | undefined {
  const v = vdfGet(obj, key);
  return v && typeof v !== 'string' ? v : undefined;
}
