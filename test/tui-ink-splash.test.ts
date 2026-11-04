import { describe, expect, test } from 'bun:test';
import { MASCOT_HEIGHT, MASCOT_WIDTH, SPLASH_MIN_COLUMNS, SPLASH_MIN_ROWS, mascot, mascotRuns, showSplash } from '../src/clients/tui-ink/splash.ts';

describe('the first screen (splash.ts)', () => {
  test('the mascot is six rows of half blocks, all one width', () => {
    const rows = mascot();
    expect(rows).toHaveLength(MASCOT_HEIGHT);
    expect(MASCOT_HEIGHT).toBe(6);
    for (const r of rows) {
      expect(r.length).toBe(MASCOT_WIDTH);
      expect(r).toMatch(/^[█▀▄ ]+$/);
    }
    // The leaves take the brand color; the stem meets them on a shared cell, top half leaf, bottom half stem.
    expect(mascotRuns()[0]!.some((r) => r.fg === 'leaf')).toBe(true);
    expect(mascotRuns()[1]!.some((r) => r.fg === 'leaf' && r.bg === 'stem')).toBe(true);
    // The eyes are holes in the body.
    expect(rows[3]!.trim()).toBe('██ ████ ██');
    expect(MASCOT_WIDTH).toBeLessThan(SPLASH_MIN_COLUMNS);
  });

  test('a screen reader, a short or a narrow terminal keep the plain header', () => {
    expect(showSplash(SPLASH_MIN_ROWS, SPLASH_MIN_COLUMNS, false)).toBe(true);
    expect(showSplash(SPLASH_MIN_ROWS - 1, 120, false)).toBe(false);
    expect(showSplash(40, SPLASH_MIN_COLUMNS - 1, false)).toBe(false);
    expect(showSplash(40, 120, true)).toBe(false);
  });
});
