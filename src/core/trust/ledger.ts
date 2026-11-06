import { resolve } from 'node:path';
import { checkReadOnly } from '../safety/shell.ts';
import type { EventOf, Evidence, SessionEvent } from '../types.ts';

// The evidence ledger is derived from the log alone, so it says what happened, not what the model claims.
export type LedgerEntry =
  | { kind: 'write'; at: number; tool: string; path?: string; command?: string }
  | { kind: 'check'; at: number; command: string; exitCode: number; tail?: string; ms?: number };

// Lines a test runner ends with to say how it went: counts of passes and failures, a result line. They come before
// other lines that only mention an outcome (a test's own `(pass) name` line).
const COUNTS = /\d+\s+(pass(ed|es)?|fail(ed|s|ures?)?|skip(ped)?|errors?|tests?)\b|test result|^ran \d+/i;
// Lines a test runner or build ends with to say how it went: counts of passes and failures, a result line.
const OUTCOME = /\b(pass(ed|es)?|fail(ed|s|ures?)?|errors?|skip(ped)?|todo|ok|tests?|warnings?)\b/i;
const TAIL_LINES = 5;
const TAIL_CHARS = 300;

// The end of a check's output that says how it went: up to five of its last lines that count outcomes (bun's
// `1110 pass`, `3 fail`, `Ran 1130 tests`; pytest's `5 passed in 0.1s`; cargo's `test result: ok`), else that read
// like one, else its last two lines. cedia's own trailers (`[exit 1]`, `[cedia: …]`, a hook's note) are not the check's words.
export function checkTail(text: string): string | undefined {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && l !== '(no output)' && !/^\[(exit \d+|cedia[: ]|hook )/.test(l) && !/\x1b/.test(l));
  const tail = lines.slice(-40);
  const counts = tail.filter((l) => COUNTS.test(l));
  const outcome = (counts.length ? counts : tail.filter((l) => OUTCOME.test(l))).slice(-TAIL_LINES);
  const picked = outcome.length ? outcome : lines.slice(-2);
  const joined = picked.map((l) => (l.length > 120 ? `${l.slice(0, 117)}...` : l)).join(' · ');
  if (!joined) return undefined;
  return joined.length > TAIL_CHARS ? `${joined.slice(0, TAIL_CHARS - 3)}...` : joined;
}

// A bash call counts as a declared check only when its whole command is the check, give or take
// whitespace and a trailing 2>&1. A pipe would hide the check's exit code, so `bun test | tail` does not count.
// A leading `cd <working dir> &&` is allowed too: models often add it, and it changes nothing.
export function matchCheck(command: string, checks: string[], cwd?: string): string | undefined {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/ 2>&1$/, '');
  let c = norm(command);
  const cd = /^cd ("[^"]*"|'[^']*'|\S+) ?&& ?(.*)$/.exec(c);
  if (cd && cwd && resolve(cwd, cd[1]!.replace(/^["']|["']$/g, '')) === resolve(cwd)) c = cd[2]!;
  return checks.find((k) => norm(k) === c);
}

export function ledgerEntries(events: SessionEvent[], checks: string[], cwd?: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  const intents = new Map<string, EventOf<'tool_intent'>>();
  // With snapshots the log names the files each writing call changed, bash included.
  const snapped = new Map<string, string[]>();
  for (const e of events) if (e.kind === 'snapshot' && e.callId) snapped.set(e.callId, e.changed);
  events.forEach((e, at) => {
    if (e.kind === 'request') intents.clear();
    if (e.kind === 'tool_intent') intents.set(e.callId, e);
    if (e.kind !== 'tool_result') return;
    const intent = intents.get(e.callId);
    if (!intent || e.status === 'denied' || e.status === 'not_started') return;
    const files = snapped.get(e.callId);
    const command = intent.tool === 'bash' ? String(intent.input.command ?? '') : undefined;
    const check = command !== undefined ? matchCheck(command, checks, cwd) : undefined;
    if (check !== undefined) {
      // Files a check leaves behind (caches, coverage) are not the change it verifies.
      const tail = checkTail(e.output.text);
      const ms = Date.parse(e.at) - Date.parse(intent.at);
      out.push({ kind: 'check', at, command: check, exitCode: e.output.exitCode ?? (e.output.isError ? 1 : 0), ...(tail ? { tail } : {}), ...(ms >= 0 ? { ms } : {}) });
    } else if (files) {
      for (const path of files) out.push({ kind: 'write', at, tool: intent.tool, path });
    } else if (intent.tool === 'edit' || intent.tool === 'write') {
      if (e.status === 'completed') out.push({ kind: 'write', at, tool: intent.tool, path: String(intent.input.path) });
    } else if (intent.tool === 'spawn' && intent.input.kind === 'work') {
      // Without snapshots, a sub-thread that may write counts as one write the gate must see checked.
      out.push({ kind: 'write', at, tool: 'spawn', command: 'a work sub-thread' });
    } else if (command !== undefined && !checkReadOnly(command).ok) {
      out.push({ kind: 'write', at, tool: 'bash', command });
    }
  });
  return out;
}

const label = (w: Extract<LedgerEntry, { kind: 'write' }>) => w.path ?? `${w.tool}: ${w.command}`;

export function evidence(entries: LedgerEntry[]): Evidence {
  const writes = entries.filter((e): e is Extract<LedgerEntry, { kind: 'write' }> => e.kind === 'write');
  const checks = entries.filter((e): e is Extract<LedgerEntry, { kind: 'check' }> => e.kind === 'check');
  const lastPass = Math.max(-1, ...checks.filter((c) => c.exitCode === 0).map((c) => c.at));
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    changed: uniq(writes.map(label)),
    checks: checks.map(({ command, exitCode, tail, ms }) => ({ command, exitCode, ...(tail ? { tail } : {}), ...(ms !== undefined ? { ms } : {}) })),
    unverified: uniq(writes.filter((w) => w.at > lastPass).map(label)),
  };
}

// Done gate: with declared checks, a run that wrote must have a passing check after its last write.
export function verified(entries: LedgerEntry[], checks: string[]): boolean {
  if (!checks.length) return true;
  const lastWrite = Math.max(-1, ...entries.filter((e) => e.kind === 'write').map((e) => e.at));
  if (lastWrite < 0) return true;
  return entries.some((e) => e.kind === 'check' && e.exitCode === 0 && e.at > lastWrite);
}

// A declared check that already passed with nothing written since need not run again: the gate still sees
// the earlier pass. Returns the denial reason, or undefined to run. Only passed repeats are held; a failed
// check always reruns, since the model may have fixed the cause outside the working tree.
export function repeatCheck(tool: string, command: string | undefined, events: SessionEvent[], checks: string[], cwd?: string): string | undefined {
  if (tool !== 'bash' || !command) return undefined;
  const check = matchCheck(command, checks, cwd);
  if (!check) return undefined;
  const entries = ledgerEntries(events, checks, cwd);
  const passes = entries.filter((e) => e.kind === 'check' && e.command === check && e.exitCode === 0);
  if (!passes.length) return undefined;
  const lastPass = Math.max(...passes.map((p) => p.at));
  if (entries.some((e) => e.kind === 'write' && e.at > lastPass)) return undefined;
  return `\`${check}\` already passed with nothing written since; run it again only after changing files. The done gate still sees the earlier pass.`;
}
