import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { readEventsLenient } from '../session/usage.ts';
import type { ThreadStore } from '../threads/threads.ts';
import type { Check, Evidence } from '../types.ts';
import { gitSync } from './run.ts';

// How a commit was verified, from the receipts the thread's runs left in their logs (the `result` event the
// writer's log ends with), never from what a model says. A file counts as verified when the last run that changed
// it had a declared check pass after its last write; a file no run recorded (changed by hand, or by a run with no
// receipt) is not. The stamp goes in the commit as trailers, so `git log --grep='^Verified-by: none'` finds the
// commits nobody checked, and the client warns before a commit or a pull request that holds unverified work.

// What the thread's receipts say about `files`: the checks that verified them, and those no passing check covers.
export type Verification = { checks: Check[]; unverified: string[] };

// Trailer keys. `Verified-by` names each passing check (or `none`); `Unverified` names the files no check covered.
export const VERIFIED_BY = 'Verified-by';
export const UNVERIFIED = 'Unverified';

const MAX_TRAILER_FILES = 10;

const norm = (cwd: string, p: string) => {
  const rel = relative(cwd, resolve(cwd, p));
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : p;
};

// The receipts of the thread's runs, oldest first: each writer log's last `result` event.
export function threadReceipts(store: ThreadStore, thread: string): Evidence[] {
  if (!store.has(thread)) return [];
  const out: Evidence[] = [];
  for (const s of store.read(thread).sessions) {
    if (s.rewound || !s.path || !existsSync(s.path)) continue;
    let text: string;
    try {
      text = readFileSync(s.path, 'utf8');
    } catch {
      continue;
    }
    const result = readEventsLenient(text).findLast((e) => e.kind === 'result');
    if (result?.kind === 'result' && result.result.evidence) out.push(result.result.evidence);
  }
  return out;
}

// Each file's state after the receipts, in order: a later run that changed a file decides it again.
export function verification(receipts: Evidence[], files: string[], cwd: string): Verification {
  const state = new Map<string, Check[] | undefined>();
  for (const ev of receipts) {
    const passed = ev.checks.filter((c) => c.exitCode === 0);
    const unverified = new Set(ev.unverified.map((p) => norm(cwd, p)));
    for (const p of ev.changed) {
      const f = norm(cwd, p);
      state.set(f, !unverified.has(f) && passed.length ? passed : undefined);
    }
  }
  const checks = new Map<string, Check>();
  const unverified: string[] = [];
  for (const f of files) {
    const passed = state.get(f);
    if (!passed) unverified.push(f);
    else for (const c of passed) checks.set(c.command, c);
  }
  return { checks: [...checks.values()], unverified };
}

// The trailers a commit of these files carries. A check is named with its exit code and, when it said, how it went.
export function verificationTrailers(v: Verification): string {
  const lines = v.checks.length
    ? v.checks.map((c) => `${VERIFIED_BY}: ${c.command} (exit ${c.exitCode}${c.tail ? `, ${c.tail.replace(/\s+/g, ' ').slice(0, 80)}` : ''})`)
    : [`${VERIFIED_BY}: none`];
  if (v.checks.length && v.unverified.length) {
    const shown = v.unverified.slice(0, MAX_TRAILER_FILES).join(', ');
    lines.push(`${UNVERIFIED}: ${shown}${v.unverified.length > MAX_TRAILER_FILES ? `, and ${v.unverified.length - MAX_TRAILER_FILES} more` : ''}`);
  }
  return lines.join('\n');
}

// The message with the stamp as its last paragraph. A message that already carries one keeps it.
export function stampMessage(message: string, v: Verification): string {
  const m = message.trimEnd();
  if (new RegExp(`^${VERIFIED_BY}:`, 'm').test(m)) return m;
  return `${m}\n\n${verificationTrailers(v)}`;
}

// The warning a client shows before committing: undefined when every file passed a check after its last change.
export function unverifiedWarning(v: Verification): string | undefined {
  if (!v.unverified.length) return undefined;
  const n = v.unverified.length;
  return `${n} file${n === 1 ? '' : 's'} changed with no passing check after the last change: ${v.unverified.slice(0, MAX_TRAILER_FILES).join(', ')}${n > MAX_TRAILER_FILES ? `, and ${n - MAX_TRAILER_FILES} more` : ''}`;
}

// The branch's commits, from `range` (`origin/main..HEAD`), that say they hold unverified work: a `Verified-by:
// none` or an `Unverified:` trailer. Each as its short hash and subject.
export function unverifiedCommits(cwd: string, range: string): string[] {
  const r = gitSync(cwd, ['log', '--format=%h %s%x00%B%x01', range]);
  if (r.status !== 0) return [];
  const out: string[] = [];
  for (const rec of (r.stdout ?? '').split('\x01')) {
    const [head, body = ''] = rec.replace(/^\n/, '').split('\0');
    if (!head?.trim()) continue;
    if (new RegExp(`^(${VERIFIED_BY}: none|${UNVERIFIED}:)`, 'm').test(body)) out.push(head.trim());
  }
  return out;
}
