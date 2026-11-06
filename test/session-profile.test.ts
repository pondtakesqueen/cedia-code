import { expect, test } from 'bun:test';
import { profilePermission, profileSystem, profileTools, sessionKind, sharedPrefixTools, type ToolSets } from '../src/core/loop/profile.ts';
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

// --thorough on|off sets the writer's stop lines whatever the model's default, so an eval can A/B them.
test('--thorough overrides the writer prompt, not the helpers\'', () => {
  const haiku = resolveModel('anthropic/claude-haiku-5-5');
  const opus = resolveModel('anthropic/claude-opus-5-5');
  expect(profileSystem(undefined, haiku, { writing: true, fromPlan: false })).toBe(systemFor({ ...haiku, thorough: false }));
  expect(profileSystem(undefined, haiku, { writing: true, fromPlan: false, thorough: true })).toBe(systemFor({ ...haiku, thorough: true }));
  expect(profileSystem(undefined, opus, { writing: true, fromPlan: false, thorough: false })).toBe(systemFor({ ...opus, thorough: false }));
  expect(profileSystem(undefined, haiku, { writing: true, fromPlan: true, thorough: false })).toBe(systemFor({ ...haiku, thorough: false }));
  expect(profileSystem('plan', haiku, { writing: false, fromPlan: false, thorough: true })).toBe(systemFor(haiku));
});

// A work sub-thread on the writer's model opens with the writer's tool list, byte for byte, so its first request
// reads the tools and system prompt from the cache the writer just wrote. It still runs only its own tools.
const spec = (name: string, description = `${name} does a thing`): ToolSpec =>
  ({ name, description, schema: { type: 'object' }, effect: 'write_workspace', replay: 'unsafe', run: async () => ({ text: `${name} ran`, isError: false }) }) as ToolSpec;

test('a sub-thread shares the writer\'s tool list; tools that are not its own are listed but refused', async () => {
  const read = spec('read');
  const edit = spec('edit');
  const webFetch = spec('web_fetch');
  const spawn = spec('spawn');
  const ask = spec('ask');
  const writer = [read, edit, spawn, ask, webFetch];
  const shared = sharedPrefixTools(writer, [read, edit, webFetch])!;
  // The same definitions in the same order: the bytes the provider caches.
  expect(shared.map(({ name, description, schema }) => ({ name, description, schema }))).toEqual(writer.map(({ name, description, schema }) => ({ name, description, schema })));
  // Its own tools are the very same specs; the writer's others refuse every call and change nothing.
  expect(shared[0]).toBe(read);
  expect(shared[4]).toBe(webFetch);
  for (const i of [2, 3]) {
    expect(shared[i]).not.toBe(writer[i]);
    expect(shared[i]!.effect).toBe('read');
    const out = await shared[i]!.run({}, {} as never);
    expect(out.isError).toBe(true);
    expect(out.text).toContain('not a sub-thread\'s');
  }
});

test('a sub-thread that needs a tool the writer does not list, or lists differently, keeps its own list', () => {
  const read = spec('read');
  expect(sharedPrefixTools([read, spec('spawn')], [read, spec('recall')])).toBeUndefined();
  expect(sharedPrefixTools([read, spec('web_fetch', 'the writer\'s version')], [read, spec('web_fetch')])).toBeUndefined();
});

test('a reviewer runs only the owner checks it is given, each as the exact command: a wildcard grants nothing', () => {
  const policy = { mode: 'read-only', allow: [], deny: [] } as unknown as Policy;
  expect(profilePermission('reviewer', policy, ['*', 'git *', 'bun test'])).toMatchObject({ allow: ['bash(bun test)'] });
});
