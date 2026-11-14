import { runSide } from '../loop/side.ts';
import { resolveModel } from '../providers/catalog.ts';
import { COMMIT_SYSTEM, commitMessage, commitPatch, commitPrompt, defaultBranch, PR_SYSTEM, prChange, prPrompt, prTemplate, prText, recentSubjects, type PrText } from './commit.ts';

// The commit message for `files`, written by `model` from their diff in a session of its own with no tools, logged
// like any other. The TUI's /commit and `cedia commit` both ask for it; the user sees it before anything commits.
export async function draftCommitMessage(opts: { cwd: string; model: string; files: string[]; privacy?: string; signal?: AbortSignal }): Promise<{ message: string; costUsd: number }> {
  const model = resolveModel(opts.model);
  const prompt = commitPrompt(commitPatch(opts.cwd, opts.files), opts.files, recentSubjects(opts.cwd));
  const r = await runSide({ cwd: opts.cwd, model, role: 'commit', access: { kind: 'none' }, system: COMMIT_SYSTEM, prompt, maxTurns: 2, ...(opts.privacy ? { privacy: opts.privacy } : {}), ...(opts.signal ? { signal: opts.signal } : {}) });
  if (r.subtype !== 'success') throw new Error(`the commit message could not be written (${r.subtype}): write one with /commit <message>`);
  return { message: commitMessage(r.result), costUsd: r.costUsd };
}

// The pull request's title and body when the repository has a template: written by `model` from the branch's
// commits and diff, in a session of its own with no tools. Undefined when there is no template, and when the model
// gave nothing usable, so the caller lets gh fill the pull request from the commits as before.
export async function draftPrText(opts: { cwd: string; model: string; privacy?: string; signal?: AbortSignal }): Promise<{ text: PrText; template: string; costUsd: number } | undefined> {
  const template = prTemplate(opts.cwd);
  if (!template) return undefined;
  const prompt = prPrompt(template.text, prChange(opts.cwd, defaultBranch(opts.cwd)));
  try {
    const r = await runSide({ cwd: opts.cwd, model: resolveModel(opts.model), role: 'pr', access: { kind: 'none' }, system: PR_SYSTEM, prompt, maxTurns: 2, ...(opts.privacy ? { privacy: opts.privacy } : {}), ...(opts.signal ? { signal: opts.signal } : {}) });
    const text = r.subtype === 'success' ? prText(r.result) : undefined;
    return text ? { text, template: template.path, costUsd: r.costUsd } : undefined;
  } catch {
    return undefined;
  }
}
