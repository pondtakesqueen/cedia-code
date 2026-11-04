import type { HeadlessResult } from '../types.ts';

// What one guard says about a turn that ended with no tool call: let the claim through to the next guard, send a
// reminder and give the model another turn, or end the run. `end` and `after` are deferred so that a guard that is
// not reached writes nothing to the log.
export type TurnVerdict = { kind: 'pass' } | { kind: 'remind'; text: string; after?: () => void } | { kind: 'stop'; end: () => HeadlessResult };

// The guards a claim of done passes, in order (runPrompt). Each keeps its own state (one reminder, then a stop).
export type EndGuard = { name: EndGuardName; judge(): TurnVerdict | Promise<TurnVerdict> };
export const END_GUARDS = ['output-limit', 'refusal', 'empty-reply', 'slop', 'done-gate', 'stop-hooks'] as const;
export type EndGuardName = (typeof END_GUARDS)[number];

export const pass: TurnVerdict = { kind: 'pass' };

// The first guard that does not pass, with what it said; undefined when every guard passed.
export async function judgeEnd(guards: EndGuard[]): Promise<{ name: EndGuardName; verdict: Exclude<TurnVerdict, { kind: 'pass' }> } | undefined> {
  for (const g of guards) {
    const verdict = await g.judge();
    if (verdict.kind !== 'pass') return { name: g.name, verdict };
  }
  return undefined;
}
