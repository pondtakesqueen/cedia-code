// The first screen, before any message: the mark beside the name, the model and the place, with the keys under
// them. The mark is the owner's (cedian's brand/mark, script/brand/icon.py): seeds set at the golden angle, as a
// sunflower sets them, the outer seeds larger, the first one in the brand color. Here each seed is one character
// on a grid twice as wide as it is tall, as a terminal cell is, sized by the seed's radius.
const GOLDEN = (137.508 * Math.PI) / 180;
const LAYOUT = { count: 34, spread: 7.1, inner: 2.2, outer: 5.2, first: 1.35 };

type Seed = { x: number; y: number; r: number; first: boolean };

/** The seeds on a 100-unit square centered on 50, 50, outermost first (the same sums as the brand's script). */
export function seeds(): Seed[] {
  const out: Seed[] = [];
  for (let i = LAYOUT.count; i >= 1; i--) {
    const a = i * GOLDEN;
    const d = LAYOUT.spread * Math.sqrt(i);
    const r = LAYOUT.inner + (LAYOUT.outer - LAYOUT.inner) * Math.sqrt(i / LAYOUT.count);
    out.push({ x: 50 + d * Math.cos(a), y: 50 + d * Math.sin(a), r: i === 1 ? r * LAYOUT.first : r, first: i === 1 });
  }
  return out;
}

// 22 by 9 is the smallest grid where no two seeds share a cell (they touch side by side once).
export const MARK_WIDTH = 22;
export const MARK_HEIGHT = 9;

/** A run of the mark's characters in one color: the seeds, or the first seed. */
export type MarkRun = { text: string; first?: boolean };

/** The mark, one list of runs per terminal row; each row's runs join to MARK_WIDTH characters. */
export function markRuns(width = MARK_WIDTH, height = MARK_HEIGHT): MarkRun[][] {
  const grid: { ch: string; first: boolean }[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: ' ', first: false })));
  for (const s of seeds()) {
    const x = Math.round(((s.x - 2) / 96) * (width - 1));
    const y = Math.round(((s.y - 2) / 96) * (height - 1));
    grid[y]![x] = { ch: s.first || s.r >= 4.4 ? '●' : s.r >= 3.4 ? '•' : '·', first: s.first };
  }
  return grid.map((row) => {
    const runs: MarkRun[] = [];
    for (const c of row) {
      const last = runs.at(-1);
      if (last && !!last.first === c.first) last.text += c.ch;
      else runs.push(c.first ? { text: c.ch, first: true } : { text: c.ch });
    }
    return runs;
  });
}

/** The mark as plain strings, one per terminal row. */
export function mark(): string[] {
  return markRuns().map((runs) => runs.map((r) => r.text).join(''));
}

// The splash needs the mark, the lines beside or under it and room around them; a smaller terminal keeps the
// plain header. Narrower than SPLASH_SIDE_COLUMNS, the lines go under the mark.
export const SPLASH_MIN_ROWS = 20;
export const SPLASH_MIN_COLUMNS = 44;
export const SPLASH_SIDE_COLUMNS = 72;

export function showSplash(rows: number, columns: number, screenReader: boolean): boolean {
  return !screenReader && rows >= SPLASH_MIN_ROWS && columns >= SPLASH_MIN_COLUMNS;
}
