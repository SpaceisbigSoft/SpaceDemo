// Window size and place remembered between runs (owner's request, 2026-11-01).
import { describe, expect, it } from 'vitest';
import { cleanSavedWindow, DEFAULT_WINDOW, startBounds } from '../main/window-state.js';
import { cleanSettings } from '../main/settings.js';

const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }];

describe('window size and place', () => {
  it('opens where it was closed when that is on a screen', () => {
    expect(startBounds({ x: 100, y: 80, width: 1500, height: 900, maximized: false }, screen)).toEqual({ x: 100, y: 80, width: 1500, height: 900 });
  });
  it('keeps the size but recentres when the saved place is off every screen (monitor unplugged)', () => {
    expect(startBounds({ x: 2500, y: 100, width: 1400, height: 900, maximized: true }, screen)).toEqual({ width: 1400, height: 900 });
  });
  it('first start: the default size', () => {
    expect(startBounds(undefined, screen)).toEqual(DEFAULT_WINDOW);
  });
  it('ignores damaged or too small values', () => {
    expect(cleanSavedWindow({ width: 500, height: 400 })).toBeUndefined();
    expect(cleanSavedWindow({ width: 'big' })).toBeUndefined();
    expect(cleanSavedWindow({ x: 10, y: 20, width: 1000.4, height: 700, maximized: 'yes' })).toEqual({ x: 10, y: 20, width: 1000, height: 700, maximized: false });
  });
  it('is kept in settings.json', () => {
    expect(cleanSettings({ window: { x: 5, y: 6, width: 1600, height: 1000, maximized: true } }).window).toEqual({ x: 5, y: 6, width: 1600, height: 1000, maximized: true });
    expect(cleanSettings({}).window).toBeUndefined();
  });
});
