import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { denyListed } from '../src/core/safety/policy.ts';
import { simpleCommands } from '../src/core/safety/shell.ts';

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

// A repository on `work` with `main` two commits back, a tag, and a sub-folder.
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-branch-move-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'user.email', 't@t');
  for (const m of ['a', 'b', 'c']) git(dir, 'commit', '-q', '--allow-empty', '-m', m);
  git(dir, 'tag', 'v1');
  git(dir, 'switch', '-q', '-c', 'work');
  mkdirSync(join(dir, 'sub'));
  return dir;
}

const hit = (dir: string, command: string) => simpleCommands(command)!.map((argv) => denyListed(argv, dir)?.name).find(Boolean);

test('commands that point an existing branch or tag elsewhere are refused', () => {
  const dir = repo();
  for (const c of [
    'git branch -f main HEAD~2',
    'git branch --force main HEAD~1',
    'git branch -M work main',
    'git branch -C work main',
    'git branch -m -f work main',
    'git checkout -B main HEAD~2',
    'git switch -C main HEAD~1',
    'git switch --force-create=main HEAD~1',
    'git update-ref refs/heads/main HEAD~2',
    'git update-ref refs/tags/v1 HEAD~1',
    'git update-ref --stdin',
    'git -C sub branch -f main HEAD~2',
  ])
    expect([c, hit(dir, c)]).toEqual([c, 'drop-refs']);
});

test('creating a new branch, or re-creating the current one where it is, is left alone', () => {
  const dir = repo();
  for (const c of [
    'git branch -f fresh HEAD~1',
    'git branch fresh',
    'git checkout -B fresh',
    'git switch -C fresh origin/x',
    'git checkout -B work',
    'git branch -m work renamed',
    'git update-ref refs/heads/fresh HEAD',
    'git update-ref HEAD HEAD',
    'git checkout -b another',
  ])
    expect([c, hit(dir, c)]).toEqual([c, undefined]);
});

test('outside a repository nothing exists, so nothing is held', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-branch-move-none-'));
  expect(hit(dir, 'git branch -f main HEAD~2')).toBeUndefined();
});
