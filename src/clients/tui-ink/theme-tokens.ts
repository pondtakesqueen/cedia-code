import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Design-token theme for the ink TUI (dark + light variants). Every color the TUI paints comes from here,
// markdown and code included. The palette is cedia's own: a sea-green brand on neutral greys (no tint, so the one
// accent carries), amber for work in progress, violet for thinking and plan mode. Status takes color (running, done, failed, mode); hierarchy takes weight and space.
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
  primary: '#3fd0b2',
  secondary: '#b69cff',
  accent: '#f2b766',
  error: '#f2777a',
  warning: '#f2b766',
  success: '#7fd48a',
  info: '#3fd0b2',
  text: '#e6e6e6',
  textMuted: '#8c8c8c',
  textFaint: '#565656',
  background: '#0d0d0d',
  backgroundPanel: '#161616',
  backgroundElement: '#1b1b1b',
  userRowBg: '#1f1f1f',
  selectedBg: '#2a2a2a',
  selectionBg: '#1f4f46',
  selectionFg: '#f5f5f5',
  searchHitBg: '#f2b766',
  searchHitFg: '#0d0d0d',
  border: '#3a3a3a',
  borderActive: '#3fd0b2',
  diffAdded: '#7fd48a',
  diffRemoved: '#f2777a',
  diffAddedBg: '#132a1b',
  diffRemovedBg: '#33171a',
  diffAddedWordBg: '#1f5232',
  diffRemovedWordBg: '#66252e',
  diffContext: '#8c8c8c',
  diffHunkHeader: '#3fd0b2',
  thinking: '#b69cff',
  code: '#7fdcc6',
  heading: '#f5f5f5',
  link: '#6cb6ff',
  synKeyword: '#c49cff',
  synString: '#a3d98b',
  synComment: '#6b6b6b',
  synNumber: '#f5a85c',
  synFunction: '#6cb6ff',
};

const light: ThemeTokens = {
  primary: '#0f8a74',
  secondary: '#7048e8',
  accent: '#b06a00',
  error: '#c4414a',
  warning: '#b06a00',
  success: '#3f7f45',
  info: '#0f8a74',
  text: '#262626',
  textMuted: '#6e6e6e',
  textFaint: '#a8a8a8',
  background: '#fafafa',
  backgroundPanel: '#f2f2f2',
  backgroundElement: '#ececec',
  userRowBg: '#eeeeee',
  selectedBg: '#e0e0e0',
  selectionBg: '#c2e8df',
  selectionFg: '#111111',
  searchHitBg: '#b06a00',
  searchHitFg: '#fafafa',
  border: '#c8c8c8',
  borderActive: '#0f8a74',
  diffAdded: '#3f7f45',
  diffRemoved: '#c4414a',
  diffAddedBg: '#e1f2e4',
  diffRemovedBg: '#f8e1e3',
  diffAddedWordBg: '#b5e3bf',
  diffRemovedWordBg: '#f3b9c0',
  diffContext: '#6e6e6e',
  diffHunkHeader: '#0f8a74',
  thinking: '#7048e8',
  code: '#0b6e5d',
  heading: '#111111',
  link: '#1f6fd1',
  synKeyword: '#7048e8',
  synString: '#3f7f45',
  synComment: '#8c8c8c',
  synNumber: '#b06a00',
  synFunction: '#1f6fd1',
};

export const INK_THEMES: Record<ThemeName, ThemeTokens> = { dark, light };

// A panel's border: a bar on its left only, drawn in the color the panel gives it (the prompt, a blocked call).
export const PANEL_BAR = { topLeft: '', top: '', topRight: '', right: '', bottomRight: '', bottom: '', bottomLeft: '', left: '▌' };

// A terminal with 256 colors gets each hex mapped to a palette entry, and the faint tints of the bands above
// all land on the same mid grey. There the bands take values that map to chosen entries instead: greys exactly,
// and #003300 / #330000 / #003333, which the mapping (a linear 0-5 scale per channel) sends to entries 22, 52
// and 23 (#005f00, #5f0000, #005f5f); the changed characters' #006600 / #660000 go to 28 and 88 (#008700, #870000).
const BANDS_256: Record<ThemeName, Partial<ThemeTokens>> = {
  dark: { background: '#1c1c1c', backgroundElement: '#262626', userRowBg: '#262626', selectedBg: '#303030', diffAddedBg: '#003300', diffRemovedBg: '#330000', diffAddedWordBg: '#006600', diffRemovedWordBg: '#660000', selectionBg: '#003333' },
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
