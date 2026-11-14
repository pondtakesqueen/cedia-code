import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAlive } from './background.ts';
import type { Thread, ThreadStore } from '../threads/threads.ts';

// One run of a thread at a time. A thread can be driven from the TUI, the desktop, the daemon and `cedia -p
// --thread`, and its writer session's log takes one writer: two runs resuming the same session would both append
// to it. So a run that goes on with a thread whose last run has not ended asks the process that holds it first.
// The holder is the pid its `run` event names (absent before cedia recorded it, and then nothing is known to hold
// it). A pid that is gone, or that is now some other program (pids are reused), holds nothing: the run was killed
// and the thread is free. The same process holds nothing against itself (the TUI runs its turns one after another
// in one process).

export type Holder = { pid: number; run: string };

// The live process that holds the thread's last run, if one does.
export function holderOf(t: Thread, self = process.pid, alive: (pid: number) => boolean = isCediaProcess): Holder | undefined {
  if (!t.running) return undefined;
  const last = t.runs.at(-1);
  if (!last?.pid || last.pid === self || !alive(last.pid)) return undefined;
  return { pid: last.pid, run: last.id };
}

// A process that is alive and runs cedia (bin/cedia, or bun running it), so a reused pid is never taken for a run.
export function isCediaProcess(pid: number): boolean {
  if (!isAlive(pid)) return false;
  const ps = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  if (ps.status !== 0) return false;
  return /cedia|\bbun\b/.test(ps.stdout);
}

// The run event that names the holder is written well after the claim (the run's setup comes first), so two
// processes that claim one thread in that window would both pass. A claim file closes it: created exclusively
// (`wx`) beside the thread, it names the claiming process until that process writes its run event and releases it.
// One whose process is gone, or older than CLAIM_STALE_MS (a run that failed in its setup inside a long-lived TUI),
// claims nothing.
export const CLAIM_STALE_MS = 2 * 60_000;
type ClaimFile = { pid: number; at: number };
const claimPath = (store: ThreadStore, id: string) => join(store.dir, `${id}.claim`);

function readClaim(path: string): ClaimFile | undefined {
  try {
    const c = JSON.parse(readFileSync(path, 'utf8')) as ClaimFile;
    return typeof c.pid === 'number' && typeof c.at === 'number' ? c : undefined;
  } catch {
    return undefined;
  }
}

// Takes the claim file for `self`, or names the live process that holds it.
function takeClaim(store: ThreadStore, id: string, self: number, alive: (pid: number) => boolean, now: number): { held?: number } {
  const path = claimPath(store, id);
  for (let i = 0; i < 3; i++) {
    try {
      writeFileSync(path, JSON.stringify({ pid: self, at: now }), { flag: 'wx' });
      return {};
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const c = readClaim(path);
    if (c && c.pid !== self && now - c.at < CLAIM_STALE_MS && alive(c.pid)) return { held: c.pid };
    // Ours, stale, unreadable or its process is gone: take it over.
    rmSync(path, { force: true });
  }
  return {};
}

// Ends the claim once the run event names its holder. Only the process that holds it removes it.
export function releaseClaim(store: ThreadStore, id: string, self = process.pid): void {
  const path = claimPath(store, id);
  if (readClaim(path)?.pid === self) rmSync(path, { force: true });
}

export type Claim = { ok: true; tookOver?: Holder } | { ok: false; error: string };

// Makes the thread free for a new run. Without `takeOver`, a held thread is refused. With it, the holder is sent
// SIGTERM, which ends its run as `stopped` the way Ctrl-C does, and this waits until that run wrote its state or the
// process is gone. One that does neither in `waitMs` keeps the thread: the run is refused rather than share the log.
export async function claimThread(store: ThreadStore, id: string, opts: { takeOver?: boolean; waitMs?: number; self?: number; alive?: (pid: number) => boolean; kill?: (pid: number) => void; now?: number } = {}): Promise<Claim> {
  const alive = opts.alive ?? isCediaProcess;
  const self = opts.self ?? process.pid;
  const claiming = takeClaim(store, id, self, alive, opts.now ?? Date.now()).held;
  if (claiming !== undefined) return { ok: false, error: `thread ${id} is starting a run in another cedia (pid ${claiming}). Wait for it, or send it a message with \`cedia threads send\`` };
  const holder = holderOf(store.read(id), opts.self, alive);
  if (!holder) return { ok: true };
  if (!opts.takeOver) {
    releaseClaim(store, id, self);
    return { ok: false, error: `thread ${id} is working: run ${holder.run} (pid ${holder.pid}) has not ended. Wait for it, send it a message with \`cedia threads send\`, or pass --take-over to stop it and go on` };
  }
  try {
    (opts.kill ?? ((pid) => process.kill(pid, 'SIGTERM')))(holder.pid);
  } catch {}
  const until = Date.now() + (opts.waitMs ?? 15_000);
  while (Date.now() < until) {
    if (!holderOf(store.read(id), opts.self, alive)) return { ok: true, tookOver: holder };
    await Bun.sleep(100);
  }
  releaseClaim(store, id, self);
  return { ok: false, error: `thread ${id}: run ${holder.run} (pid ${holder.pid}) did not stop within ${Math.round((opts.waitMs ?? 15_000) / 1000)}s` };
}
