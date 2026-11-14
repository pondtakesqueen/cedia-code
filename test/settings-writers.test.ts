import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSettings } from '../src/core/config.ts';

// Every writer of settings.json reads it through the same check it writes with: one that cannot read the file
// refuses instead of replacing it, and none writes a file cedia would then refuse to start with.

const CLI = join(import.meta.dir, '..', 'src', 'cli.ts');
const run = (home: string, args: string[]) => Bun.spawnSync(['bun', CLI, ...args], { env: { ...process.env, CEDIA_HOME: home }, stdout: 'pipe', stderr: 'pipe' });

function home(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-sw-'));
  writeFileSync(join(dir, 'settings.json'), text);
  return dir;
}

describe('settings writers', () => {
  test('cedia output-style keeps a file it cannot read', () => {
    const dir = home('{ "todo": true, oops');
    const r = run(dir, ['output-style', 'terse']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr.toString()).toContain(join(dir, 'settings.json'));
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe('{ "todo": true, oops');
  });

  test('cedia output-style keeps the other keys', () => {
    const dir = home(JSON.stringify({ todo: true }));
    expect(run(dir, ['output-style', 'terse']).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ todo: true, outputStyle: 'terse' });
  });

  test('updateSettings refuses to write a setting cedia would refuse to read', () => {
    const dir = home(JSON.stringify({ todo: true }));
    expect(() => updateSettings((s) => ({ ...s, nope: 1 }) as never, dir)).toThrow('unknown setting "nope"');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ todo: true });
  });

  test('updateSettings creates the file and its folder', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cedia-sw-')), 'new-home');
    updateSettings((s) => ({ ...s, theme: 'light' }), dir);
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ theme: 'light' });
  });
});

describe('settings writers in several processes at once', () => {
  test('no change is lost when cedia processes add rules at the same time', async () => {
    const dir = home('{}');
    const script = join(import.meta.dir, '..', 'src', 'core', 'safety', 'suggest.ts');
    const procs = Array.from({ length: 6 }, (_, p) =>
      Bun.spawn(['bun', '-e', `const { applyAllowRules } = await import(${JSON.stringify(script)}); for (let i = 0; i < 15; i++) applyAllowRules(${JSON.stringify(dir)}, ['Bash(echo p${p}-' + i + ')']);`], { stdout: 'pipe', stderr: 'pipe' }),
    );
    for (const p of procs) expect(await p.exited).toBe(0);
    const allow = JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).permissions.allow as string[];
    expect(allow.length).toBe(90);
  }, 30_000);
});
