// The policy judges the file a tool opens: a path is read the same way by both, `~` included. Before, the policy
// expanded `~/` to the home directory while the tools read `~` as a folder under the working directory, so
// `~/../../<store>` was judged as a path above home and opened the store. Security audit 2026-11-06, finding 3.
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { decide } from '../src/core/safety/policy.ts';
import { readTool } from '../src/core/tools/read.ts';
import { toolPath } from '../src/core/tools/registry.ts';

test('toolPath reads ~ as the home directory and a relative path from the working directory', () => {
  expect(toolPath('~/x/y', '/w')).toBe(join(homedir(), 'x/y'));
  expect(toolPath('~', '/w')).toBe(homedir());
  expect(toolPath('a/~/b', '/w')).toBe('/w/a/~/b');
  expect(toolPath('/abs', '/w')).toBe('/abs');
});

test('a ~/.. path cannot reach a credential store the policy did not judge', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cedia-tilde-'));
  const cwd = join(root, 'a', 'b');
  const store = join(root, 'a', 's');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(store);
  writeFileSync(join(store, 'f'), 'STORE_VALUE\n');
  const policy = { mode: 'read-only' as const, allow: [], deny: [], secrets: [store] };
  // Under the old literal reading, cwd/~/../.. is root/a, so this named the store's file.
  const path = '~/../../s/f';
  const d = decide(policy, readTool, { path }, cwd);
  const out = await readTool.run({ path }, { cwd, signal: new AbortController().signal } as never);
  // Whatever the decision, the file the tool opens is the one the policy judged: never the store.
  expect(d.decision === 'deny' || !String((out as { text: string }).text).includes('STORE_VALUE')).toBe(true);
  expect(String((out as { text: string }).text)).not.toContain('STORE_VALUE');
  // And the store named directly stays denied.
  expect(decide(policy, readTool, { path: relative(cwd, join(store, 'f')) }, cwd).rule).toBe('deny-list:secret-path');
});
