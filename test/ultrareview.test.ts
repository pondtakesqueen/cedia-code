import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = join(import.meta.dir, '..', 'bin', 'cedia');
const reply = (text: string) => ({ blocks: [{ type: 'text', text }] });
const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function repo(): { dir: string; home: string; run: (script: unknown[], args: string[]) => { code: number | null; out: string; err: string } } {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-ultrareview-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'user.email', 't@t');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Start');
  const home = join(dir, '.git', 'cedia-home');
  const run = (script: unknown[], args: string[]) => {
    const scriptPath = join(dir, '.git', `script-${Math.random()}.json`);
    writeFileSync(scriptPath, JSON.stringify(script));
    const p = Bun.spawnSync([BIN, 'ultrareview', ...args, '--cwd', dir], { env: { ...process.env, CEDIA_FAUX_SCRIPT: scriptPath, CEDIA_HOME: home }, stdin: 'ignore' });
    return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
  };
  return { dir, home, run };
}

test('cedia ultrareview with nothing changed says so and runs no pass', () => {
  const { run } = repo();
  const r = run([], ['--model', 'faux', '--json']);
  expect(r.code).toBe(1);
  expect(r.err).toContain('no changes to review');
});

test('cedia ultrareview runs each focus in a session of its own and files every finding under its focus', () => {
  const { dir, home, run } = repo();
  writeFileSync(join(dir, 'base.txt'), 'base\nmore\n');
  writeFileSync(join(dir, 'new.txt'), 'new\n');
  const r = run([reply('Read the change.\nFINDING: base.txt:2 adds a line nobody asked for\nVERDICT: changes')], ['--model', 'faux', '--json']);
  expect(r.code).toBe(0);
  const out = JSON.parse(r.out);
  expect(out).toMatchObject({ model: 'faux/scripted', subject: 'the uncommitted changes', failed: [] });
  expect(out.findings.map((f: { focus: string }) => f.focus)).toEqual(['correctness', 'security', 'tests', 'perf-readability']);
  expect(out.findings[0]).toMatchObject({ path: 'base.txt', line: 2, text: 'base.txt:2 adds a line nobody asked for' });

  // A log per pass: each holds its own focus and no other pass's prompt.
  const sessions = join(home, 'sessions');
  const logs = readdirSync(sessions).flatMap((k) => readdirSync(join(sessions, k)).map((f) => readFileSync(join(sessions, k, f), 'utf8')));
  expect(logs).toHaveLength(4);
  for (const log of logs) {
    expect(log.match(/SPECIAL FOCUS/g)).toHaveLength(1);
    // The untracked file is named to the reviewer, since the diff against HEAD leaves it out.
    expect(log).toContain('new.txt');
  }
});

test('cedia ultrareview drops a finding on a file the change does not touch, as /code-review does', () => {
  const { dir, run } = repo();
  writeFileSync(join(dir, 'base.txt'), 'base\nmore\n');
  writeFileSync(join(dir, 'new.txt'), 'new\n');
  const r = run([reply('FINDING: base.txt:2 kept\nFINDING: new.txt:1 kept, the file is new\nFINDING: elsewhere.ts:9 not part of the change\nVERDICT: changes')], ['--model', 'faux', '--json']);
  const out = JSON.parse(r.out);
  expect(out.findings.filter((f: { focus: string }) => f.focus === 'correctness').map((f: { path: string }) => f.path)).toEqual(['base.txt', 'new.txt']);
  expect(out.dropped).toContainEqual({ focus: 'correctness', ref: 'elsewhere.ts:9', reason: 'not in the diff' });
});
