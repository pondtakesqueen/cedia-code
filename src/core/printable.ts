// Text from a repository, a session or a note, made safe to print on a terminal: control characters (C0, DEL, C1,
// which carry escape sequences) and the bidi overrides and isolates (which reorder what the reader sees) are shown
// as \uXXXX instead of acting. One cleaner for every list cedia prints, in the CLI and the TUI alike.
const UNSAFE = /[\x00-\x1f\x7f-\x9f‪-‮⁦-⁩]/g;
export const printable = (text: string): string => text.replace(UNSAFE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
