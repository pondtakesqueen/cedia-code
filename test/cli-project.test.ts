// --project <key> files threads under one workspace key. It is a global option: every command takes it, and it
// reaches the code that keys threads (projectKey) as an argument the CLI read, not as a parse error.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cli = (...args: string[]) => spawnSync('bun', ['src/cli.ts', ...args], { encoding: 'utf8', env: { ...process.env, CEDIA_HOME: mkdtempSync(join(tmpdir(), 'cedia-home-')), CEDIA_PROJECT: '' } });

test('threads list --project <key> runs instead of failing on an unknown option', () => {
  for (const args of [['threads', 'list', '--project', 'ws1', '--json'], ['--project', 'ws1', 'threads', 'list', '--json'], ['threads', 'list', '--project=ws1', '--json']]) {
    const r = cli(...args);
    expect([args.join(' '), r.status, r.stderr.includes('Unknown option')]).toEqual([args.join(' '), 0, false]);
  }
});

test('--project with no key is a usage error, not a crash', () => {
  const r = cli('threads', 'list', '--project');
  expect(r.status).toBe(2);
  expect(r.stderr).toContain('--project');
});
