import { describe, expect, test } from 'bun:test';
import { MARK_HEIGHT, MARK_WIDTH, SPLASH_MIN_COLUMNS, SPLASH_MIN_ROWS, mark, markRuns, seeds, showSplash } from '../src/clients/tui-ink/splash.ts';

describe('the first screen (splash.ts)', () => {
  test('the mark is every seed of the brand, one character each, on a grid of one width', () => {
    const rows = mark();
    expect(rows).toHaveLength(MARK_HEIGHT);
    for (const r of rows) {
      expect(r.length).toBe(MARK_WIDTH);
      expect(r).toMatch(/^[●•· ]+$/);
    }
    // No two seeds share a cell.
    expect(rows.join('').replace(/ /g, '').length).toBe(seeds().length);
    // Only the first seed takes the brand color.
    expect(markRuns().flat().filter((r) => r.first).map((r) => r.text)).toEqual(['●']);
    expect(MARK_WIDTH).toBeLessThan(SPLASH_MIN_COLUMNS);
  });

  test('a screen reader, a short or a narrow terminal keep the plain header', () => {
    expect(showSplash(SPLASH_MIN_ROWS, SPLASH_MIN_COLUMNS, false)).toBe(true);
    expect(showSplash(SPLASH_MIN_ROWS - 1, 120, false)).toBe(false);
    expect(showSplash(40, SPLASH_MIN_COLUMNS - 1, false)).toBe(false);
    expect(showSplash(40, 120, true)).toBe(false);
  });
});
