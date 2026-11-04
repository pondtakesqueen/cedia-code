import type { MdStyle } from './markdown.tsx';
import { diffRows, hunkOf, langOf, withFileContext, type Hunk } from './diff-rows.ts';
import { wrapWords } from './wrap.ts';

// The transcript rows a turn adds besides the reply itself: one per tool call, the thinking marker and the line
// that ends a turn. A row is styled spans per line; its text (the spans joined) is exactly what shows, so the
// row budget, selection and search count the same characters the terminal paints.
//
//   ✓ Edit  math.js · +1 −1          status glyph, tool name, target, then a summary
//       1   export function add() {  an edit's lines with two around them, the changed ones on a band;
//       2 -   return a - b;         side by side on a wide screen (diff-rows.ts)
//       2 +   return a + b;
//   ✗ Bash  rm -rf dist · blocked
//     └ deny rule: rm -rf *        detail under the call, quieter

export type RowStyle = MdStyle | 'status' | 'name' | 'ok' | 'err' | 'accent' | 'thinking';
// A span's own band: an edit's line (add, del) or the characters that changed in it (addWord, delWord).
export type RowBand = 'add' | 'del' | 'addWord' | 'delWord';
export type RowSpan = { text: string; style: RowStyle; bg?: RowBand };
export type RowLine = { spans: RowSpan[]; band?: 'add' | 'del' };

export const rowText = (lines: RowLine[]): string => lines.map((l) => l.spans.map((s) => s.text).join('')).join('\n');

const NAMES: Record<string, string> = {
  read: 'Read', edit: 'Edit', write: 'Write', bash: 'Bash', grep: 'Grep', glob: 'Glob', ls: 'List',
  web_fetch: 'Fetch', web_search: 'Search', skill: 'Skill', todo: 'Todo', spawn: 'Spawn', ask_user: 'Ask', browser: 'Browser',
};

export function toolName(tool: string): string {
  if (NAMES[tool]) return NAMES[tool]!;
  const t = tool.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** What a call works on, in one line: its command, path, pattern or url. */
export function toolTarget(input: unknown): string {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const one = (v: unknown) => (typeof v === 'string' ? v.split('\n')[0]!.replace(/\s+/g, ' ').trim() : '');
  // A search is named by what it looks for; where it looked follows unless that is the root.
  if (typeof o.pattern === 'string' && o.command === undefined) {
    const where = one(o.path);
    return `${one(o.pattern)}${where && where !== '.' && where !== './' ? `  in ${where}` : ''}`;
  }
  return one(o.command ?? o.path ?? o.url ?? o.query ?? o.name ?? o.file_path ?? Object.values(o).find((x) => typeof x === 'string'));
}

const clip = (s: string, n: number) => (n <= 1 ? '' : s.length > n ? `${s.slice(0, n - 1)}…` : s);

function head(tool: string, input: unknown, width: number): RowSpan[] {
  const name = toolName(tool);
  const target = clip(toolTarget(input), Math.max(8, width - name.length - 24));
  return [{ text: '●', style: 'status' }, { text: ' ', style: 'text' }, { text: name, style: 'name' }, ...(target ? [{ text: `  ${target}`, style: 'text' as const }] : [])];
}

export function intentRow(tool: string, input: unknown, width: number): RowLine[] {
  return [{ spans: head(tool, input, width) }];
}

/** An edit call's hunks, from its input and the line each edit starts on, as the edit tool reports it. */
export function editDiff(input: unknown, output: string): { added: number; removed: number; hunks: Hunk[] } {
  const edits = (input as { edits?: unknown })?.edits;
  if (!Array.isArray(edits)) return { added: 0, removed: 0, hunks: [] };
  const starts = [...output.matchAll(/^edit (\d+): lines (\d+)-/gm)].reduce<Record<number, number>>((acc, m) => ({ ...acc, [Number(m[1])]: Number(m[2]) }), {});
  let added = 0;
  let removed = 0;
  const hunks: Hunk[] = [];
  edits.forEach((e, i) => {
    const h = hunkOf(String((e as { old_text?: unknown })?.old_text ?? ''), String((e as { new_text?: unknown })?.new_text ?? ''), starts[i + 1] ?? 1);
    added += h.added;
    removed += h.removed;
    if (h.added || h.removed) hunks.push(h.hunk);
  });
  return { added, removed, hunks };
}

const BASH_LINES = 3;
// What an expanded row shows (alt+e) before the rest is a count.
export const EXPANDED_LINES = 200;

export function resultRow(
  tool: string,
  input: unknown,
  output: { text: string; isError?: boolean; exitCode?: number },
  ms: number | undefined,
  width: number,
  // An edit's file as it is after the call, for the unchanged lines around its hunks.
  file?: string,
  // Expanded (alt+e): a command's output and an edit's diff up to EXPANDED_LINES rows instead of a few.
  expanded = false,
): RowLine[] {
  const first: RowSpan[] = head(tool, input, width);
  const detail: RowLine[] = [];
  const sum: RowSpan[] = [];
  const text = output.text ?? '';
  const nonEmpty = text.split('\n').filter((l) => l.trim());
  const sub = (s: string, style: RowStyle = 'muted') =>
    detail.push({ spans: [{ text: '  └ ', style: 'faint' }, { text: clip(s.replace(/\t/g, '  '), Math.max(10, width - 6)), style }] });
  const more = (s: string, style: RowStyle = 'muted') =>
    detail.push({ spans: [{ text: '    ', style: 'faint' }, { text: clip(s.replace(/\t/g, '  '), Math.max(10, width - 6)), style }] });
  // The exit code bash closes its output with, when the event did not carry one.
  const exit = output.exitCode ?? (tool === 'bash' ? Number(text.match(/^\[exit (-?\d+)/m)?.[1] ?? NaN) : NaN);
  if (output.isError && tool === 'bash') {
    if (Number.isFinite(exit) && exit !== 0) sum.push({ text: `exit ${exit}`, style: 'err' });
    // What went wrong is on stderr; without it, the last line printed is the nearest to the failure.
    const lines = text.split('\n');
    const errAt = lines.indexOf('[stderr]');
    const pick = (ls: string[]) => ls.filter((l) => l.trim() && !/^\[exit -?\d+/.test(l) && l !== '[stderr]' && l !== '(no output)');
    const said = errAt >= 0 ? pick(lines.slice(errAt + 1)) : [];
    sub((said[0] ?? pick(lines).at(-1)) || 'failed', 'err');
  } else if (output.isError) {
    sub(nonEmpty[0] ?? 'failed', 'err');
  } else if (tool === 'read') {
    sum.push({ text: `${nonEmpty.length} line${nonEmpty.length === 1 ? '' : 's'}`, style: 'muted' });
  } else if (tool === 'edit') {
    const d = editDiff(input, text);
    sum.push({ text: `+${d.added}`, style: 'ok' }, { text: ' ', style: 'muted' }, { text: `−${d.removed}`, style: 'err' });
    const path = String((input as { path?: unknown })?.path ?? '');
    const rows = diffRows(file !== undefined ? withFileContext(d.hunks, file) : d.hunks, width, langOf(path), 3, expanded ? EXPANDED_LINES : undefined);
    detail.push(...rows.lines);
    if (rows.hidden) detail.push({ spans: [{ text: `     … ${rows.hidden} more line${rows.hidden === 1 ? '' : 's'} · ${expanded ? '/diff' : 'alt+e'}`, style: 'faint' }] });
  } else if (tool === 'todo' && todoSteps(input).length) {
    return todoRow(input, width);
  } else if (tool === 'write') {
    const content = String((input as { content?: unknown })?.content ?? '');
    const n = content.replace(/\n$/, '').split('\n').length;
    sum.push({ text: `+${n} line${n === 1 ? '' : 's'}`, style: 'ok' });
  } else if (tool === 'bash') {
    if (output.exitCode !== undefined && output.exitCode !== 0) sum.push({ text: `exit ${output.exitCode}`, style: 'err' });
    // The bash tool closes its output with "[exit N]" and marks stderr; the row already says how it ended.
    const shown = nonEmpty.filter((l) => !/^\[exit -?\d+/.test(l) && l !== '[stderr]' && l !== '(no output)');
    // The first lines show under the call, as a terminal would; the rest is a count.
    const keep = expanded ? EXPANDED_LINES : BASH_LINES;
    shown.slice(0, keep).forEach((l, i) => (i === 0 ? sub(l) : more(l)));
    if (shown.length > keep) more(`… +${shown.length - keep} lines${expanded ? '' : ' · alt+e'}`, 'faint');
  } else if (nonEmpty.length > 1) {
    sum.push({ text: `${nonEmpty.length} lines`, style: 'muted' });
  } else if (nonEmpty.length === 1) {
    sub(nonEmpty[0]!);
  }
  if (ms !== undefined && ms >= 1000) sum.push({ text: `${sum.length ? ' · ' : ''}${(ms / 1000).toFixed(1)}s`, style: 'muted' });
  if (sum.length) first.push({ text: ' · ', style: 'faint' }, ...sum);
  return [{ spans: first }, ...detail];
}

// The todo tool's steps as a checklist, the marks the sub-thread view uses (subthreads.ts): done, doing, to do.
export type TodoStep = { text: string; state: 'pending' | 'doing' | 'done' };
const STEP: Record<TodoStep['state'], [string, RowStyle]> = { done: ['✓', 'ok'], doing: ['◐', 'accent'], pending: ['○', 'faint'] };

export function todoSteps(input: unknown): TodoStep[] {
  const items = (input as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((i) => ({ text: String((i as { text?: unknown })?.text ?? '').replace(/\s+/g, ' ').trim(), state: (i as { state?: unknown })?.state }))
    .filter((i): i is TodoStep => !!i.text && (i.state === 'pending' || i.state === 'doing' || i.state === 'done'));
}

export function todoLines(steps: TodoStep[], width: number, indent = '    '): RowLine[] {
  return steps.map((st) => ({
    spans: [
      { text: indent, style: 'faint' as const },
      { text: STEP[st.state][0], style: STEP[st.state][1] },
      { text: ` ${clip(st.text, Math.max(10, width - indent.length - 2))}`, style: st.state === 'done' ? 'muted' as const : 'text' as const },
    ],
  }));
}

/** A todo call: its progress on the line, its steps under it. */
export function todoRow(input: unknown, width: number): RowLine[] {
  const steps = todoSteps(input);
  const done = steps.filter((s) => s.state === 'done').length;
  return [
    { spans: [{ text: '●', style: 'status' }, { text: ' ', style: 'text' }, { text: 'Todo', style: 'name' }, { text: ' · ', style: 'faint' }, { text: `${done}/${steps.length} done`, style: 'muted' }] },
    ...todoLines(steps, width),
  ];
}

/**
 * A call the policy stopped. The rule and its reason show in full (wrapped, not cut: it is why nothing happened);
 * a call stopped by the same rule as the row before it says so in a word instead of repeating it.
 */
export function deniedRow(tool: string, input: unknown, rule: string, reason: string | undefined, width: number, same = false): RowLine[] {
  const top: RowLine = { spans: [...head(tool, input, width), { text: ' · ', style: 'faint' }, { text: 'blocked', style: 'err' }, ...(same ? [{ text: ' (same rule)', style: 'faint' as const }] : [])] };
  if (same) return [top];
  const why = wrapWords(`${rule}${reason ? `: ${reason}` : ''}`, Math.max(10, width - 6));
  return [top, ...why.map((w, i) => ({ spans: [{ text: i === 0 ? '  └ ' : '    ', style: 'faint' as const }, { text: w, style: 'muted' as const }] }))];
}

export function thinkingRow(text: string, ms: number | undefined, expanded: boolean): RowLine[] {
  const took = ms !== undefined && ms >= 100 ? ` for ${(ms / 1000).toFixed(1)}s` : '';
  const top: RowLine = { spans: [{ text: `∴ Thought${took}`, style: 'thinking' }, { text: expanded ? '' : '  alt+t to expand', style: 'faint' }] };
  if (!expanded) return [top];
  return [top, ...text.split('\n').map((l) => ({ spans: [{ text: `  ${l}`, style: 'quote' as const }] }))];
}

export type TurnEnd = { subtype: string; ms: number; tools: number; files: number; costUsd: number };

export function doneRow(t: TurnEnd): RowLine[] {
  const facts = [`in ${(t.ms / 1000).toFixed(1)}s`, t.tools ? `${t.tools} tool${t.tools === 1 ? '' : 's'}` : '', t.files ? `${t.files} file${t.files === 1 ? '' : 's'} changed` : '', `$${t.costUsd.toFixed(4)}`].filter(Boolean).join(' · ');
  if (t.subtype === 'success') {
    return [{ spans: [{ text: '✓ Done', style: 'ok' }, { text: ` ${facts}`, style: 'muted' }, { text: t.files ? '   /diff  /undo  /commit' : '', style: 'faint' }] }];
  }
  const [mark, style] = END_MARKS[t.subtype] ?? [`✗ Ended: ${t.subtype.replace(/_/g, ' ')}`, 'err' as const];
  return [{ spans: [{ text: mark, style }, { text: ` ${facts}`, style: 'muted' }] }];
}

const END_MARKS: Record<string, [string, RowStyle]> = {
  asked: ['? Waiting for your answer', 'accent'],
  handoff: ['✓ Handed off to a new session', 'ok'],
  interrupted: ['■ Stopped', 'accent'],
  error_max_turns: ['✗ Hit the turn limit', 'err'],
  error_max_budget_usd: ['✗ Hit the budget', 'err'],
  error_during_execution: ['✗ Failed', 'err'],
  error_unverified_claim: ['✗ Claimed done without proof', 'err'],
  error_stuck: ['✗ Stopped going in circles', 'err'],
};

export function rowProps(style: RowStyle, T: { text: string; textMuted: string; textFaint: string; success: string; error: string; accent: string; thinking: string }): { color?: string; bold?: boolean; italic?: boolean } | undefined {
  switch (style) {
    case 'name': return { bold: true };
    case 'ok': return { color: T.success };
    case 'err': return { color: T.error };
    case 'accent': return { color: T.accent };
    case 'thinking': return { color: T.thinking, italic: true };
    default: return undefined;
  }
}
