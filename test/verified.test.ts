import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampMessage, unverifiedCommits, unverifiedWarning, verification, verificationTrailers } from '../src/core/git/verified.ts';
import type { Evidence } from '../src/core/types.ts';

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const ev = (changed: string[], unverified: string[], checks: Evidence['checks'] = []): Evidence => ({ changed, unverified, checks });
const pass = { command: 'bun test', exitCode: 0, tail: '12 pass · 0 fail' };

test('a file is verified when the last run that changed it had a check pass after its last write', () => {
  const v = verification([ev(['a.ts', 'b.ts'], [], [pass])], ['a.ts', 'b.ts'], '/w');
  expect(v).toEqual({ checks: [pass], unverified: [] });
  expect(verificationTrailers(v)).toBe('Verified-by: bun test (exit 0, 12 pass · 0 fail)');
  expect(unverifiedWarning(v)).toBeUndefined();
});

test('a later run that changes a file decides it again, and a file no run recorded is unverified', () => {
  const receipts = [ev(['a.ts', 'b.ts'], [], [pass]), ev(['/w/b.ts'], ['/w/b.ts'], [{ command: 'bun test', exitCode: 1 }])];
  const v = verification(receipts, ['a.ts', 'b.ts', 'by-hand.ts'], '/w');
  expect(v.unverified).toEqual(['b.ts', 'by-hand.ts']);
  expect(verificationTrailers(v)).toBe('Verified-by: bun test (exit 0, 12 pass · 0 fail)\nUnverified: b.ts, by-hand.ts');
  expect(unverifiedWarning(v)).toContain('2 files changed with no passing check');
});

test('a run with no checks stamps none, and a message that already has a stamp keeps it', () => {
  const v = verification([ev(['a.ts'], ['a.ts'])], ['a.ts'], '/w');
  expect(stampMessage('Fix a\n\nWhy.\n', v)).toBe('Fix a\n\nWhy.\n\nVerified-by: none');
  expect(stampMessage('Fix a\n\nVerified-by: bun test (exit 0)', v)).toBe('Fix a\n\nVerified-by: bun test (exit 0)');
});

test("the branch's commits that say they hold unverified work are found by their stamp", () => {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-verified-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'Start');
  git(dir, 'switch', '-q', '-c', 'feature');
  const commit = (msg: string) => {
    writeFileSync(join(dir, `${Math.random()}.txt`), 'x');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', msg);
  };
  commit('Checked\n\nVerified-by: bun test (exit 0)');
  commit('Unchecked\n\nVerified-by: none');
  commit('Partly\n\nVerified-by: bun test (exit 0)\nUnverified: b.ts');
  commit('By hand, no stamp');
  expect(unverifiedCommits(dir, 'main..HEAD').map((l) => l.replace(/^\w+ /, ''))).toEqual(['Partly', 'Unchecked']);
});
