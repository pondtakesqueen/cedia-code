import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cediaHome } from '../config.ts';
import { loadRoles } from '../config.ts';
import { projectKey } from '../session/log.ts';
import { resolveModel } from '../providers/catalog.ts';
import { runSide } from '../loop/side.ts';
import { memoryPath, MemoryStore, rememberTool, MAX_NOTE } from './memory.ts';
import { fauxActive } from '../providers/faux.ts';

// Memory consolidation: between sessions, scan a project's session transcripts
// and let a model keep the durable facts as project memory notes. Runs only when asked
// (`cedia memory consolidate`) or, with consolidateMemory on, between sessions. Never mid-session.

export type ConsolidationLock = { lastConsolidatedAt: string; pid?: number };
export type ConsolidationResult = {
  consolidated: boolean;
  skipped?: string;
  notesBefore: number;
  notesAfter: number;
  added: number;
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
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as { kind?: string; role?: string; text?: string; blocks?: { type: string; text?: string }[] };
          if (e.kind === 'session' && e.role !== undefined && e.role !== 'code') {
            side = true;
            break;
          }
          if (e.kind === 'user' && typeof e.text === 'string') parts.push(`User: ${e.text}`);
          if (e.kind === 'assistant' && Array.isArray(e.blocks)) {
            const t = e.blocks.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join(' ');
            if (t.trim()) parts.push(`Assistant: ${t}`);
          }
        } catch {
          // skip bad line
        }
      }
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

const SYSTEM = `You are consolidating a project's memory. Read the session transcripts and keep durable facts as memory notes for later sessions: a command that works, a decision and its reason, where something lives, a trap you hit. Not progress on a task and not anything the code or git history already says. Each note at most ${MAX_NOTE} characters, one fact per call. Call the remember tool once per fact you decide to keep; call it no more than 10 times. If nothing durable is worth keeping, call nothing.`;

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
    return { consolidated: false, skipped: 'too soon since last consolidation', notesBefore: before, notesAfter: before, added: 0, lockPath: consolidateLockPath(home, projectKey(opts.cwd)), sessionsScanned: 0 };
  }
  const r = await notesPass({ ...opts, home }, {
    role: 'consolidate',
    from: 'dream',
    system: SYSTEM,
    prompt: (text) => `Consolidate memory for this project. Here are the recent session transcripts:\n\n${text}\n\nKeep the durable facts with the remember tool.`,
    maxTurns: 8,
    model: () => loadRoles({}).code.ref,
    busy: 'consolidation already running or just finished',
  });
  const { ran, ...rest } = r;
  return { consolidated: ran, ...rest };
}

// One pass of a model over the project's recent transcripts, keeping what it finds with the remember tool:
// `cedia memory consolidate` and `cedia memory extract` differ only in what they ask, how long they may take and
// which model they default to. A pass held by another one under a minute old is skipped unless forced.
export type NotesPassSpec = {
  role: 'consolidate' | 'extract';
  from: string;
  system: string;
  prompt: (transcripts: string) => string;
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
  const before = store.notes().length;
  const existing = readLock(lockPath);
  if (!opts.force && existing) {
    const age = now.getTime() - Date.parse(existing.lastConsolidatedAt);
    if (age >= 0 && age < 60_000) return { ran: false, skipped: spec.busy, notesBefore: before, notesAfter: before, added: 0, lockPath, sessionsScanned: 0 };
  }
  const scan = scanTranscripts(opts.home, slug);
  if (!scan.text.trim()) {
    writeLock(lockPath, now);
    return { ran: true, notesBefore: before, notesAfter: before, added: 0, lockPath, sessionsScanned: scan.count };
  }
  const model = resolveModel(opts.model ?? (fauxActive() ? 'faux' : spec.model()));
  // Logged like any session, so `cedia usage` counts what it cost; scanTranscripts leaves its role out.
  await runSide({
    cwd: opts.cwd,
    home: opts.home,
    model,
    role: spec.role,
    access: { kind: 'tools', tools: [rememberTool(store, spec.from)], permission: { mode: 'workspace', allow: [], deny: [] } },
    system: spec.system,
    prompt: spec.prompt(scan.text),
    maxTurns: spec.maxTurns,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  writeLock(lockPath, now);
  const after = store.notes().length;
  return { ran: true, notesBefore: before, notesAfter: after, added: after - before, lockPath, sessionsScanned: scan.count };
}
