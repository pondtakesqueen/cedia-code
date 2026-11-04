// The first screen, before any message: the wordmark in block pixels, centered with the model, the place and the
// keys under it. Each glyph is 8 pixel rows (2 for the ascender of d and the dot of i, 6 for the body); two pixel
// rows share a terminal row through the half blocks, so the word is 4 rows tall. Corners are cut, so the letters
// read round at this size; the dot of the i ('*') takes the brand color and the rest the text color.
const GLYPHS: Record<string, string[]> = {
  c: ['      ', '      ', ' #####', '##    ', '##    ', '##    ', '##    ', ' #####'],
  e: ['      ', '      ', ' #### ', '##  ##', '######', '##    ', '##    ', ' #####'],
  d: ['    ##', '    ##', ' #####', '##  ##', '##  ##', '##  ##', '##  ##', ' #####'],
  i: ['**', '  ', '##', '##', '##', '##', '##', '##'],
  a: ['      ', '      ', ' #### ', '    ##', ' #####', '##  ##', '##  ##', ' #####'],
};

/** A run of the wordmark's characters in one color: the letters, or the dot of the i. */
export type MarkRun = { text: string; dot?: boolean };

/** The word in half blocks, one list of runs per terminal row; each row's runs join to the same width. */
export function wordmarkRuns(word = 'cedia'): MarkRun[][] {
  const glyphs = [...word].map((ch) => GLYPHS[ch]).filter((g): g is string[] => !!g);
  const rows: MarkRun[][] = [];
  for (let r = 0; r < 8; r += 2) {
    const runs: MarkRun[] = [];
    const put = (text: string, dot: boolean) => {
      const last = runs.at(-1);
      if (last && !!last.dot === dot) last.text += text;
      else runs.push(dot ? { text, dot } : { text });
    };
    glyphs.forEach((g, gi) => {
      if (gi) put('  ', false);
      for (let x = 0; x < g[r]!.length; x++) {
        const top = g[r]![x]!;
        const bottom = g[r + 1]![x]!;
        const ch = top !== ' ' ? (bottom !== ' ' ? '█' : '▀') : bottom !== ' ' ? '▄' : ' ';
        put(ch, top === '*' || bottom === '*');
      }
    });
    rows.push(runs);
  }
  return rows;
}

/** The word in half blocks, one string per terminal row, all the same width. */
export function wordmark(word = 'cedia'): string[] {
  return wordmarkRuns(word).map((runs) => runs.map((r) => r.text).join(''));
}

export const WORDMARK_WIDTH = wordmark()[0]!.length;
// The splash needs the word, three lines under it and room around them; a smaller terminal keeps the plain header.
export const SPLASH_MIN_ROWS = 20;
export const SPLASH_MIN_COLUMNS = 44;

export function showSplash(rows: number, columns: number, screenReader: boolean): boolean {
  return !screenReader && rows >= SPLASH_MIN_ROWS && columns >= SPLASH_MIN_COLUMNS;
}
