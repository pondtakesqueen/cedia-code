import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordStart } from '../src/core/background/background.ts';
import { pumpDaemon } from '../src/core/background/daemon.ts';
import { threadsDir, ThreadStore } from '../src/core/threads/threads.ts';
import { MAX_DEAD_STARTS, STALL_MS, watchThreads } from '../src/core/background/watchdog.ts';

const GONE = 2147483647;

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), 'cedia-watchdog-'));
  const slug = 'proj';
  const cwd = mkdtempSync(join(tmpdir(), 'cedia-watchdog-ws-'));
  const threads = new ThreadStore(threadsDir(home, slug));
  return { home, slug, cwd, threads };
};

// A thread the coordinator opened, with a run that started and never wrote its state.
const openRunning = (threads: ThreadStore, cwd: string, pid: number) => {
  const coordinator = threads.open('the project chat', { profile: 'coordinator' });
  const id = threads.open('fix login', { by: coordinator, title: 'Fix login' });
  threads.append(id, { kind: 'run', id: 'r-1', prompt: 'fix login', cwd, pid });
  return { coordinator, id };
};

describe('watchdog', () => {
  test('a run whose process is gone is marked failed, and its opener hears once', () => {
    const { threads, cwd } = setup();
    const { coordinator, id } = openRunning(threads, cwd, GONE);
    expect(threads.read(id)).toMatchObject({ state: 'working', running: true });
    const found = watchThreads(threads, { alive: () => false });
    expect(found).toEqual([{ kind: 'dead', thread: id, run: 'r-1', pid: GONE }]);
    const t = threads.read(id);
    expect(t).toMatchObject({ state: 'failed', running: false });
    expect(t.result).toContain(`pid ${GONE}`);
    const told = threads.read(coordinator).pending;
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ from: id });
    expect(told[0]!.text).toContain('Fix login');
    // Nothing is left to find on the next pass.
    expect(watchThreads(threads, { alive: () => false })).toEqual([]);
    expect(threads.read(coordinator).pending).toHaveLength(1);
  });

  test('a live run that has written nothing for a long time is reported once and left running', () => {
    const { threads, cwd } = setup();
    const { coordinator, id } = openRunning(threads, cwd, process.pid);
    expect(watchThreads(threads, { alive: () => true })).toEqual([]);
    const later = Date.now() + STALL_MS + 60_000;
    const found = watchThreads(threads, { alive: () => true, now: later });
    expect(found).toMatchObject([{ kind: 'stalled', thread: id, run: 'r-1' }]);
    expect(watchThreads(threads, { alive: () => true, now: later })).toHaveLength(1);
    expect(threads.read(coordinator).pending).toHaveLength(1);
    expect(threads.read(id)).toMatchObject({ state: 'working', running: true });
  });

  test('runs that ended, runs with no pid and archived threads are left alone', () => {
    const { threads, cwd } = setup();
    const done = threads.open('done');
    threads.append(done, { kind: 'run', id: 'r-1', prompt: 'x', cwd, pid: GONE });
    threads.append(done, { kind: 'state', state: 'done', result: 'ok' });
    const old = threads.open('before pids were recorded');
    threads.append(old, { kind: 'run', id: 'r-1', prompt: 'x', cwd });
    const archived = threads.open('archived');
    threads.append(archived, { kind: 'run', id: 'r-1', prompt: 'x', cwd, pid: GONE });
    threads.append(archived, { kind: 'archived', archived: true });
    expect(watchThreads(threads, { alive: () => false })).toEqual([]);
    expect(threads.read(done).state).toBe('done');
  });

  test('a thread nobody opened gets its state and no message', () => {
    const { threads, cwd } = setup();
    const id = threads.open('by hand');
    threads.append(id, { kind: 'run', id: 'r-1', prompt: 'x', cwd, pid: GONE });
    expect(watchThreads(threads, { alive: () => false })).toHaveLength(1);
    expect(threads.read(id).state).toBe('failed');
    expect(threads.list().flatMap((t) => t.messages)).toEqual([]);
  });
});

describe('watchdog in the daemon pass', () => {
  test('a dead run is marked before anything starts', async () => {
    const { home, slug, cwd, threads } = setup();
    const { id } = openRunning(threads, cwd, GONE);
    const spawned: string[][] = [];
    const tick = await pumpDaemon({ home, slug, cwd, maxRuns: 2, spawn: (argv) => (spawned.push(argv), process.pid), watchdog: { alive: () => false } });
    expect(tick.watchdog).toMatchObject([{ kind: 'dead', thread: id }]);
    expect(spawned).toEqual([]);
  });

  test(`a queued thread whose run died ${MAX_DEAD_STARTS} times before starting is no longer started`, async () => {
    const { home, slug, cwd, threads } = setup();
    const id = threads.open('job', { by: 'coordinator' });
    for (let i = 0; i < MAX_DEAD_STARTS; i++) recordStart(home, slug, { id: `bg-${i}`, thread: id, pid: GONE, logPath: '/tmp/x' });
    const spawned: string[][] = [];
    const deps = { home, slug, cwd, maxRuns: 2, spawn: (argv: string[]) => (spawned.push(argv), process.pid) };
    // The first pass reaps the dead runs; the watchdog then counts them.
    const tick = await pumpDaemon(deps);
    expect(tick.watchdog).toEqual([{ kind: 'start-failed', thread: id, tries: MAX_DEAD_STARTS }]);
    expect(tick.started).toEqual([]);
    expect(threads.read(id).state).toBe('failed');
    expect((await pumpDaemon(deps)).started).toEqual([]);
  });

  test(`fewer than ${MAX_DEAD_STARTS} dead starts still start the thread`, async () => {
    const { home, slug, cwd, threads } = setup();
    const id = threads.open('job', { by: 'coordinator' });
    recordStart(home, slug, { id: 'bg-0', thread: id, pid: GONE, logPath: '/tmp/x' });
    const tick = await pumpDaemon({ home, slug, cwd, maxRuns: 2, spawn: () => process.pid });
    expect(tick.watchdog).toEqual([]);
    expect(tick.started.map((s) => s.thread)).toEqual([id]);
  });
});
