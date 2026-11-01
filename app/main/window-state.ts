// Window size and place remembered between runs (owner, 2026-11-01: "it should remember the last window size").
// Saved when the window closes (its normal size, plus whether it was maximized); used at start only when the saved
// place is still on a screen (a monitor may have been unplugged), otherwise the default size, centred.

export interface SavedWindow {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface Rect { x: number; y: number; width: number; height: number }

export const DEFAULT_WINDOW = { width: 1280, height: 820 };
export const MIN_WINDOW = { width: 900, height: 600 };

/** A saved value from settings.json, checked; undefined when it isn't usable. */
export function cleanSavedWindow(raw: unknown): SavedWindow | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);
  const width = num(r.width), height = num(r.height);
  if (width === undefined || height === undefined || width < MIN_WINDOW.width || height < MIN_WINDOW.height || width > 20000 || height > 20000) return undefined;
  const x = num(r.x), y = num(r.y);
  return { ...(x !== undefined && y !== undefined ? { x, y } : {}), width, height, maximized: r.maximized === true };
}

/** Bounds to open with: the saved ones when at least 100 × 50 px of the window's top falls inside a screen's work area. */
export function startBounds(saved: SavedWindow | undefined, workAreas: Rect[]): Partial<Rect> & { width: number; height: number } {
  if (!saved) return { ...DEFAULT_WINDOW };
  const size = { width: saved.width, height: saved.height };
  if (saved.x === undefined || saved.y === undefined) return size;
  const top: Rect = { x: saved.x, y: saved.y, width: saved.width, height: 50 };
  const visible = workAreas.some((a) => {
    const w = Math.min(top.x + top.width, a.x + a.width) - Math.max(top.x, a.x);
    const h = Math.min(top.y + top.height, a.y + a.height) - Math.max(top.y, a.y);
    return w >= 100 && h >= 50;
  });
  if (!visible) return size; // centred on the main screen
  return { x: saved.x, y: saved.y, ...size };
}
