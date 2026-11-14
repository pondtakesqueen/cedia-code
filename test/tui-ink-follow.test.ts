import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ThreadStore } from '../src/core/threads/threads.ts';
import { followLines, markOf } from '../src/clients/tui-ink/follow.ts';

// The TUI follows the thread it has open while another cedia (the desktop, the daemon, `cedia -p --thread`) runs it.

function store() {
  const s = new ThreadStore(mkdtempSync(join(tmpdir(), 'cedia-follow-')));
  return { s, id: s.open('task') };
}

describe('following the open thread', () => {
  test('a run another process starts and ends is told, with its result', () => {
    const { s, id } = store();
    let mark = markOf(s.read(id));
    s.append(id, { kind: 'run', id: 'r-1', prompt: 'fix the login bug\nmore', cwd: '/', pid: 777 });
    let out = followLines(s.read(id), mark, 1);
    expect(out.lines).toEqual(['another cedia (pid 777) started a run of this thread: fix the login bug']);
    mark = out.mark;
    expect(followLines(s.read(id), mark, 1).lines).toEqual([]);
    s.append(id, { run: 'r-1', kind: 'state', state: 'done', result: 'Fixed it in src/login.ts\nand more' });
    out = followLines(s.read(id), mark, 1);
    expect(out.lines).toEqual(['that run is done: Fixed it in src/login.ts']);
  });

  test('this process\'s own runs are not told', () => {
    const { s, id } = store();
    const mark = markOf(s.read(id));
    s.append(id, { kind: 'run', id: 'r-1', prompt: 'p', cwd: '/', pid: 1 });
    s.append(id, { run: 'r-1', kind: 'state', state: 'done', result: 'ok' });
    expect(followLines(s.read(id), mark, 1).lines).toEqual([]);
  });

  test('a run that started and ended between two looks is told once, ended', () => {
    const { s, id } = store();
    const mark = markOf(s.read(id));
    s.append(id, { kind: 'run', id: 'r-1', prompt: 'p', cwd: '/', pid: 777 });
    s.append(id, { run: 'r-1', kind: 'state', state: 'failed' });
    expect(followLines(s.read(id), mark, 1).lines).toEqual(['another cedia (pid 777) ran this thread: p', 'that run failed']);
  });
});
