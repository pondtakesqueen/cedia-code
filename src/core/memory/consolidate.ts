import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cediaHome } from '../config.ts';
import { loadRoles } from '../config.ts';
import { projectKey } from '../session/log.ts';
import { resolveModel } from '../providers/catalog.ts';
import { runSide } from '../loop/side.ts';
import { forgetTool, memoryPath, MemoryStore, notesForPass, rememberTool, reviseTool, MAX_NOTE } from './memory.ts';
import { loadPolicy } from '../config.ts';
import { redactSecrets } from '../safety/secrets.ts';
import type { Policy } from '../safety/policy.ts';
import { selfSpawnArgs } from '../self.ts';
import { grepTool } from '../tools/grep.ts';
import { readTool } from '../tools/read.ts';
import { fauxActive } from '../providers/faux.ts';

// Memory consolidation ("dreaming"): between sessions, scan a project's session transcripts and let a model tend
// the project's memory notes: correct or drop the wrong ones, merge repeats, keep new durable facts. Runs when asked
// (`cedia memory consolidate`), or after a writer run once a day with `dream` on (startDream). Never mid-session.

export type ConsolidationLock = { lastConsolidatedAt: string; pid?: number };
export type ConsolidationResult = {
  consolidated: boolean;
  skipped?: string;
  notesBefore: number;
  notesAfter: number;
  added: number;
  forgotten: number;
  lockPath: string;
  sessionsScanned: number;
};

// Where the consolidated memory directory and lock live. The notes themselves stay in
// memory.jsonl next to it (see memory.ts); only the lock moves into the directory.
export const memoryDir = (home: string, slug: string) => join(home, 'projects', slug, 'memory');
export const consolidateLockPath = (home: string, slug: string) => join(memoryDir(home, slug), '.consolidate-lock');

const MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function readLock(path: string): ConsolidationLock | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ConsolidationLock>;
    if (typeof raw.lastConsolidatedAt !== 'string') return null;
    return { lastConsolidatedAt: raw.lastConsolidatedAt, ...(typeof raw.pid === 'number' ? { pid: raw.pid } : {}) };
  } catch {
    return null;
  }
}

export function writeLock(path: string, now = new Date()): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify({ lastConsolidatedAt: now.toISOString(), pid: process.pid }, null, 2) + '\n');
}

export function shouldConsolidate(home: string, slug: string, now = new Date(), minIntervalMs = MIN_INTERVAL_MS): boolean {
  const lock = readLock(consolidateLockPath(home, slug));
  if (!lock) return true;
  const last = Date.parse(lock.lastConsolidatedAt);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= minIntervalMs;
}

// Gather the project's session transcripts into one text block for the model to read: the newest writer sessions
// that fit in the cap, oldest of them first. A session another role wrote (triage, plan, a tab completion, a memory
// pass like this one) is not the owner's work and is left out, so a consolidation never reads its own sessions.
export function scanTranscripts(home: string, slug: string, cap = 40_000): { text: string; count: number } {
  const dir = join(home, 'sessions', slug);
  if (!existsSync(dir)) return { text: '', count: 0 };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map((x) => x.f);
  const chunks: string[] = [];
  let used = 0;
  let count = 0;
  for (const f of files) {
    let body = '';
    try {
      const raw = readFileSync(join(dir, f), 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const parts: string[] = [];
      let side = false;
      // What went wrong and what fixed it, read off the log's events, never off a tool's output (the repository's
      // and the web's words stay out of a pass that writes what every later session reads).
      const commands = new Map<string, string>();
      const failing = new Set<string>();
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as ScanEvent;
          if (e.kind === 'session' && e.role !== undefined && e.role !== 'code') {
            side = true;
            break;
          }
          if (e.kind === 'user' && typeof e.text === 'string') parts.push(`User: ${e.text}`);
          if (e.kind === 'reminder' && e.as === 'user' && typeof e.text === 'string') parts.push(`Reminder from cedia: ${clipText(e.text, 300)}`);
          if (e.kind === 'assistant' && Array.isArray(e.blocks)) {
            const t = e.blocks.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join(' ');
            if (t.trim()) parts.push(`Assistant: ${t}`);
            for (const b of e.blocks)
              if (b.type === 'tool_use' && b.name === 'bash' && typeof b.input?.command === 'string') commands.set(b.callId ?? b.id ?? '', clipText(redactSecrets(b.input.command).text, 200));
          }
          if (e.kind === 'permission' && e.decision === 'deny') parts.push(`Signal: a ${e.tool} call was denied (${clipText(e.reason ?? e.rule ?? '', 200)})`);
          if (e.kind === 'tool_result' && typeof e.callId === 'string' && commands.has(e.callId)) {
            const cmd = commands.get(e.callId)!;
            if (e.status === 'completed' && !e.output?.isError && (e.output?.exitCode ?? 0) === 0) {
              if (failing.delete(cmd)) parts.push(`Signal: \`${cmd}\` failed earlier in this session, then passed`);
            } else if (e.status === 'completed' || e.status === 'failed') failing.add(cmd);
          }
        } catch {
          // skip bad line
        }
      }
      for (const cmd of [...failing].slice(-5)) parts.push(`Signal: \`${cmd}\` failed and was not seen passing afterwards`);
      if (side) continue;
      body = parts.join('\n');
    } catch {
      continue;
    }
    if (!body.trim()) continue;
    const head = `--- session ${f} ---\n${body}\n`;
    if (used + head.length > cap) {
      // take what fits
      const room = cap - used;
      if (room > 100) chunks.push(head.slice(0, room));
      break;
    }
    chunks.push(head);
    used += head.length;
    count++;
  }
  return { text: chunks.reverse().join('\n'), count };
}

type ScanEvent = {
  kind?: string;
  role?: string;
  text?: string;
  as?: string;
  blocks?: { type: string; text?: string; name?: string; id?: string; callId?: string; input?: { command?: unknown } }[];
  tool?: string;
  decision?: string;
  reason?: string;
  rule?: string;
  callId?: string;
  status?: string;
  output?: { isError?: boolean; exitCode?: number };
};

const clipText = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

// What memory is for, more than rules for what to write: Anthropic's memory study found that telling a strong model
// what memory is for beats fixed rules for what to keep ("record only failures" cost Opus 5 0.234 of reward), and
// that one wrong note a later session trusts can sink its run, so this pass corrects as well as adds.
const SYSTEM = `You tend a software project's memory between sessions. Every later session of this project starts by reading these notes, so they should hold what such a session will need and cannot read off the code or the git history: how to build, test and run things here, decisions and their reasons, where things live, traps and what got past them. Progress on one task does not belong.

You get the current notes, each with its id, and the newest session transcripts. Lines that start with "Signal:" or "Reminder from cedia:" are what cedia saw: a command that failed and later passed, a call that was denied, a check the done gate asked for. A fix found the hard way is worth a note; most signals are not.

Keep the notes few and true:
- A note that the transcripts or the code show is wrong or out of date: revise it, or forget it.
- Two notes that say the same thing: revise one to hold both, then forget the other.
- Something new and durable: remember it, one fact per note, at most ${MAX_NOTE} characters.
Check a note against the code with read and grep before you change it on a hunch. Notes kept by the user are theirs: leave them. Make at most 10 changes in all. If nothing needs changing, change nothing.`;

export async function consolidateMemory(opts: {
  cwd: string;
  home?: string;
  model?: string;
  force?: boolean;
  auto?: boolean;
  now?: Date;
  signal?: AbortSignal;
}): Promise<ConsolidationResult> {
  const home = opts.home ?? cediaHome();
  // Time gate for automatic runs; explicit runs force.
  if (opts.auto && !opts.force && !shouldConsolidate(home, projectKey(opts.cwd), opts.now ?? new Date())) {
    const before = new MemoryStore(memoryPath(home, projectKey(opts.cwd))).notes().length;
    return { consolidated: false, skipped: 'too soon since last consolidation', notesBefore: before, notesAfter: before, added: 0, forgotten: 0, lockPath: consolidateLockPath(home, projectKey(opts.cwd)), sessionsScanned: 0 };
  }
  const r = await notesPass({ ...opts, home }, {
    role: 'consolidate',
    from: 'dream',
    system: SYSTEM,
    tend: true,
    prompt: (text, notes) =>
      `Tend this project's memory.\n\nThe current notes:\n\n<project_memory>\n${notes}\n</project_memory>\n\nThe recent session transcripts:\n\n${text}\n\nCorrect, merge or add notes with the forget, revise and remember tools.`,
    maxTurns: 16,
    model: () => loadRoles({}).code.ref,
    busy: 'consolidation already running or just finished',
  });
  const { ran, ...rest } = r;
  return { consolidated: ran, ...rest };
}

// One pass of a model over the project's recent transcripts, keeping what it finds with the remember tool:
// `cedia memory consolidate` and `cedia memory extract` differ only in what they ask, how long they may take and
// which model they default to. A pass held by another one under a minute old is skipped unless forced.
// A tending pass (consolidate) also sees the notes kept so far and may forget or revise them, and may read and grep
// the working tree to check one against the code; extract only adds.
export type NotesPassSpec = {
  role: 'consolidate' | 'extract';
  from: string;
  system: string;
  prompt: (transcripts: string, notes: string) => string;
  tend?: boolean;
  maxTurns: number;
  model: () => string;
  busy: string;
};
export type NotesPassResult = Omit<ConsolidationResult, 'consolidated'> & { ran: boolean };
export async function notesPass(
  opts: { cwd: string; home: string; model?: string; force?: boolean; now?: Date; signal?: AbortSignal },
  spec: NotesPassSpec,
): Promise<NotesPassResult> {
  const slug = projectKey(opts.cwd);
  const lockPath = consolidateLockPath(opts.home, slug);
  const store = new MemoryStore(memoryPath(opts.home, slug));
  const now = opts.now ?? new Date();
  const before = store.notes();
  const result = (ran: boolean, sessionsScanned: number, skipped?: string): NotesPassResult => {
    const after = store.notes();
    const kept = new Set(after.map((n) => n.id));
    const had = new Set(before.map((n) => n.id));
    return {
      ran,
      ...(skipped ? { skipped } : {}),
      notesBefore: before.length,
      notesAfter: after.length,
      added: after.filter((n) => !had.has(n.id)).length,
      forgotten: before.filter((n) => !kept.has(n.id)).length,
      lockPath,
      sessionsScanned,
    };
  };
  const existing = readLock(lockPath);
  if (!opts.force && existing) {
    const age = now.getTime() - Date.parse(existing.lastConsolidatedAt);
    if (age >= 0 && age < 60_000) return result(false, 0, spec.busy);
  }
  const scan = scanTranscripts(opts.home, slug);
  if (!scan.text.trim()) {
    writeLock(lockPath, now);
    return result(true, scan.count);
  }
  const model = resolveModel(opts.model ?? (fauxActive() ? 'faux' : spec.model()));
  const tools = spec.tend ? [rememberTool(store, spec.from), reviseTool(store, spec.from), forgetTool(store), readTool, grepTool] : [rememberTool(store, spec.from)];
  // The repository's own deny rules hold for the reads; the mode is workspace only so the note tools may write.
  const permission: Policy = spec.tend ? { ...loadPolicy(opts.cwd), mode: 'workspace' } : { mode: 'workspace', allow: [], deny: [] };
  // Logged like any session, so `cedia usage` counts what it cost; scanTranscripts leaves its role out.
  await runSide({
    cwd: opts.cwd,
    home: opts.home,
    model,
    role: spec.role,
    access: { kind: 'tools', tools, permission },
    system: spec.system,
    prompt: spec.prompt(scan.text, notesForPass(before)),
    maxTurns: spec.maxTurns,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  writeLock(lockPath, now);
  return result(true, scan.count);
}

// Dreaming: with `dream` on in user settings, a writer run that ends starts a tending pass in a process of its
// own, at most once a day and only when a writer session was written since the last pass. The run claims the
// day by writing the lock before it starts the pass, so runs ending together start one pass, and a pass that
// fails waits a day like one that ran.
export function dreamDue(home: string, slug: string, now = new Date()): boolean {
  if (!shouldConsolidate(home, slug, now)) return false;
  const lock = readLock(consolidateLockPath(home, slug));
  const since = lock ? Date.parse(lock.lastConsolidatedAt) : 0;
  const dir = join(home, 'sessions', slug);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => {
    if (!f.endsWith('.jsonl')) return false;
    try {
      const p = join(dir, f);
      if (statSync(p).mtimeMs <= since) return false;
      const first = readFileSync(p, 'utf8').split('\n', 1)[0] ?? '';
      return (JSON.parse(first) as { role?: string }).role === 'code';
    } catch {
      return false;
    }
  });
}

export type DreamSpawn = (argv: string[]) => void;
const spawnDetached: DreamSpawn = (argv) => {
  const proc = Bun.spawn(argv, { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached: true });
  proc.unref();
};

export function startDream(cwd: string, home: string, opts: { now?: Date; spawn?: DreamSpawn } = {}): boolean {
  const slug = projectKey(cwd);
  const now = opts.now ?? new Date();
  if (!dreamDue(home, slug, now)) return false;
  writeLock(consolidateLockPath(home, slug), now);
  (opts.spawn ?? spawnDetached)(selfSpawnArgs(['memory', 'consolidate', '--cwd', cwd]));
  return true;
}
