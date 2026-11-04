import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Design-token theme for the ink TUI (dark + light variants). Every color the TUI paints comes from here,
// markdown and code included. The palette is the owner's Warm & Lime (cedian's script/themes/cedian.py): warm
// greys, one lime accent kept rare (the prompt bar, the mode, the first seed of the mark), amber for work in
// progress, violet for thinking and plan mode, syntax hues low in chroma so lime stays the accent. Status takes color (running, done, failed, mode); hierarchy takes weight and space.
// The TUI never paints the whole background: the terminal's own stays, and only rows that need a band get one.
// Hex values downsample to 256 or 16 colors where the terminal has no truecolor.
export type ThemeName = 'dark' | 'light';

export type ThemeTokens = {
  primary: string;
  secondary: string;
  accent: string;
  error: string;
  warning: string;
  success: string;
  info: string;
  text: string;
  textMuted: string;
  // Rules, borders at rest, hints: one step quieter than textMuted.
  textFaint: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  userRowBg: string;
  selectedBg: string;
  selectionBg: string;
  selectionFg: string;
  searchHitBg: string;
  searchHitFg: string;
  border: string;
  borderActive: string;
  diffAdded: string;
  diffRemoved: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  // The characters that changed in an added or removed line: a step stronger than its band.
  diffAddedWordBg: string;
  diffRemovedWordBg: string;
  diffContext: string;
  diffHunkHeader: string;
  // Thinking and plan mode.
  thinking: string;
  code: string;
  heading: string;
  link: string;
  synKeyword: string;
  synString: string;
  synComment: string;
  synNumber: string;
  synFunction: string;
};

const dark: ThemeTokens = {
  primary: '#c6f432',
  secondary: '#cfa6ff',
  accent: '#e8b931',
  error: '#ff7a66',
  warning: '#e8b931',
  success: '#7bd88f',
  info: '#6fb0ff',
  text: '#edebe5',
  textMuted: '#ada99f',
  textFaint: '#6f6b63',
  background: '#151412',
  backgroundPanel: '#1c1b19',
  backgroundElement: '#252421',
  userRowBg: '#2c2b28',
  selectedBg: '#34332f',
  selectionBg: '#4a5a1a',
  selectionFg: '#f7f5ef',
  searchHitBg: '#e8b931',
  searchHitFg: '#151412',
  border: '#45433e',
  borderActive: '#c6f432',
  diffAdded: '#7bd88f',
  diffRemoved: '#ff7a66',
  diffAddedBg: '#1f2e21',
  diffRemovedBg: '#3a221d',
  diffAddedWordBg: '#2f5536',
  diffRemovedWordBg: '#6a3026',
  diffContext: '#ada99f',
  diffHunkHeader: '#ada99f',
  thinking: '#cfa6ff',
  code: '#86d4c4',
  heading: '#f7f5ef',
  link: '#6fb0ff',
  synKeyword: '#cfa6ff',
  synString: '#a8d98c',
  synComment: '#7d796f',
  synNumber: '#e8b931',
  synFunction: '#c3c2ff',
};

const light: ThemeTokens = {
  primary: '#5e8a00',
  secondary: '#8a3fc9',
  accent: '#8f5d00',
  error: '#c23a22',
  warning: '#8f5d00',
  success: '#2f7d3f',
  info: '#1b63be',
  text: '#1c1c1a',
  textMuted: '#5b5b56',
  textFaint: '#9c9c95',
  background: '#f4f4f1',
  backgroundPanel: '#ecece8',
  backgroundElement: '#e6e6e1',
  userRowBg: '#e2e2dc',
  selectedBg: '#dadad3',
  selectionBg: '#dcebb4',
  selectionFg: '#1c1c1a',
  searchHitBg: '#8f5d00',
  searchHitFg: '#f4f4f1',
  border: '#c4c4bc',
  borderActive: '#5e8a00',
  diffAdded: '#2f7d3f',
  diffRemoved: '#c23a22',
  diffAddedBg: '#e2f0df',
  diffRemovedBg: '#f8e2dc',
  diffAddedWordBg: '#bce0bb',
  diffRemovedWordBg: '#f0bcae',
  diffContext: '#5b5b56',
  diffHunkHeader: '#5b5b56',
  thinking: '#8a3fc9',
  code: '#00796b',
  heading: '#0f0f0e',
  link: '#1b63be',
  synKeyword: '#8a3fc9',
  synString: '#2f7d3f',
  synComment: '#8a8a83',
  synNumber: '#8f5d00',
  synFunction: '#4a4fc4',
};

export const INK_THEMES: Record<ThemeName, ThemeTokens> = { dark, light };

// A panel's border: a bar on its left only, drawn in the color the panel gives it (the prompt, a blocked call).
export const PANEL_BAR = { topLeft: '', top: '', topRight: '', right: '', bottomRight: '', bottom: '', bottomLeft: '', left: '▌' };

// A terminal with 256 colors gets each hex mapped to a palette entry, and the faint tints of the bands above
// all land on the same mid grey. There the bands take values that map to chosen entries instead: greys exactly,
// and #003300 / #330000 / #003333, which the mapping (a linear 0-5 scale per channel) sends to entries 22, 52
// and 23 (#005f00, #5f0000, #005f5f); the changed characters' #006600 / #660000 go to 28 and 88 (#008700, #870000).
const BANDS_256: Record<ThemeName, Partial<ThemeTokens>> = {
  dark: { background: '#1c1c1c', backgroundElement: '#262626', userRowBg: '#303030', selectedBg: '#3a3a3a', diffAddedBg: '#003300', diffRemovedBg: '#330000', diffAddedWordBg: '#006600', diffRemovedWordBg: '#660000', selectionBg: '#003333' },
  light: { background: '#ffffff', backgroundElement: '#eeeeee', userRowBg: '#eeeeee', selectedBg: '#dadada', diffAddedBg: '#d7ffd7', diffRemovedBg: '#ffd7d7', diffAddedWordBg: '#afffaf', diffRemovedWordBg: '#ffafaf', selectionBg: '#afd7d7' },
};

/** Whether the terminal shows 24-bit color, by the same signals supports-color reads. */
export function truecolor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '')) return true;
  if (/-direct$|^xterm-kitty$|^xterm-ghostty$/.test(env.TERM ?? '')) return true;
  return ['iTerm.app', 'WezTerm', 'ghostty', 'vscode'].includes(env.TERM_PROGRAM ?? '');
}

export function tokensFor(name: ThemeName, env: NodeJS.ProcessEnv = process.env): ThemeTokens {
  return truecolor(env) ? INK_THEMES[name] : { ...INK_THEMES[name], ...BANDS_256[name] };
}

export function resolveThemeName(raw: unknown): ThemeName {
  return raw === 'light' ? 'light' : 'dark';
}

/** The theme the person chose in settings.json, if they chose one. */
export function themeSetting(home: string): ThemeName | undefined {
  try {
    const p = join(home, 'settings.json');
    if (!existsSync(p)) return undefined;
    const raw = (JSON.parse(readFileSync(p, 'utf8')) as { theme?: unknown }).theme;
    return raw === 'light' || raw === 'dark' ? raw : undefined;
  } catch {
    return undefined;
  }
}

// The terminal's own background, when the TUI could read it as it opened (terminal-theme.ts): the theme for a
// person who never chose one, so a light terminal does not get dark panels.
let terminalTheme: ThemeName | undefined;
export function setTerminalTheme(name: ThemeName | undefined): void {
  terminalTheme = name;
}

/** Light or dark for a background color, each channel 0 to 1: light past half of full luminance. */
export function themeForBackground(r: number, g: number, b: number): ThemeName {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark';
}

/** The theme a terminal's reply to OSC 11 (`ESC ] 11 ; rgb:RRRR/GGGG/BBBB`) gives, or undefined. */
export function themeFromOsc11(reply: string): ThemeName | undefined {
  const m = /\]11;rgba?:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})/i.exec(reply);
  if (!m) return undefined;
  const c = (h: string) => parseInt(h, 16) / (16 ** h.length - 1);
  return themeForBackground(c(m[1]!), c(m[2]!), c(m[3]!));
}

/** COLORFGBG ("fg;bg", set by rxvt, Konsole, iTerm2 and others): a background of 7 or 9 to 15 is light. */
export function themeFromColorfgbg(env: NodeJS.ProcessEnv = process.env): ThemeName | undefined {
  const bg = Number((env.COLORFGBG ?? '').split(';').pop());
  if (!env.COLORFGBG || !Number.isInteger(bg)) return undefined;
  return bg === 7 || (bg >= 9 && bg <= 15) ? 'light' : 'dark';
}

// The theme: the person's choice, else the terminal's background as read when the TUI opened, else COLORFGBG,
// else dark.
export function inkTheme(home: string, env: NodeJS.ProcessEnv = process.env): { name: ThemeName; tokens: ThemeTokens } {
  const name = themeSetting(home) ?? terminalTheme ?? themeFromColorfgbg(env) ?? 'dark';
  return { name, tokens: tokensFor(name, env) };
}
