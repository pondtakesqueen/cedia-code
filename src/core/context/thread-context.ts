import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadHandoffAt } from '../config.ts';
import { resolveModel } from '../providers/catalog.ts';
import type { ThreadStore } from '../threads/threads.ts';
import { readEventsLenient } from '../session/usage.ts';
import { contextBreakdown, writerSessionOf, type ContextBreakdown } from './breakdown.ts';

// What fills a writer session now (`cedia context`, the TUI's /context): a session log named by path, else the
// writer session of the thread asked for, else of the newest thread here that has one.
export function threadContext(store: ThreadStore, cwd: string, home: string, which: { path?: string; thread?: string } = {}): ContextBreakdown {
  let found: { sessionId: string; path: string } | undefined;
  if (which.path) found = { sessionId: basename(which.path).replace(/\.jsonl$/, ''), path: which.path };
  else {
    const t = which.thread ? store.read(which.thread) : store.list().find((x) => !x.archived && !x.side && !x.parent && writerSessionOf(x, cwd, home));
    if (!t) throw new Error('no thread with a session in this project');
    found = writerSessionOf(t, cwd, home);
    if (!found) throw new Error(`thread ${t.id} has no writer session yet`);
  }
  if (!existsSync(found.path)) throw new Error(`no session log at ${found.path}`);
  const events = readEventsLenient(readFileSync(found.path, 'utf8'));
  if (events[0]?.kind !== 'session') throw new Error(`${found.path} does not start with a session event`);
  // A model this build no longer knows still has a breakdown, without the handoff mark.
  let handoffAt: number | undefined;
  try {
    handoffAt = loadHandoffAt(resolveModel(events[0].model));
  } catch {}
  return contextBreakdown(events, { sessionId: found.sessionId, ...(handoffAt ? { handoffAt } : {}) });
}
