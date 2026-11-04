import type { SlopFinding } from '../trust/slop.ts';
import { slopReminder } from '../trust/slop.ts';
import type { Refusal, StopReason } from '../types.ts';

// The guards a turn that ended with no tool call passes, in order, before cedia takes its claim of done:
// output-limit, refusal, empty-reply, slop, done-gate, stop-hooks. Each keeps its own state (one reminder, then a
// stop) in the EndGuards a run creates, and reads only the TurnEnd it is given, so each rule is testable without a
// loop (test/guards.test.ts). runPrompt logs a reminder, or turns a stop into the run's result.

export const END_GUARDS = ['output-limit', 'refusal', 'empty-reply', 'slop', 'done-gate', 'stop-hooks'] as const;
export type EndGuardName = (typeof END_GUARDS)[number];

// How a stop ends the run: the provider declined; the model ended its turn twice with nothing; or the claim stands
// unverified (the done gate refused it after its reminder, or the stop hooks refused it too often).
export type EndStop = { as: 'refusal'; refusal?: Refusal } | { as: 'empty-reply' } | { as: 'unverified' };

// `escalate` asks for the session's one effort step up, after the reminder is logged (the done gate's, SPEC
// "Effort escalation"); runPrompt ignores it where the session cannot escalate (soft checks, no per-message effort).
export type TurnVerdict = { kind: 'pass' } | { kind: 'remind'; text: string; escalate?: true } | { kind: 'stop'; stop: EndStop };

export type EndGuard = { name: EndGuardName; judge(): TurnVerdict | Promise<TurnVerdict> };

// What the guards read about the turn. The costly parts (the slop scan, the ledger, the user's hooks) are
// functions, so a guard that is not reached does not run them.
export type TurnEnd = {
  stop: StopReason;
  refusal?: Refusal;
  text: string;
  slop: () => SlopFinding[];
  verified: () => boolean;
  checks: string[];
  // Soft checks were found, not declared: the done gate reminds once and never refuses.
  softChecks: boolean;
  stopHook: () => Promise<{ hook: string; reason: string } | undefined>;
};

export const pass: TurnVerdict = { kind: 'pass' };

export const CONTINUE_AFTER_LIMIT = 'Your previous reply was cut off by the output limit. Continue exactly where it stopped.';

// A reply with no text and no tool call (thinking only, or nothing at all) ends no task: an earlier turn's text
// would otherwise stand as the result.
export const EMPTY_REPLY = 'Your last reply had no text and no tool call. Go on with the task, or reply with what you found or did.';

export const unverifiedReminder = (checks: string[]) =>
  `cedia has no record of a declared check passing since your last change, so the task is not done yet. A check counts only when the whole bash command is ${checks.map((c) => `\`${c}\``).join(' or ')} (a leading \`cd\` to the working directory is fine; pipes, \`;\` or other commands are not). Run it that way now, fix what fails, then report.`;

export const MAX_STOP_REFUSALS = 2;

export const stopHookReminder = (hook: string, reason: string) =>
  `cedia: your claim that the task is done was refused by the user's stop hook ${hook}: ${reason}\nFix what it names, run the checks again, then reply.`;

// The guards of one run, with their state. `activity` is called after a turn that did something (a call or text),
// which lets the empty-reply guard remind again later.
export function endGuards(): { guards(turn: TurnEnd): EndGuard[]; activity(): void } {
  let emptyNudged = false;
  let slopNudged = false;
  let doneNudged = false;
  let stopRefused = 0;
  return {
    activity: () => {
      emptyNudged = false;
    },
    guards: (turn) => [
      { name: 'output-limit', judge: () => (turn.stop === 'max_tokens' ? { kind: 'remind', text: CONTINUE_AFTER_LIMIT } : pass) },
      // A refusal ends the run as a failure, whatever the ledger holds.
      { name: 'refusal', judge: () => (turn.stop === 'refusal' ? { kind: 'stop', stop: { as: 'refusal', ...(turn.refusal ? { refusal: turn.refusal } : {}) } } : pass) },
      {
        name: 'empty-reply',
        judge: () => {
          if (turn.text.trim()) return pass;
          if (emptyNudged) return { kind: 'stop', stop: { as: 'empty-reply' } };
          emptyNudged = true;
          return { kind: 'remind', text: EMPTY_REPLY };
        },
      },
      // One reminder naming what looks like a shortcut; the model fixes it or explains it.
      {
        name: 'slop',
        judge: () => {
          if (slopNudged) return pass;
          const found = turn.slop();
          if (!found.length) return pass;
          slopNudged = true;
          return { kind: 'remind', text: slopReminder(found) };
        },
      },
      // One reminder to run a declared check, then the claim is refused.
      {
        name: 'done-gate',
        judge: () => {
          if (turn.verified()) return pass;
          if (!doneNudged) {
            doneNudged = true;
            return { kind: 'remind', text: unverifiedReminder(turn.checks), escalate: true };
          }
          return turn.softChecks ? pass : { kind: 'stop', stop: { as: 'unverified' } };
        },
      },
      // The user's stop hooks judge the claim last, like a check the user wrote: a refusal goes back to the model.
      {
        name: 'stop-hooks',
        judge: async () => {
          const refusal = await turn.stopHook();
          if (!refusal) return pass;
          if (++stopRefused > MAX_STOP_REFUSALS) return { kind: 'stop', stop: { as: 'unverified' } };
          return { kind: 'remind', text: stopHookReminder(refusal.hook, refusal.reason) };
        },
      },
    ],
  };
}

// The first guard that does not pass, with what it said; undefined when every guard passed.
export async function judgeEnd(guards: EndGuard[]): Promise<{ name: EndGuardName; verdict: Exclude<TurnVerdict, { kind: 'pass' }> } | undefined> {
  for (const g of guards) {
    const verdict = await g.judge();
    if (verdict.kind !== 'pass') return { name: g.name, verdict };
  }
  return undefined;
}
