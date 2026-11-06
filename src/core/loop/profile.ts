import { ADVISOR_SYSTEM } from '../trust/advisor.ts';
import { CLASSIFIER_SYSTEM } from '../trust/classifier.ts';
import { READ_ONLY_SYSTEM, systemFor } from '../prompts.ts';
import { TRIAGE_SYSTEM } from '../roles.ts';
import type { Policy } from '../safety/policy.ts';
import type { ToolSpec } from '../tools/registry.ts';
import type { ModelSpec } from '../types.ts';

// The kind of session a run opens, and what each kind gets. A run (clients/headless) opens sessions for its
// writer, for read-only roles (plan, review, explore), for one-reply helpers (advisor, classifier, triage) and for
// sub-threads. Which tools, system prompt, permission and checks each gets was a set of conditions spread through
// one call; here it is one rule per kind, testable on its own (test/session-profile.test.ts).
//
// - writer: the run's own writer, the one that hands off, gets mail, may spawn and is judged by the stop hooks.
// - reviewer: reads and never writes; its policy is read-only whatever the run's mode, and its only allow rules are
//   the owner's declared checks, so it can see what fails. The run's own allow rules are the writer's: one such as
//   bash(git *) would let a reviewer write.
// - helper: one reply, no tools, in a session of its own.
// - child: a sub-thread; it writes under the run's policy, reads MCP tools only.
export type SessionKind = 'writer' | 'reviewer' | 'helper' | 'child';

export type SessionRole = 'plan' | 'review' | 'explore' | 'advisor' | 'classifier' | 'triage' | (string & {});

export const HELPER_ROLES: readonly string[] = ['advisor', 'classifier', 'triage'];

export function sessionKind(role: SessionRole | undefined, child: boolean): SessionKind {
  if (role !== undefined) return HELPER_ROLES.includes(role) ? 'helper' : 'reviewer';
  return child ? 'child' : 'writer';
}

// The system prompt: the helpers' own, the read-only one for explore and review, else the model's writer prompt
// (thorough when the writer works from a plan). A plan session keeps the model's prompt.
export function profileSystem(role: SessionRole | undefined, model: ModelSpec, opts: { writing: boolean; fromPlan: boolean }): string {
  if (role === 'advisor') return ADVISOR_SYSTEM;
  if (role === 'classifier') return CLASSIFIER_SYSTEM;
  if (role === 'triage') return TRIAGE_SYSTEM;
  if (role === 'explore' || role === 'review') return READ_ONLY_SYSTEM;
  return systemFor(opts.writing && opts.fromPlan ? { ...model, thorough: true } : model);
}

// A helper has no tools, but its policy is the reviewer's all the same: nothing that only reads gets the writer's.
// `checks` are the owner's (loadOwnerChecks). Each is allowed as the exact command: allow rules are globs, so a
// check with `*` would grant every command it matches, and is left out.
export function profilePermission(kind: SessionKind, policy: Policy, checks: string[]): Policy {
  return kind === 'reviewer' || kind === 'helper' ? { ...policy, mode: 'read-only', allow: checks.filter((c) => !c.includes('*')).map((c) => `bash(${c})`) } : policy;
}

// The tool sets a run has, by who may get them; `profileTools` picks for a kind. A resumed writer keeps exactly
// the tools its session was opened with (its cached prefix), so the full set is filtered by the header's names.
export type ToolSets = {
  core: ToolSpec[];
  review: ToolSpec[];
  // The writer's extra tools (spawn, ask, todo, threads, skills, web, browser, MCP), in their fixed order.
  extra: ToolSpec[];
  // Added to reviewers and sub-threads alike, after their base set.
  skill?: ToolSpec;
  webFetch: ToolSpec;
  webFetchRead: ToolSpec;
  mcpRead: ToolSpec[];
  childRecall?: ToolSpec;
  resumed?: string[];
};

export function profileTools(kind: SessionKind, t: ToolSets): ToolSpec[] {
  if (kind === 'helper') return [];
  if (kind === 'reviewer') return [...t.review, ...(t.skill ? [t.skill] : []), t.webFetchRead, ...t.mcpRead];
  if (kind === 'child') return [...t.core, ...(t.childRecall ? [t.childRecall] : []), ...(t.skill ? [t.skill] : []), t.webFetch, ...t.mcpRead];
  const all = [...t.core, ...t.extra];
  return t.resumed ? all.filter((x) => t.resumed!.includes(x.name)) : all;
}

// A work sub-thread on the writer's model opens with the writer's tool list and system prompt, byte for byte, when
// it can: the provider caches the request prefix (tools, then system), and the writer wrote that prefix to the
// cache in the request that called spawn, so the sub-thread's first request reads it instead of writing it again.
// It still runs only its own tools. Each writer tool it also has is its own spec (the same definition); each one it
// does not have (spawn, ask, the thread tools, MCP tools that write) keeps the writer's definition and refuses every
// call, so the list says more than the sub-thread may do and nothing more runs. A sub-thread that needs a tool the
// writer does not list, or lists with another definition, keeps its own list: undefined.
export function sharedPrefixTools(writer: ToolSpec[], own: ToolSpec[]): ToolSpec[] | undefined {
  const def = (t: ToolSpec) => JSON.stringify([t.name, t.description, t.schema]);
  const byName = new Map(writer.map((t) => [t.name, t]));
  if (own.some((t) => !byName.has(t.name) || def(byName.get(t.name)!) !== def(t))) return undefined;
  const mine = new Map(own.map((t) => [t.name, t]));
  return writer.map((t) => mine.get(t.name) ?? refused(t));
}

const refused = ({ name, description, schema }: ToolSpec): ToolSpec => ({
  name,
  description,
  schema,
  effect: 'read',
  replay: 'safe',
  run: async () => ({ text: `${name} is the parent session's tool, not a sub-thread's: a call to it is refused. Do this part with your own tools, or say in your report what is left for the parent.`, isError: true }),
});
