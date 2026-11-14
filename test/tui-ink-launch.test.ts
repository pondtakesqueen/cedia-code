import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acceptTrust } from '../src/clients/tui-ink/onboarding.ts';

// bin/cedia as a person starts it: NODE_ENV unset (bun test sets it to "test", which hid a TUI that could not draw).
const BIN = resolve(import.meta.dir, '../bin/cedia');
const plain = (s: string) => s.replace(/\x1b\[[\d;?<>]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');

function setup(script: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-launch-'));
  const home = join(dir, 'home');
  acceptTrust(home);
  writeFileSync(join(dir, 'faux.json'), JSON.stringify(script));
  const env: Record<string, string> = { ...(process.env as Record<string, string>), CEDIA_HOME: home, CEDIA_FAUX_SCRIPT: join(dir, 'faux.json') };
  delete env.NODE_ENV;
  return { dir, env };
}

describe('bin/cedia launch', () => {
  test('the TUI draws its first screen when NODE_ENV is unset', async () => {
    const { dir, env } = setup([{ blocks: [{ type: 'text', text: 'hi' }] }]);
    let out = '';
    const p = Bun.spawn([BIN, '-m', 'faux'], {
      cwd: dir,
      env,
      terminal: { cols: 100, rows: 30, data: (_t: unknown, d: Uint8Array) => { out += new TextDecoder().decode(d); } },
    } as Parameters<typeof Bun.spawn>[1]);
    for (let i = 0; i < 150 && !/Faux \(scripted\)/.test(plain(out)) && !/ERROR/.test(out); i++) await Bun.sleep(100);
    p.kill();
    await p.exited;
    expect(plain(out)).not.toContain('ERROR');
    expect(plain(out)).toContain('Faux (scripted)');
  }, 20_000);

  test('the commands a run starts do not inherit the NODE_ENV bin/cedia set', async () => {
    const { dir, env } = setup([
      { blocks: [{ type: 'tool_use', id: 'c1', name: 'bash', input: { command: 'echo "${NODE_ENV-unset}" > node-env.txt' } }] },
      { blocks: [{ type: 'text', text: 'done' }] },
    ]);
    const p = Bun.spawn([BIN, '-p', 'go', '-m', 'faux', '--permission', 'workspace', '--sandbox', 'off'], { cwd: dir, env, stdout: 'pipe', stderr: 'pipe' });
    await p.exited;
    expect(readFileSync(join(dir, 'node-env.txt'), 'utf8').trim()).toBe('unset');
  }, 20_000);
});

describe('bin/cedia follows the open thread', () => {
  test('the TUI says when another cedia runs the thread it has open, and what came of it', async () => {
    const { dir, env } = setup([{ blocks: [{ type: 'text', text: 'one' }] }]);
    const headless = (prompt: string, extra: string[] = []) => Bun.spawnSync([BIN, '-m', 'faux', '-p', prompt, ...extra, '--output-format', 'json', '--cwd', dir], { env, stdin: 'ignore' });
    const first = headless('first');
    expect(first.exitCode).toBe(0);
    const thread = JSON.parse(first.stdout.toString()).thread as string;
    let out = '';
    const p = Bun.spawn([BIN, '-m', 'faux', '--thread', thread], {
      cwd: dir,
      env,
      terminal: { cols: 120, rows: 40, data: (_t: unknown, d: Uint8Array) => { out += new TextDecoder().decode(d); } },
    } as Parameters<typeof Bun.spawn>[1]);
    try {
      // A loaded CI runner can take 15s to draw the first screen; the other run must start after it, or the TUI's
      // first look at the thread already has it.
      for (let i = 0; i < 400 && !/Faux \(scripted\)/.test(plain(out)); i++) await Bun.sleep(100);
      if (!/Faux \(scripted\)/.test(plain(out))) throw new Error(`the TUI drew no first screen (exit ${p.exitCode}); its output: ${JSON.stringify(out.slice(-3000))}`);
      expect(headless('second from the desktop', ['--thread', thread]).exitCode).toBe(0);
      for (let i = 0; i < 150 && !/that run is done/.test(plain(out)); i++) await Bun.sleep(100);
      expect(plain(out)).toContain('ran this thread: second from the desktop');
      expect(plain(out)).toContain('that run is done: one');
    } finally {
      p.kill();
      await p.exited;
    }
  }, 75_000);
});
