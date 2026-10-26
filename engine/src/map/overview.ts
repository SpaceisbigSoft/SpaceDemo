// The game's own top-down map images (cstrike\overviews\<map>.bmp + .txt; read-only, never bundled) (plan 2.14).
// The .txt gives ZOOM, ORIGIN (x y z) and ROTATED. The image is 1024x768; one world unit = zoom/8 pixels.

export interface Overview {
  zoom: number;
  origin: [number, number, number];
  rotated: boolean;
  image: string;
  height?: number;
}

export const OVERVIEW_WIDTH = 1024;
export const OVERVIEW_HEIGHT = 768;

export function parseOverview(text: string): Overview {
  const num = (key: string) => {
    const m = new RegExp(`\\b${key}\\s+([-\\d.\\s]+)`, 'i').exec(text);
    return m ? m[1].trim().split(/\s+/).map(Number) : undefined;
  };
  const origin = num('ORIGIN') ?? [0, 0, 0];
  const image = /IMAGE\s+"([^"]+)"/i.exec(text)?.[1] ?? '';
  return {
    zoom: num('ZOOM')?.[0] ?? 1,
    origin: [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0],
    rotated: (num('ROTATED')?.[0] ?? 0) !== 0,
    image,
    height: num('HEIGHT')?.[0],
  };
}

export type Projection = (x: number, y: number) => [number, number];

/**
 * World (x, y) → image pixel (px, py): px = 512 + (x - originX) * zoom / 8, py = 384 - (y - originY) * zoom / 8.
 * ROTATED does not change this mapping (it only turns the image when the game shows it). Checked on Set 1:
 * de_train HLTV positions land on drawn floor 99 % (a free fit gave scale 0.1965 vs zoom/8 = 0.195).
 */
export function projection(o: Overview): Projection {
  const s = o.zoom / 8;
  const cx = OVERVIEW_WIDTH / 2, cy = OVERVIEW_HEIGHT / 2;
  return (x, y) => [cx + (x - o.origin[0]) * s, cy - (y - o.origin[1]) * s];
}

/** Image pixel → world (x, y), the inverse of `projection`. */
export function unprojection(o: Overview): Projection {
  const s = o.zoom / 8;
  const cx = OVERVIEW_WIDTH / 2, cy = OVERVIEW_HEIGHT / 2;
  return (px, py) => [o.origin[0] + (px - cx) / s, o.origin[1] - (py - cy) / s];
}
