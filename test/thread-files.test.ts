import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { threadFiles } from '../src/core/git/commit.ts';
import { ThreadStore } from '../src/core/threads/threads.ts';

// The CLI's commit and review and the TUI's /commit ask core which files a thread changed, so they refuse alike.
describe('threadFiles', () => {
  test('an unknown thread says so; a thread that changed nothing has no files', () => {
    const home = mkdtempSync(join(tmpdir(), 'cedia-tf-'));
    const store = new ThreadStore(join(home, 'threads'));
    expect(threadFiles(store, 'nope', home, home)).toEqual({ error: 'no thread nope in this project' });
    const t = store.open('a task');
    const r = threadFiles(store, t, mkdtempSync(join(tmpdir(), 'cedia-tf-cwd-')), home);
    expect(r).toEqual({ files: [] });
  });
});
