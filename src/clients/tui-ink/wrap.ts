// Word wrap for rows the TUI paints line by line (a prompt behind its bar), so each painted line can carry its
// own prefix and band. Breaks at spaces where it can and inside a word where the word is wider than the row.
// Widths are counted in code units, as the transcript's row estimates are (autocomplete.ts, estimateLines).
export function wrapWords(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const line of text.split('\n')) {
    let rest = line;
    while (rest.length > w) {
      const cut = rest.lastIndexOf(' ', w);
      if (cut > 0) {
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut + 1);
      } else {
        out.push(rest.slice(0, w));
        rest = rest.slice(w);
      }
    }
    out.push(rest);
  }
  return out;
}
