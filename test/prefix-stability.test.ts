import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildMessages } from '../src/core/context/build.ts';
import { memoryPath } from '../src/core/project/memory.ts';
import { stableJson } from '../src/core/hash.ts';
import { projectSlug, SessionLog } from '../src/core/session/log.ts';
import type { EventOf, SessionEvent } from '../src/core/types.ts';

// The cached prefix across runs of one thread (SPEC "Cache rules"): whatever changes between runs (the mode, the
// project's memory, AGENTS.md, the skills on disk, the branch), the next request in the same session repeats every
// byte the last one sent and only adds to it.

const BIN = join(import.meta.dir, '..', 'bin', 'cedia');
const reply = (text: string) => ({ blocks: [{ type: 'text' as const, text }] });
const call = (id: string, command: string) => ({ blocks: [{ type: 'tool_use' as const, id, name: 'bash', input: { command } }] });

function cedia(dir: string, script: unknown[], args: string[]) {
  const scriptPath = join(dir, `script-${crypto.randomUUID()}.json`);
  writeFileSync(scriptPath, JSON.stringify(script));
  const proc = Bun.spawnSync([BIN, '-m', 'faux', '--cwd', dir, ...args], { env: { ...process.env, CEDIA_FAUX_SCRIPT: scriptPath, CEDIA_HOME: join(dir, 'home') }, stdin: 'ignore' });
  expect(proc.exitCode).toBe(0);
  return JSON.parse(proc.stdout.toString()) as { sessionId: string; thread: string; subtype: string };
}

const git = (dir: string, ...args: string[]) => expect(Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir }).exitCode).toBe(0);
const sessionOf = (dir: string, id: string) => {
  const root = join(dir, 'home', 'sessions', projectSlug(dir));
  return readdirSync(root).map((f) => SessionLog.load(join(root, f))).find((l) => l.id === id)!;
};

// Every request of the session: one system prompt, one tool list, and messages that extend the last request's.
function expectStablePrefix(events: SessionEvent[]) {
  const at = events.flatMap((e, i) => (e.kind === 'request' ? [i] : []));
  const reqs = at.map((i) => events[i] as EventOf<'request'>);
  expect(new Set(reqs.map((r) => r.systemHash)).size).toBe(1);
  expect(new Set(reqs.map((r) => r.toolsHash)).size).toBe(1);
  let prev: string[] = [];
  for (const i of at) {
    const msgs = buildMessages(events.slice(0, i)).map(stableJson);
    expect(msgs.slice(0, prev.length)).toEqual(prev);
    prev = msgs;
  }
  return reqs.length;
}

describe('prefix stability across runs (offline, faux)', () => {
  const base = ['--output-format', 'json', '--sandbox', 'off'];

  test('a mode change, a memory note, an AGENTS.md edit, a new skill and a branch switch keep the session prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-prefix-'));
    writeFileSync(join(dir, 'AGENTS.md'), '# rules\nUse tabs.\n');
    writeFileSync(join(dir, 'f.txt'), 'one\n');
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');

    const first = cedia(dir, [call('c1', 'cat f.txt'), reply('read it')], ['-p', 'look at f.txt', ...base, '--permission', 'read-only']);
    const thread = ['--thread', first.thread];
    const step = (script: unknown[], prompt: string, mode = 'workspace') => {
      const r = cedia(dir, script, ['-p', prompt, ...base, '--permission', mode, ...thread]);
      expect(r).toMatchObject({ subtype: 'success', sessionId: first.sessionId });
    };

    // The mode: read-only, then workspace (the next turn is told, message 0 is not rewritten).
    step([call('c2', 'echo two >> f.txt'), reply('wrote')], 'add a line');
    // A memory note: new sessions get it, this one does not.
    expect(Bun.spawnSync([BIN, 'memory', 'add', 'the build uses make'], { cwd: dir, env: { ...process.env, CEDIA_HOME: join(dir, 'home') } }).exitCode).toBe(0);
    expect(existsSync(memoryPath(join(dir, 'home'), projectSlug(dir)))).toBe(true);
    step([reply('noted')], 'anything new?');
    // AGENTS.md and the repository's skills change on disk.
    writeFileSync(join(dir, 'AGENTS.md'), '# rules\nUse spaces.\n');
    mkdirSync(join(dir, '.agents', 'skills', 'deploy'), { recursive: true });
    writeFileSync(join(dir, '.agents', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ship the build.\n---\nRun make deploy.\n');
    step([call('c3', 'cat AGENTS.md'), reply('ok')], 'reread the rules');
    // A branch switch.
    git(dir, 'checkout', '-qb', 'feature');
    step([call('c4', 'git branch --show-current'), reply('on feature')], 'which branch?');

    const events = sessionOf(dir, first.sessionId).events;
    expect(expectStablePrefix(events)).toBeGreaterThanOrEqual(8);
    // What changed reached the model only as later turns, never in message 0.
    const opening = (events.find((e) => e.kind === 'user') as EventOf<'user'>).text;
    expect(opening).not.toContain('the build uses make');
    expect(opening).not.toContain('Use spaces.');
  });
});
