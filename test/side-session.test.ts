import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSide, sideAccess } from '../src/core/loop/side.ts';
import { READ_ONLY_SYSTEM } from '../src/core/prompts.ts';
import { resolveModel } from '../src/core/providers/catalog.ts';

// A side session (a review, a commit message, a guide) is one module: what it may touch is decided there, once.
const saved = { script: process.env.CEDIA_FAUX_SCRIPT, home: process.env.CEDIA_HOME };
afterEach(() => {
  for (const [k, v] of [['CEDIA_FAUX_SCRIPT', saved.script], ['CEDIA_HOME', saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

function setup(script: unknown[]) {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-side-'));
  const home = join(dir, '.home');
  const scriptPath = join(dir, 'script.json');
  writeFileSync(scriptPath, JSON.stringify(script));
  process.env.CEDIA_FAUX_SCRIPT = scriptPath;
  process.env.CEDIA_HOME = home;
  return { dir, home };
}

test('read-only access drops every tool that writes the workspace and forces the policy to read-only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-side-'));
  const a = sideAccess(dir, { kind: 'read-only' });
  expect(a.tools.map((t) => t.name)).not.toContain('write');
  expect(a.tools.map((t) => t.name)).not.toContain('edit');
  expect(a.tools.every((t) => t.effect !== 'write_workspace')).toBe(true);
  expect(a.permission?.mode).toBe('read-only');
  expect(a.system).toBe(READ_ONLY_SYSTEM);
  expect(sideAccess(dir, { kind: 'read-only' }, 'own').system).toBe('own');
});

test('a side session with no tools or its own tools needs a system prompt', () => {
  expect(() => sideAccess('/tmp', { kind: 'none' })).toThrow(/system prompt/);
  expect(sideAccess('/tmp', { kind: 'none' }, 's')).toEqual({ tools: [], system: 's' });
});

test('a read-only side session cannot write a file, and its log is kept like any session', async () => {
  const { dir, home } = setup([
    { blocks: [{ type: 'tool_use', id: 'w1', name: 'write', input: { path: 'x.txt', content: 'no' } }] },
    { blocks: [{ type: 'text', text: 'VERDICT: approve' }] },
  ]);
  const seen: string[] = [];
  const r = await runSide({ cwd: dir, model: resolveModel('faux'), role: 'review', access: { kind: 'read-only' }, prompt: 'review', maxTurns: 4, onEvent: (e) => seen.push(e.kind) });
  expect(r.result).toContain('VERDICT: approve');
  expect(existsSync(join(dir, 'x.txt'))).toBe(false);
  expect(seen).toContain('tool_result');
  const logs = readdirSync(join(home, 'sessions'), { recursive: true }).filter((f) => String(f).endsWith('.jsonl'));
  expect(logs.length).toBe(1);
  expect(readFileSync(join(home, 'sessions', String(logs[0])), 'utf8')).toContain('"role":"review"');
});
