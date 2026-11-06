import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every command answers a bad flag the same way: one line on stderr and exit 2, never a stack trace.
const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
const run = (args: string[]) => {
  const p = Bun.spawnSync(['bun', CLI, ...args], { env: { ...process.env, CEDIA_HOME: mkdtempSync(join(tmpdir(), 'cedia-ce-')) }, stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode, err: p.stderr.toString() };
};

describe('cli errors', () => {
  for (const cmd of ['usage', 'failures', 'context', 'threads', 'skills', 'doctor']) {
    test(`${cmd} --bogus is a usage error`, () => {
      const r = run([cmd, '--bogus']);
      expect(r.code).toBe(2);
      expect(r.err.trim().split('\n')).toHaveLength(1);
      expect(r.err).toStartWith("cedia: Unknown option '--bogus'");
    });
  }

  test('a failure inside a command is one line, not a stack trace', () => {
    const r = run(['lint-session', join(tmpdir(), 'no-such-session.jsonl')]);
    expect(r.code).toBe(1);
    expect(r.err).toStartWith('cedia: ');
    expect(r.err.trim().split('\n')).toHaveLength(1);
  });
});

describe('the subcommand table', () => {
  test('docs/CLI.md and the usage text name every subcommand', async () => {
    const { readFileSync } = await import('node:fs');
    const { subcommands } = await import('../src/cli.ts');
    const docs = readFileSync(join(import.meta.dir, '..', 'docs', 'CLI.md'), 'utf8');
    const src = readFileSync(join(import.meta.dir, '..', 'src', 'cli.ts'), 'utf8');
    const usage = src.slice(src.indexOf('const USAGE'), src.indexOf('`;', src.indexOf('const USAGE')));
    // magic-docs is the old name of living-docs, kept quietly.
    const names = Object.keys(subcommands()).filter((n) => n !== 'magic-docs');
    expect(names.filter((n) => !docs.includes(`cedia ${n}`))).toEqual([]);
    expect(names.filter((n) => !usage.includes(`cedia ${n}`))).toEqual([]);
  });
});
