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
//   the declared checks, so it can see what fails. The run's own allow rules are the writer's: one such as
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
export function profilePermission(kind: SessionKind, policy: Policy, checks: string[]): Policy {
  return kind === 'reviewer' || kind === 'helper' ? { ...policy, mode: 'read-only', allow: checks.map((c) => `bash(${c})`) } : policy;
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
