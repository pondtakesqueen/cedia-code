import { runSide } from '../loop/side.ts';
import { resolveModel } from '../providers/catalog.ts';
import { COMMIT_SYSTEM, commitMessage, commitPatch, commitPrompt, recentSubjects } from './commit.ts';

// The commit message for `files`, written by `model` from their diff in a session of its own with no tools, logged
// like any other. The TUI's /commit and `cedia commit` both ask for it; the user sees it before anything commits.
export async function draftCommitMessage(opts: { cwd: string; model: string; files: string[]; privacy?: string; signal?: AbortSignal }): Promise<{ message: string; costUsd: number }> {
  const model = resolveModel(opts.model);
  const prompt = commitPrompt(commitPatch(opts.cwd, opts.files), opts.files, recentSubjects(opts.cwd));
  const r = await runSide({ cwd: opts.cwd, model, role: 'commit', access: { kind: 'none' }, system: COMMIT_SYSTEM, prompt, maxTurns: 2, ...(opts.privacy ? { privacy: opts.privacy } : {}), ...(opts.signal ? { signal: opts.signal } : {}) });
  if (r.subtype !== 'success') throw new Error(`the commit message could not be written (${r.subtype}): write one with /commit <message>`);
  return { message: commitMessage(r.result), costUsd: r.costUsd };
}
