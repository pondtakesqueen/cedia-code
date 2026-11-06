// Session selection for read-only commands over past logs (`cedia usage`, `cedia failures`, `cedia permissions
// suggest`, the TUI's usage tab): explicit files, one thread (with its sub-threads), or the newest sessions of this
// project (of every project with `all`), the ones written since `since` when it is given, else the newest `last`.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ThreadStore, threadsDir } from '../threads/threads.ts';
import { projectKey, sessionPath } from './log.ts';
import { readEventsLenient, dayOf, usageReport, type SessionInput } from './usage.ts';

export type SessionFile = { path: string; project?: string };
export type SessionQuery = { cwd: string; home: string; files?: string[]; thread?: string; since?: Date; last?: number; all?: boolean };

// The log files a query names, newest first where it picks them. An unknown thread throws.
export function sessionFiles(q: SessionQuery): SessionFile[] {
  if (q.files?.length) return q.files.map((path) => ({ path }));
  if (q.thread) {
    const project = projectKey(q.cwd);
    const store = new ThreadStore(threadsDir(q.home, project));
    const all = store.list();
    const ids = [q.thread];
    for (let i = 0; i < ids.length; i++) ids.push(...all.filter((t) => t.parent === ids[i]).map((t) => t.id));
    return ids.flatMap((id) => store.read(id).sessions.map((s) => ({ path: s.path ?? sessionPath(q.cwd, s.sessionId, q.home), project })));
  }
  const root = join(q.home, 'sessions');
  const keys = q.all ? (existsSync(root) ? readdirSync(root) : []) : [projectKey(q.cwd)];
  const found = keys.flatMap((project) => {
    const dir = join(root, project);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ path: join(dir, f), project, mtime: statSync(join(dir, f)).mtimeMs }));
  });
  found.sort((a, b) => b.mtime - a.mtime);
  const picked = q.since ? found.filter((f) => f.mtime >= q.since!.getTime()) : found.slice(0, q.last ?? 20);
  return picked.map(({ path, project }) => ({ path, project }));
}

export const sessionId = (path: string) => basename(path).replace(/\.jsonl$/, '');

// The sessions a query names, read; a file that is gone is skipped, and so is an unknown thread.
export function selectSessions(q: SessionQuery): SessionInput[] {
  let files: SessionFile[];
  try {
    files = sessionFiles(q);
  } catch {
    return [];
  }
  return files.filter((f) => existsSync(f.path)).map((f) => ({ id: sessionId(f.path), events: readEventsLenient(readFileSync(f.path, 'utf8')) }));
}

// Spend in this project today (local day), read from its session logs: the live half of the $20/day rule
// (SPEC Spend). Never throws: unreadable logs count as nothing spent.
export const DAILY_SPEND_WARN_USD = 20;

export function daySpendUsd(home: string, cwd: string, now = new Date()): number {
  try {
    const r = usageReport(selectSessions({ cwd, home, last: 50 }));
    return r.days.find((d) => d.day === dayOf(now))?.costUsd ?? 0;
  } catch {
    return 0;
  }
}
