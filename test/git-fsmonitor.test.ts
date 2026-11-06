import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitStatus, workingDiff } from '../src/core/git/git.ts';

// A repository's own config can name a program for git to run (core.fsmonitor). cedia reads a repository it was
// pointed at, maybe one just cloned, so its own git calls (the status line, /diff) must not
// run it. All of them go through core/git/run.ts.
test("cedia's git calls do not run a program the repository's config names", () => {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-fsmonitor-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
  const marker = join(dir, 'RAN');
  const hook = join(dir, '.git', 'fsmonitor.sh');
  writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`);
  chmodSync(hook, 0o755);
  git('config', 'core.fsmonitor', hook);
  // The hook runs for plain git: the test means something.
  git('status', '--porcelain');
  expect(existsSync(marker)).toBe(true);
  spawnSync('rm', ['-f', marker]);

  writeFileSync(join(dir, 'a.txt'), 'b\n');
  expect(gitStatus(dir)?.dirty).toBe(1);
  expect(workingDiff(dir)?.patch).toContain('+b');
  expect(existsSync(marker)).toBe(false);
});
