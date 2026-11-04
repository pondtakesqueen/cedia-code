// The first screen, before any message: the mascot beside the name, the model and the place, with the keys under
// them. The mascot is cedia's own: a seed that has sprouted, its leaves in the brand color (the seed nods to the
// owner's mark, cedian's sunflower seeds). It is drawn in pixels, two pixel rows to a terminal row through the
// half blocks, so a pixel is about square.
//   'W' the body (text color), 'L' the leaves (brand color), 'G' the stem, '.' nothing (the eyes are holes).
const MASCOT = [
  '...LLL..LLL...',
  '..LLLLL.LLLL..',
  '...LLLLLLLL...',
  '......GG......',
  '....WWWWWW....',
  '...WWWWWWWW...',
  '..WW.WWWW.WW..',
  '..WW.WWWW.WW..',
  '..WWWWWWWWWW..',
  '..WWWWWWWWWW..',
  '...WWWWWWWW...',
  '....WW..WW....',
];

/** Which theme color a pixel takes. */
export type Pixel = 'body' | 'leaf' | 'stem';
const PIXEL: Record<string, Pixel | undefined> = { W: 'body', L: 'leaf', G: 'stem' };

/** A run of the mascot's characters with one foreground and one background (undefined: the terminal's own). */
export type MascotRun = { text: string; fg?: Pixel; bg?: Pixel };

export const MASCOT_WIDTH = MASCOT[0]!.length;
export const MASCOT_HEIGHT = MASCOT.length / 2;

/** The mascot, one list of runs per terminal row; each row's runs join to MASCOT_WIDTH characters. */
export function mascotRuns(): MascotRun[][] {
  const rows: MascotRun[][] = [];
  for (let y = 0; y < MASCOT.length; y += 2) {
    const runs: MascotRun[] = [];
    for (let x = 0; x < MASCOT_WIDTH; x++) {
      const top = PIXEL[MASCOT[y]![x]!];
      const bottom = PIXEL[MASCOT[y + 1]![x]!];
      // A full block when both halves match, else the top half in the foreground over the bottom as background.
      const cell: MascotRun = !top && !bottom ? { text: ' ' } : top === bottom ? { text: '█', fg: top } : top ? { text: '▀', fg: top, ...(bottom ? { bg: bottom } : {}) } : { text: '▄', fg: bottom };
      const last = runs.at(-1);
      if (last && last.fg === cell.fg && last.bg === cell.bg) last.text += cell.text;
      else runs.push(cell);
    }
    rows.push(runs);
  }
  return rows;
}

/** The mascot as plain strings, one per terminal row. */
export function mascot(): string[] {
  return mascotRuns().map((runs) => runs.map((r) => r.text).join(''));
}

// The splash needs the mascot, the lines beside or under it and room around them; a smaller terminal keeps the
// plain header. Narrower than SPLASH_SIDE_COLUMNS, the lines go under the mascot.
export const SPLASH_MIN_ROWS = 20;
export const SPLASH_MIN_COLUMNS = 44;
export const SPLASH_SIDE_COLUMNS = 72;

export function showSplash(rows: number, columns: number, screenReader: boolean): boolean {
  return !screenReader && rows >= SPLASH_MIN_ROWS && columns >= SPLASH_MIN_COLUMNS;
}
