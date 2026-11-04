// The daemon's watchdog: what a pass can tell about a project's threads from their files and pids alone, with no
// model. A run whose process is gone left the thread `working` for good (nothing else writes its state), so every
// list, `read_thread` and the coordinator went on calling it working; a run that is alive but has written nothing
// for a long time may be stuck where the stuck guard cannot see it (a hung command, a provider that never answers);
// and a queued thread whose run dies before it starts was started again on every pass. Whether a live run is
// making progress toward its goal is the stuck guard's, the advisor's and the goal judge's to say, not this.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { isCediaProcess } from './busy.ts';
import type { Thread, ThreadStore } from './threads.ts';

export type WatchdogFinding =
  // The thread's last run never wrote its state and the process that ran it is gone: marked failed.
  | { kind: 'dead'; thread: string; run: string; pid: number }
  // The run's process is alive but neither the thread file nor its latest session log changed for `idleMs`.
  | { kind: 'stalled'; thread: string; run: string; pid: number; idleMs: number }
  // A queued thread whose run died before it started, `tries` times: marked failed, so no pass starts it again.
  | { kind: 'start-failed'; thread: string; tries: number };

export const STALL_MS = 20 * 60_000;
export const MAX_DEAD_STARTS = 3;

export type WatchdogOpts = {
  now?: number;
  stallMs?: number;
  // Whether a pid still runs cedia (pids are reused); tests pass their own.
  alive?: (pid: number) => boolean;
  // How many of the daemon's runs of a thread ended with their process gone (background.jsonl).
  deadStarts?: (thread: string) => number;
};

const mtime = (path: string | undefined): number => {
  if (!path) return 0;
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
};

// When the thread last showed a sign of life: its own file or its latest session's log.
export function lastWrite(store: ThreadStore, t: Thread): number {
  return Math.max(mtime(join(store.dir, `${t.id}.jsonl`)), mtime(t.sessions.at(-1)?.path));
}

// The opener hears about a finding once: a message from the thread that names the finding's key.
function tell(store: ThreadStore, t: Thread, key: string, text: string): void {
  if (!t.by || !store.has(t.by)) return;
  if (store.read(t.by).messages.some((m) => m.from === t.id && m.text.includes(key))) return;
  store.send(t.by, t.id, `${text} (${key})`);
}

export function watchThreads(store: ThreadStore, opts: WatchdogOpts = {}): WatchdogFinding[] {
  const now = opts.now ?? Date.now();
  const alive = opts.alive ?? isCediaProcess;
  const stallMs = opts.stallMs ?? STALL_MS;
  const found: WatchdogFinding[] = [];
  for (const t of store.list()) {
    if (t.archived) continue;
    const run = t.runs.at(-1);
    if (t.running && run?.pid) {
      if (!alive(run.pid)) {
        store.append(t.id, { kind: 'state', state: 'failed', result: `The run ended without a result: its process (pid ${run.pid}) is gone. Go on with the thread to pick it up.` });
        tell(store, t, `watchdog: run ${run.id} ended`, `Thread ${t.id} "${t.title}": its run ended without a result, since its process is gone. It is marked failed and can go on from where it stopped.`);
        found.push({ kind: 'dead', thread: t.id, run: run.id, pid: run.pid });
        continue;
      }
      const idleMs = now - lastWrite(store, t);
      if (idleMs >= stallMs) {
        tell(store, t, `watchdog: run ${run.id} idle`, `Thread ${t.id} "${t.title}": its run is alive but has written nothing for ${Math.round(idleMs / 60_000)} minutes. It may be stuck on a command or a request; it was left running.`);
        found.push({ kind: 'stalled', thread: t.id, run: run.id, pid: run.pid, idleMs });
      }
      continue;
    }
    if (t.state === 'queued' && opts.deadStarts) {
      const tries = opts.deadStarts(t.id);
      if (tries >= MAX_DEAD_STARTS) {
        store.append(t.id, { kind: 'state', state: 'failed', result: `Its run died before it started, ${tries} times; it is no longer started on its own.` });
        tell(store, t, 'watchdog: start failed', `Thread ${t.id} "${t.title}": its run died before it started, ${tries} times. It is marked failed and is no longer started on its own.`);
        found.push({ kind: 'start-failed', thread: t.id, tries });
      }
    }
  }
  return found;
}
