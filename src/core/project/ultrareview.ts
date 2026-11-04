import { readFileSync } from 'node:fs';
import { loadPolicy, loadPrivacy } from '../config.ts';
import { runPrompt } from '../loop/run.ts';
import { providerFor } from '../providers/index.ts';
import { READ_ONLY_SYSTEM } from '../prompts.ts';
import { SessionLog, sessionPath } from '../session/log.ts';
import { CORE_TOOLS } from '../tools/index.ts';
import { askedReviewPrompt, parseVerdict, type ReviewSubject } from '../trust/review.ts';
import type { ModelSpec, SessionEvent } from '../types.ts';
import { parseFindings, type CodeFinding } from './code-review.ts';
import { pullRequest } from './commit.ts';
import { workingDiff } from './git.ts';

// `cedia ultrareview` and the TUI's /ultrareview: the asked review (/review) run once per focus, side by side, each
// a read-only session of its own, and their FINDING lines gathered under the focus that found them.

// One pass of the review: its name, and the line that narrows the asked review to it.
export type Focus = { name: string; prompt: string };
export const FOCUSES: readonly Focus[] = [
  { name: 'correctness', prompt: 'Focus only on correctness: wrong behavior, logic errors, missed cases, partial implementations, swallowed errors.' },
  { name: 'security', prompt: 'Focus only on security: injection, authz/authn, secrets, unsafe deserialization, path traversal, TOCTOU, crypto misuse.' },
  { name: 'tests', prompt: 'Focus only on tests: weakened tests, missing tests for changed behavior, tests that pass trivially, coverage gaps that matter.' },
  { name: 'perf-readability', prompt: 'Focus only on performance and readability: complexity that hurts correctness or perf, duplication, unclear naming where it hides bugs, hot paths.' },
];

export type UltraFinding = CodeFinding & { focus: string };
// What `cedia ultrareview --json` prints: the findings by focus, in focus order, and the passes that did not finish
// (a failed pass leaves the others standing); or why there is no review.
export type UltraReview =
  | { model: string; subject: string; findings: UltraFinding[]; failed: { focus: string; reason: string }[]; costUsd: number }
  | { error: string };

// What a review reads: the working tree's changes against HEAD, or pull request `pr` (with or without its `#`).
export async function reviewSubject(cwd: string, pr?: string, signal?: AbortSignal): Promise<{ subject: ReviewSubject; patch: string } | { error: string }> {
  if (pr) {
    const number = pr.replace(/^#/, '');
    const got = await pullRequest(cwd, number, undefined, signal);
    if ('error' in got) return got;
    return { subject: { kind: 'pr', number, title: got.title, body: got.body }, patch: got.patch };
  }
  const w = workingDiff(cwd);
  if (!w) return { error: 'not a git repository' };
  if (!w.patch && !w.untracked.length) return { error: 'no changes to review' };
  return { subject: { kind: 'changes', untracked: w.untracked }, patch: w.patch };
}

export const subjectTitle = (s: ReviewSubject) => (s.kind === 'pr' ? `pull request #${s.number}` : 'the uncommitted changes');

export async function ultraReview(opts: {
  cwd: string;
  subject: ReviewSubject;
  patch: string;
  model: ModelSpec;
  signal?: AbortSignal;
  policy?: { allow?: string[]; deny?: string[]; unlock?: string[] };
  privacy?: string;
  focuses?: readonly Focus[];
  // Each pass's events as its log takes them, for a client that shows the passes at work.
  onEvent?: (focus: string, e: SessionEvent) => void;
}): Promise<UltraReview> {
  const fauxScript = process.env.CEDIA_FAUX_SCRIPT ? JSON.parse(readFileSync(process.env.CEDIA_FAUX_SCRIPT, 'utf8')) : undefined;
  const signal = opts.signal ?? new AbortController().signal;
  const focuses = opts.focuses ?? FOCUSES;
  // A log per pass: runPrompt builds each request from its log, so passes sharing one would read each other's turns.
  const runs = await Promise.allSettled(
    focuses.map((f) => {
      const id = crypto.randomUUID();
      const log = SessionLog.create({ id, path: sessionPath(opts.cwd, id) });
      if (opts.onEvent) log.listeners.push((e) => opts.onEvent!(f.name, e));
      return runPrompt(
        {
          log,
          provider: providerFor(opts.model, { fauxScript }),
          model: opts.model,
          tools: CORE_TOOLS.filter((t) => t.effect !== 'write_workspace'),
          system: READ_ONLY_SYSTEM,
          cwd: opts.cwd,
          role: 'review',
          permission: { ...loadPolicy(opts.cwd, { allow: opts.policy?.allow ?? [], deny: opts.policy?.deny ?? [], unlock: opts.policy?.unlock ?? [] }), mode: 'read-only' },
          privacy: loadPrivacy(opts.cwd, opts.privacy),
          maxTurns: 30,
          signal,
        },
        `${askedReviewPrompt(opts.subject, opts.patch)}\n\nSPECIAL FOCUS: ${f.prompt}\nReturn findings relevant to this focus only. Use FINDING: ... and end with VERDICT: ...`,
      );
    }),
  );
  const findings: UltraFinding[] = [];
  const failed: { focus: string; reason: string }[] = [];
  let costUsd = 0;
  runs.forEach((res, i) => {
    const focus = focuses[i]!.name;
    if (res.status === 'rejected') return void failed.push({ focus, reason: String((res.reason as Error)?.message ?? res.reason) });
    costUsd += res.value.costUsd;
    if (res.value.subtype !== 'success') return void failed.push({ focus, reason: res.value.subtype });
    for (const f of parseFindings(parseVerdict(res.value.result).findings)) findings.push({ focus, ...f });
  });
  if (failed.length === focuses.length) return { error: `no pass finished (${failed.map((f) => `${f.focus}: ${f.reason}`).join('; ')})` };
  return { model: opts.model.ref, subject: subjectTitle(opts.subject), findings, failed, costUsd };
}
