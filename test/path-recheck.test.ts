// A reply's calls are decided before any of them runs. A call that an earlier call of the same reply could have
// changed the tree under (a symlink made by bash) is decided again right before it runs, on the tree as it is
// then. Security audit 2026-11-06, finding 2.
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPrompt } from '../src/core/loop/run.ts';
import { FAUX_MODEL } from '../src/core/providers/catalog.ts';
import { fauxProvider, text, toolUse } from '../src/core/providers/faux.ts';
import { SessionLog } from '../src/core/session/log.ts';
import { bashTool } from '../src/core/tools/bash.ts';
import { writeTool } from '../src/core/tools/edit.ts';
import { readTool } from '../src/core/tools/read.ts';
import type { EventOf } from '../src/core/types.ts';

test('a write, a hook and a credential read through a link made earlier in the same reply are denied, not followed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cedia-recheck-'));
  const cwd = join(root, 'repo');
  const outside = join(root, 'outside');
  mkdirSync(cwd);
  mkdirSync(join(cwd, '.git', 'hooks'), { recursive: true });
  mkdirSync(outside);
  // outside/vault stands for a credential store: reads outside the workspace are allowed, reads of a store never.
  mkdirSync(join(outside, 'vault'));
  writeFileSync(join(outside, 'vault', 'secret.txt'), 'OUTSIDE_VALUE\n');
  const log = SessionLog.create();
  const steps = [
    {
      blocks: [
        toolUse('c1', 'bash', { command: `ln -s ${outside} h && ln -s .. up` }),
        toolUse('c2', 'write', { path: 'h/planted.txt', content: 'x\n' }),
        toolUse('c3', 'read', { path: 'h/vault/secret.txt' }),
        toolUse('c4', 'write', { path: 'up/repo/.git/hooks/pre-commit', content: '#!/bin/sh\n' }),
      ],
    },
    { blocks: [text('done')] },
  ];
  await runPrompt({ log, provider: fauxProvider(steps), model: FAUX_MODEL, tools: [bashTool, writeTool, readTool], system: 'sys', cwd, permission: { mode: 'workspace', allow: [], deny: [], secrets: [join(outside, 'vault')] } }, 'go');
  const results = new Map(log.events.filter((e): e is EventOf<'tool_result'> => e.kind === 'tool_result').map((e) => [e.callId, e]));
  expect(results.get('c1')?.status).toBe('completed');
  for (const id of ['c2', 'c3', 'c4']) expect(results.get(id)?.status).toBe('denied');
  expect(existsSync(join(outside, 'planted.txt'))).toBe(false);
  expect(existsSync(join(cwd, '.git', 'hooks', 'pre-commit'))).toBe(false);
  expect(String(results.get('c3')?.output.text)).not.toContain('OUTSIDE_VALUE');
});

test('calls in a reply where nothing ran before them log one permission each when nothing changes the decision', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cedia-recheck-'));
  const log = SessionLog.create();
  const steps = [{ blocks: [toolUse('c1', 'write', { path: 'a.txt', content: 'a\n' }), toolUse('c2', 'read', { path: 'a.txt' })] }, { blocks: [text('done')] }];
  await runPrompt({ log, provider: fauxProvider(steps), model: FAUX_MODEL, tools: [writeTool, readTool], system: 'sys', cwd, permission: { mode: 'workspace', allow: [], deny: [] } }, 'go');
  const perms = log.events.filter((e) => e.kind === 'permission');
  expect(perms.length).toBe(2);
  const results = log.events.filter((e): e is EventOf<'tool_result'> => e.kind === 'tool_result');
  expect(results.map((r) => r.status)).toEqual(['completed', 'completed']);
});
