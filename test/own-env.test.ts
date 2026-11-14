import { afterEach, beforeEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commitFiles, pushAndOpenPr } from '../src/core/git/commit.ts';
import { ownEnv } from '../src/core/own-env.ts';

// A repository's hooks, a credential helper or a filter run under the git commands cedia runs itself (/commit,
// /pr, the status line), and gh runs for /pr: none of them may find the keys cedia calls its models with.
// Claude Code 2.1.323 made the same change for its own git and ripgrep.
const KEYS = { ANTHROPIC_API_KEY: 'sk-ant-test-key', OPENROUTER_API_KEY: 'sk-or-test-key', CEDIA_ANTHROPIC_API_KEY: 'sk-ant-alt-key', ANTHROPIC_AUTH_TOKEN: 'tok-test' };
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const [k, v] of Object.entries(KEYS)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterEach(() => {
  for (const k of Object.keys(KEYS)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });
function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-own-env-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'user.email', 't@t');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'start');
  return dir;
}
// A script that writes its environment to `out`.
function dumper(path: string, out: string): string {
  writeFileSync(path, `#!/bin/sh\nenv > '${out}'\nexit 0\n`);
  chmodSync(path, 0o755);
  return path;
}
// The names of the keys that reached the script, never their values or the rest of the environment.
const leaked = (file: string) => Object.entries(KEYS).filter(([, v]) => readFileSync(file, 'utf8').includes(v)).map(([k]) => k);

test('the keys are left out and the rest of the environment is kept', () => {
  const env = ownEnv({ ...KEYS, DEEPSEEK_API_KEY: 'd', OPENCODE_API_KEY: 'o', GH_TOKEN: 'gh', PATH: '/bin', HOME: '/h', CEDIA_GH_BIN: 'gh' });
  expect(env).toEqual({ GH_TOKEN: 'gh', PATH: '/bin', HOME: '/h', CEDIA_GH_BIN: 'gh' });
});

test("a repository's pre-commit hook under /commit does not see the model keys", () => {
  const dir = repo();
  const out = join(dir, '..', `${dir.split('/').pop()}-env`);
  dumper(join(dir, '.git', 'hooks', 'pre-commit'), out);
  writeFileSync(join(dir, 'a.txt'), 'b\n');
  expect(commitFiles(dir, ['a.txt'], 'Change a').ok).toBe(true);
  expect(existsSync(out)).toBe(true);
  expect(leaked(out)).toEqual([]);
});

test("/pr's pre-push hook and gh do not see the model keys; gh keeps its own token", async () => {
  const remote = mkdtempSync(join(tmpdir(), 'cedia-own-env-remote-'));
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  const dir = repo();
  git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'push', '-q', 'origin', 'main');
  git(dir, 'switch', '-q', '-c', 'work');
  writeFileSync(join(dir, 'a.txt'), 'c\n');
  git(dir, 'commit', '-qam', 'Change a');
  const hookOut = join(remote, 'hook-env');
  const ghOut = join(remote, 'gh-env');
  dumper(join(dir, '.git', 'hooks', 'pre-push'), hookOut);
  const gh = dumper(join(remote, 'gh'), ghOut);
  const ghToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = 'gh-own-token';
  try {
    const r = await pushAndOpenPr(dir, gh);
    expect(r.ok).toBe(true);
  } finally {
    if (ghToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = ghToken;
  }
  expect(leaked(hookOut)).toEqual([]);
  expect(leaked(ghOut)).toEqual([]);
  // Compared as a flag, so a failure does not print the whole environment.
  expect(readFileSync(ghOut, 'utf8').split('\n').includes('GH_TOKEN=gh-own-token')).toBe(true);
});
