import { runSide } from '../../core/loop/side.ts';
import type { ThreadStore } from '../../core/project/threads.ts';
import { reviewSubject, subjectTitle } from '../../core/project/ultrareview.ts';
import { sideModel, threadWriter } from '../../core/side-model.ts';
import { askedReviewPrompt, fixPrompt, parseVerdict } from '../../core/trust/review.ts';
import type { SessionEvent } from '../../core/types.ts';

// What a slash command may use of the TUI: what it runs on, and how it talks back. app.tsx builds one from its
// state; a test builds one from arrays, so a command runs without Ink.
export type CommandCtx = {
  cwd: string;
  // The model picked for the next turn (a ref, a mode, or none).
  model?: string;
  thread?: string;
  store: ThreadStore;
  policy: { allow: string[]; deny: string[]; unlock: string[] };
  privacy?: string;
  signal?: AbortSignal;
  say(text: string, tone?: 'red'): void;
  // A model's text, shown as an assistant message.
  reply(text: string): void;
  toolEvent(e: SessionEvent): void;
  spend(usd: number): void;
  // Asks y/n; `yes` runs on y.
  confirm(what: string, yes: () => Promise<void> | void): void;
  // Sends a prompt as the user's next turn.
  send(prompt: string): Promise<void> | void;
};

// /review [pr]: the asked review of the uncommitted changes or a pull request, in a read-only side session shown as
// it goes, then an offer to send the findings to the writer.
export async function reviewCommand(ctx: CommandCtx, pr?: string): Promise<void> {
  const got = await reviewSubject(ctx.cwd, pr, ctx.signal);
  if ('error' in got) return ctx.say(got.error);
  const { subject, patch } = got;
  const reviewModel = sideModel('review', { picked: ctx.model, ...(ctx.thread ? { threadWriter: threadWriter(ctx.store, ctx.thread) } : {}) });
  ctx.say(`reviewing ${subjectTitle(subject)} with ${reviewModel.ref}…`);
  const r = await runSide({
    cwd: ctx.cwd,
    model: reviewModel,
    role: 'review',
    access: { kind: 'read-only', policy: ctx.policy },
    ...(ctx.privacy ? { privacy: ctx.privacy } : {}),
    ...(ctx.signal ? { signal: ctx.signal } : {}),
    maxTurns: 40,
    prompt: askedReviewPrompt(subject, patch),
    onEvent: (e) => {
      if (e.kind === 'assistant') for (const b of e.blocks) if (b.type === 'text' && b.text.trim()) ctx.reply(b.text);
      if (e.kind === 'tool_intent' || e.kind === 'tool_result' || e.kind === 'permission') ctx.toolEvent(e);
    },
  });
  ctx.spend(r.costUsd);
  ctx.say(`review ${r.subtype === 'success' ? 'done' : r.subtype} · ${r.numTurns} turn${r.numTurns === 1 ? '' : 's'} · $${r.costUsd.toFixed(4)}`);
  if (r.subtype !== 'success') {
    if (r.result.trim()) ctx.say(r.result.trim(), 'red');
    return;
  }
  const { verdict, findings } = parseVerdict(r.result);
  if (verdict !== 'changes' || subject.kind !== 'changes' || !findings) return;
  ctx.say(`send these findings to ${ctx.thread ? "this thread's writer" : 'a new thread'} to fix? y to send; n, or anything else you type, cancels`);
  ctx.confirm('sending the findings', () => ctx.send(fixPrompt(reviewModel.ref, findings)));
}
