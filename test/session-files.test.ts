import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectKey } from '../src/core/session/log.ts';
import { selectSessions, sessionFiles } from '../src/core/session/select.ts';

// One session finder for usage, failures, permissions suggest and the TUI's usage tab.
describe('sessionFiles', () => {
  const home = mkdtempSync(join(tmpdir(), 'cedia-sf-'));
  const cwd = mkdtempSync(join(tmpdir(), 'cedia-sf-cwd-'));
  const here = join(home, 'sessions', projectKey(cwd));
  const there = join(home, 'sessions', 'other');
  mkdirSync(here, { recursive: true });
  mkdirSync(there, { recursive: true });
  const put = (dir: string, name: string, at: number) => {
    writeFileSync(join(dir, name), '');
    utimesSync(join(dir, name), at, at);
  };
  put(here, 'old.jsonl', 1_000);
  put(here, 'new.jsonl', 3_000);
  put(there, 'mid.jsonl', 2_000);

  test('newest first, this project only, at most `last`', () => {
    expect(sessionFiles({ cwd, home, last: 1 }).map((f) => f.path)).toEqual([join(here, 'new.jsonl')]);
    expect(sessionFiles({ cwd, home }).map((f) => f.path)).toEqual([join(here, 'new.jsonl'), join(here, 'old.jsonl')]);
  });
  test('all projects, and a since range', () => {
    expect(sessionFiles({ cwd, home, all: true }).map((f) => f.project)).toEqual([projectKey(cwd), 'other', projectKey(cwd)]);
    expect(sessionFiles({ cwd, home, all: true, since: new Date(2_000_000) }).map((f) => f.path)).toEqual([join(here, 'new.jsonl'), join(there, 'mid.jsonl')]);
  });
  test('an unknown thread throws to the CLI and reads as nothing elsewhere', () => {
    expect(() => sessionFiles({ cwd, home, thread: 'nope' })).toThrow();
    expect(selectSessions({ cwd, home, thread: 'nope' })).toEqual([]);
  });
});
