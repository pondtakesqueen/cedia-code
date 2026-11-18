// The reviewer's own eval: does a review find a real bug, and does it stay quiet on a clean change?
//
//   bun evals/review-recall/run.ts --estimate [--arm review,ultra] [--model <ref>]
//   bun evals/review-recall/run.ts [--arm review,ultra] [--model <ref>] [--judge <ref>] [--only id,id] [--out <file>]
//
// Each bug case (cases.json) checks out the commit that fixed a real bug and undoes the fix's source change (tests
// left as they are), so the uncommitted change under review brings the bug back. Each control replays a commit
// that stayed clean on its parent. The arms are the asked review cedia ships: `review` (codeReview, one session) and
// `ultra` (ultraReview, four focused sessions side by side), so the eval says whether the four are worth their cost.
//
// A finding earns credit for a bug only when it names the defect. Without --judge that is a location proxy: the
// finding cites a file and a line within 3 lines of a hunk the case changed. With --judge, a model also reads the
// findings against the case's one-sentence key and must say which one describes it. Recall is reported at three
// stages, so a bug found early and lost later shows: raw (every FINDING, including the ones verifyFindings dropped
// for naming a file outside the change), kept (after that filter) and important (kept and tagged Important, or
// untagged). Controls report the findings they drew: every one there is a false alarm.
//
// It spends money: run --estimate first. Results go to --out (JSONL, one line per case and arm) and a summary prints.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { codeReview, type CodeFinding } from '../../src/core/review/code-review.ts';
import { ultraReview } from '../../src/core/review/ultrareview.ts';
import { runSide } from '../../src/core/loop/side.ts';
import { resolveModel } from '../../src/core/providers/catalog.ts';
import { findingRef } from '../../src/core/trust/review.ts';

const ROOT = resolve(import.meta.dir, '..', '..');
const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/;

type Bug = { id: string; fix: string; key: string };
type Control = { id: string; commit: string };
export type Cases = { bugs: Bug[]; controls: Control[] };
type Arm = 'review' | 'ultra';
// What one review of one case found. `hunks` are the changed line ranges, new side, per file.
type Found = { kept: CodeFinding[]; dropped: string[]; costUsd: number; error?: string };
export type Row = {
  id: string;
  kind: 'bug' | 'control';
  arm: Arm;
  model: string;
  costUsd: number;
  findings: number;
  dropped: number;
  error?: string;
  // Bug cases: whether the defect was named at each stage.
  raw?: boolean;
  kept?: boolean;
  important?: boolean;
  judged?: boolean;
};

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });

// The source paths a commit changed, tests left out.
export function srcFiles(commit: string): string[] {
  return git(ROOT, 'diff', '--name-only', `${commit}^`, commit, '--', 'src').stdout.split('\n').filter((f) => f && !TEST_FILE.test(f));
}

// A worktree at `base` with `from..to` of `files` applied as uncommitted changes. Returns the dir and its patch.
export function stage(base: string, from: string, to: string, files: string[]): { dir: string; patch: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-review-recall-'));
  rmSync(dir, { recursive: true, force: true });
  const add = git(ROOT, 'worktree', 'add', '-q', '--detach', dir, base);
  if (add.status !== 0) throw new Error(`worktree at ${base}: ${add.stderr}`);
  const diff = git(ROOT, 'diff', '--binary', from, to, '--', ...files).stdout;
  const p = spawnSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: dir, input: diff, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(`apply ${from}..${to}: ${p.stderr}`);
  return { dir, patch: git(dir, 'diff', '--no-color', '--no-ext-diff').stdout };
}

export const unstage = (dir: string) => git(ROOT, 'worktree', 'remove', '--force', dir);

// The changed line ranges per file, on the side the reviewer reads (the working tree).
export function hunks(patch: string): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  let file: string | undefined;
  for (const line of patch.split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) file = f[1];
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (h && file) {
      const start = Number(h[1]);
      const len = Number(h[2] ?? '1');
      out.set(file, [...(out.get(file) ?? []), [start, start + Math.max(len, 1) - 1]]);
    }
  }
  return out;
}

const SLACK = 3;
// Whether a finding's file:line falls in or near a changed hunk.
export function located(text: string, at: Map<string, [number, number][]>): boolean {
  const ref = findingRef(text);
  if (!ref) return false;
  const ranges = [...at.entries()].find(([f]) => f === ref.path || f.endsWith(`/${ref.path}`) || ref.path.endsWith(`/${f}`))?.[1];
  return !!ranges?.some(([a, b]) => ref.line >= a - SLACK && ref.line <= b + SLACK);
}

async function review(arm: Arm, dir: string, patch: string, model: string): Promise<Found> {
  const files = [...hunks(patch).keys()];
  if (arm === 'review') {
    const r = await codeReview({ cwd: dir, files, patch, model });
    if ('error' in r) return { kept: [], dropped: [], costUsd: 0, error: r.error };
    return { kept: r.findings, dropped: r.dropped.map((d) => d.ref), costUsd: r.costUsd };
  }
  const r = await ultraReview({ cwd: dir, subject: { kind: 'changes', untracked: [] }, patch, model: resolveModel(model) });
  if ('error' in r) return { kept: [], dropped: [], costUsd: 0, error: r.error };
  return { kept: r.findings, dropped: r.dropped.map((d) => d.ref), costUsd: r.costUsd };
}

const JUDGE_SYSTEM = 'You grade a code review against a known bug. Reply with one line: `MATCH: <n>` naming the number of the first finding that describes the bug (what goes wrong, not only where), or `MATCH: none`.';

async function judge(model: string, key: string, findings: CodeFinding[], cwd: string): Promise<{ hit: boolean; costUsd: number }> {
  if (!findings.length) return { hit: false, costUsd: 0 };
  const list = findings.map((f, i) => `${i + 1}. ${f.text}`).join('\n');
  const r = await runSide({ cwd, model: resolveModel(model), role: 'review-judge', access: { kind: 'none' }, system: JUDGE_SYSTEM, maxTurns: 2, prompt: `The bug:\n${key}\n\nThe findings:\n${list}` });
  const m = /MATCH:\s*(\d+|none)/i.exec(r.result ?? '');
  return { hit: !!m && m[1] !== 'none', costUsd: r.costUsd };
}

// Rough dollars a review session costs, by arm, for --estimate: the asked review reads the diff and a few files.
// Measured runs replace these: the summary prints the real mean per arm.
const GUESS_USD: Record<Arm, number> = { review: 0.12, ultra: 0.4 };

export function summarize(rows: Row[]): string {
  const lines: string[] = [];
  for (const arm of [...new Set(rows.map((r) => r.arm))]) {
    const of = rows.filter((r) => r.arm === arm && !r.error);
    const bugs = of.filter((r) => r.kind === 'bug');
    const ctl = of.filter((r) => r.kind === 'control');
    const pct = (n: number) => (bugs.length ? `${Math.round((100 * n) / bugs.length)}%` : '-');
    const n = (k: keyof Row) => bugs.filter((r) => r[k] === true).length;
    const judged = bugs.some((r) => r.judged !== undefined) ? `, judged ${n('judged')}/${bugs.length} (${pct(n('judged'))})` : '';
    const cost = of.reduce((s, r) => s + r.costUsd, 0);
    lines.push(`${arm}: recall raw ${n('raw')}/${bugs.length} (${pct(n('raw'))}), kept ${n('kept')} (${pct(n('kept'))}), important ${n('important')} (${pct(n('important'))})${judged}`);
    lines.push(`  controls: ${ctl.reduce((s, r) => s + r.findings, 0)} findings on ${ctl.length} clean changes (${ctl.filter((r) => r.findings > 0).length} with any)`);
    lines.push(`  cost $${cost.toFixed(2)} ($${(of.length ? cost / of.length : 0).toFixed(3)} a case); errors ${rows.filter((r) => r.arm === arm && r.error).length}`);
  }
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: { arm: { type: 'string', default: 'review,ultra' }, model: { type: 'string', default: 'sonnet' }, judge: { type: 'string' }, only: { type: 'string' }, out: { type: 'string' }, estimate: { type: 'boolean' } },
  });
  const cases = JSON.parse(readFileSync(join(import.meta.dir, 'cases.json'), 'utf8')) as Cases;
  const only = values.only ? new Set(values.only.split(',')) : undefined;
  const bugs = cases.bugs.filter((b) => !only || only.has(b.id));
  const controls = cases.controls.filter((c) => !only || only.has(c.id));
  const arms = values.arm!.split(',') as Arm[];
  const reviews = (bugs.length + controls.length) * arms.length;
  const guess = arms.reduce((s, a) => s + GUESS_USD[a] * (bugs.length + controls.length), 0);
  console.log(`${bugs.length} bug cases, ${controls.length} controls, arms ${arms.join(', ')} on ${values.model}: ${reviews} reviews, about $${guess.toFixed(2)}${values.judge ? ' plus a short judge call per bug review' : ''} (a guess; Sonnet-class pricing)`);
  if (values.estimate) return;
  const out = values.out ?? join(import.meta.dir, `results-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const rows: Row[] = [];
  const record = (r: Row) => {
    rows.push(r);
    appendFileSync(out, `${JSON.stringify(r)}\n`);
    console.log(`${r.arm} ${r.kind} ${r.id}: ${r.error ?? `${r.findings} findings${r.kind === 'bug' ? `, raw ${r.raw} kept ${r.kept} important ${r.important}${r.judged !== undefined ? ` judged ${r.judged}` : ''}` : ''}`} $${r.costUsd.toFixed(3)}`);
  };
  for (const b of bugs) {
    const files = srcFiles(b.fix);
    for (const arm of arms) {
      let s: { dir: string; patch: string } | undefined;
      try {
        // At the fix, undo the fix: the change under review brings the bug back.
        s = stage(b.fix, b.fix, `${b.fix}^`, files);
        const at = hunks(s.patch);
        const f = await review(arm, s.dir, s.patch, values.model!);
        const keptHit = f.kept.filter((x) => located(x.text, at));
        const row: Row = {
          id: b.id, kind: 'bug', arm, model: values.model!, costUsd: f.costUsd, findings: f.kept.length, dropped: f.dropped.length,
          raw: keptHit.length > 0 || f.dropped.some((d) => located(d, at)),
          kept: keptHit.length > 0,
          important: keptHit.some((x) => x.severity === undefined || x.severity === 'important'),
          ...(f.error ? { error: f.error } : {}),
        };
        if (values.judge && !f.error) {
          const j = await judge(values.judge, b.key, f.kept, s.dir);
          row.judged = j.hit;
          row.costUsd += j.costUsd;
        }
        record(row);
      } catch (e) {
        record({ id: b.id, kind: 'bug', arm, model: values.model!, costUsd: 0, findings: 0, dropped: 0, error: (e as Error).message });
      } finally {
        if (s) unstage(s.dir);
      }
    }
  }
  for (const c of controls) {
    for (const arm of arms) {
      let s: { dir: string; patch: string } | undefined;
      try {
        s = stage(`${c.commit}^`, `${c.commit}^`, c.commit, srcFiles(c.commit));
        const f = await review(arm, s.dir, s.patch, values.model!);
        record({ id: c.id, kind: 'control', arm, model: values.model!, costUsd: f.costUsd, findings: f.kept.length, dropped: f.dropped.length, ...(f.error ? { error: f.error } : {}) });
      } catch (e) {
        record({ id: c.id, kind: 'control', arm, model: values.model!, costUsd: 0, findings: 0, dropped: 0, error: (e as Error).message });
      } finally {
        if (s) unstage(s.dir);
      }
    }
  }
  console.log(`\n${summarize(rows)}\n\nrows in ${out}`);
  writeFileSync(`${out}.summary.txt`, `${summarize(rows)}\n`);
}

if (import.meta.main) await main();
