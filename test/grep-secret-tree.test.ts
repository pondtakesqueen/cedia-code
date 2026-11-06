// grep reads a whole tree, so a credential store under the searched directory is as off limits as the store
// itself, and cedia's own secret-file exclusions win over the model's glob. Security audit 2026-11-06, finding 4.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide } from '../src/core/safety/policy.ts';
import { grepTool } from '../src/core/tools/grep.ts';

const root = mkdtempSync(join(tmpdir(), 'cedia-grep-tree-'));
const cwd = join(root, 'work', 'repo');
const store = join(root, '.kube');
mkdirSync(cwd, { recursive: true });
mkdirSync(store);
writeFileSync(join(store, 'config'), 'client-key-data: STORE_VALUE\n');
const policy = { mode: 'read-only' as const, allow: [], deny: [], secrets: [store] };

test('grep over a directory that holds a credential store is denied; a narrower path is not', () => {
  for (const path of [root, '../..', join(root, 'work', '..')]) expect([path, decide(policy, grepTool, { pattern: 'x', path }, cwd).rule]).toEqual([path, 'deny-list:secret-path']);
  expect(decide(policy, grepTool, { pattern: 'x', path: store }, cwd).rule).toBe('deny-list:secret-path');
  expect(decide(policy, grepTool, { pattern: 'x' }, cwd).decision).toBe('allow');
  expect(decide(policy, grepTool, { pattern: 'x', path: join(root, 'work') }, cwd).decision).toBe('allow');
});

test('a model glob cannot bring back files named like credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-grep-glob-'));
  mkdirSync(join(dir, '.aws'));
  writeFileSync(join(dir, '.env'), 'TOKEN=DOTENV_VALUE\n');
  writeFileSync(join(dir, '.aws', 'credentials'), 'CRED_VALUE\n');
  writeFileSync(join(dir, 'a.txt'), 'PLAIN_VALUE\n');
  for (const glob of ['*', '.env', 'credentials']) {
    const out = await grepTool.run({ pattern: '_VALUE', glob }, { cwd: dir, signal: new AbortController().signal } as never);
    const text = String((out as { text: string }).text);
    expect([glob, text.includes('DOTENV_VALUE') || text.includes('CRED_VALUE')]).toEqual([glob, false]);
  }
});
