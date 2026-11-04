import { expect, test } from 'bun:test';
import { profilePermission, profileSystem, profileTools, sessionKind, type ToolSets } from '../src/core/loop/profile.ts';
import { READ_ONLY_SYSTEM, systemFor } from '../src/core/prompts.ts';
import { resolveModel } from '../src/core/providers/catalog.ts';
import type { Policy } from '../src/core/safety/policy.ts';
import type { ToolSpec } from '../src/core/tools/registry.ts';
import { ADVISOR_SYSTEM } from '../src/core/trust/advisor.ts';

// What each kind of session a run opens gets, without running one.
const tool = (name: string): ToolSpec => ({ name } as ToolSpec);
const sets: ToolSets = {
  core: [tool('read'), tool('edit')],
  review: [tool('read')],
  extra: [tool('spawn'), tool('web_fetch')],
  skill: tool('skill'),
  webFetch: tool('web_fetch'),
  webFetchRead: tool('web_fetch_read'),
  mcpRead: [tool('mcp__docs__search')],
};
const names = (ts: ToolSpec[]) => ts.map((t) => t.name);

test('the kind follows the role and whether the session is a sub-thread', () => {
  expect(sessionKind(undefined, false)).toBe('writer');
  expect(sessionKind(undefined, true)).toBe('child');
  for (const r of ['plan', 'review', 'explore']) expect(sessionKind(r, false)).toBe('reviewer');
  for (const r of ['advisor', 'classifier', 'triage']) expect(sessionKind(r, false)).toBe('helper');
});

test('a reviewer or a helper never gets the writer\'s allow rules, only the declared checks, read-only', () => {
  const policy = { mode: 'workspace', allow: ['bash(git *)'], deny: ['bash(rm *)'] } as unknown as Policy;
  for (const k of ['reviewer', 'helper'] as const) {
    expect(profilePermission(k, policy, ['bun test'])).toMatchObject({ mode: 'read-only', allow: ['bash(bun test)'], deny: ['bash(rm *)'] });
  }
  expect(profilePermission('writer', policy, ['bun test'])).toBe(policy);
  expect(profilePermission('child', policy, [])).toBe(policy);
});

test('tools by kind: helpers none, reviewers read-only, sub-threads core and read MCP, the writer everything', () => {
  expect(profileTools('helper', sets)).toEqual([]);
  expect(names(profileTools('reviewer', sets))).toEqual(['read', 'skill', 'web_fetch_read', 'mcp__docs__search']);
  expect(names(profileTools('child', { ...sets, childRecall: tool('recall') }))).toEqual(['read', 'edit', 'recall', 'skill', 'web_fetch', 'mcp__docs__search']);
  expect(names(profileTools('writer', sets))).toEqual(['read', 'edit', 'spawn', 'web_fetch']);
});

test('a resumed writer keeps only the tools its session opened with, in the fixed order', () => {
  expect(names(profileTools('writer', { ...sets, resumed: ['web_fetch', 'read'] }))).toEqual(['read', 'web_fetch']);
});

test('the system prompt by role', () => {
  const m = resolveModel('anthropic/claude-haiku-5-5');
  expect(profileSystem('advisor', m, { writing: false, fromPlan: false })).toBe(ADVISOR_SYSTEM);
  expect(profileSystem('review', m, { writing: false, fromPlan: false })).toBe(READ_ONLY_SYSTEM);
  expect(profileSystem('plan', m, { writing: false, fromPlan: true })).toBe(systemFor(m));
  expect(profileSystem(undefined, m, { writing: true, fromPlan: true })).toBe(systemFor({ ...m, thorough: true }));
});
