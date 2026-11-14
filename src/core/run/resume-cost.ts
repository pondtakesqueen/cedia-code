import { resumeChoice, type ResumeChoice } from '../context/handoff.ts';
import { profileSystem } from '../loop/profile.ts';
import { resolveModel } from '../providers/catalog.ts';
import { SessionLog, sessionExists } from '../session/log.ts';
import type { ThreadStore } from '../threads/threads.ts';
import { CORE_TOOLS } from '../tools/index.ts';
import { toolDefs } from '../tools/registry.ts';
import { resumeNote } from './thread.ts';

// What going on with a thread at rest would cost, for a client that asks before it sends: the next prompt either
// resumes the thread's last session (its whole context, re-read at the uncached price once the cache has expired)
// or starts a new session from where the thread stopped. `ask` is when the two differ enough to be the owner's
// call: the cache is cold or about to be, the context is large, and the whole context costs more than twice the
// new start. A run decides the same way on its own (`--cold-resume auto`); `keep` and `fresh` are the answers.
export type ColdResume = 'auto' | 'keep' | 'fresh';
export const isColdResume = (s: string): s is ColdResume => s === 'auto' || s === 'keep' || s === 'fresh';

export type ResumeCost = {
  thread: string;
  model: string;
  ask: boolean;
  cold: boolean;
  idleMs: number;
  // The last session's context, and about what a new session starts at.
  contextTokens: number;
  freshTokens: number;
  resumeUsd: number;
  freshUsd: number;
};

// Undefined when the next prompt opens a new session whatever the owner says: no thread, no writer session left
// to resume, its log gone, or `model` is not the one it ran on.
export function resumeCost(store: ThreadStore, thread: string, opts: { model?: string; now?: Date } = {}): ResumeCost | undefined {
  if (!store.has(thread)) return undefined;
  const t = store.read(thread);
  const last = t.sessions.findLast((s) => s.role === 'code' && !t.rewound.includes(s.sessionId));
  if (!last?.path || !sessionExists(last.path)) return undefined;
  let model;
  try {
    model = resolveModel(last.model);
    if (opts.model && resolveModel(opts.model).ref !== model.ref) return undefined;
  } catch {
    return undefined;
  }
  // The run's own estimate adds the preamble and the task, which are small beside the tools.
  const freshTokens = Math.ceil((profileSystem(undefined, model, { writing: true, fromPlan: false }).length + JSON.stringify(toolDefs(CORE_TOOLS)).length + resumeNote(t).length) / 4);
  const c: ResumeChoice | undefined = resumeChoice(SessionLog.load(last.path).events, model, freshTokens, opts.now);
  if (!c) return undefined;
  return { thread, model: model.ref, ask: c.fresh, cold: c.cold, idleMs: c.idleMs, contextTokens: c.contextTokens, freshTokens, resumeUsd: c.resumeUsd, freshUsd: c.freshUsd };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

// The question as one line, the same in every client.
export const resumeCostLine = (c: ResumeCost): string =>
  `this thread has been idle ${Math.round(c.idleMs / 60_000)} min and its cache ${c.cold ? 'has expired' : 'is about to expire'}: going on with its whole context re-reads ${Math.round(c.contextTokens / 1000)}k tokens (about ${usd(c.resumeUsd)}); a new session from where it stopped starts at about ${Math.round(c.freshTokens / 1000)}k (${usd(c.freshUsd)})`;
