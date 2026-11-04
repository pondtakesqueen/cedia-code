import { runSide } from '../loop/side.ts';
import { resolveModel } from '../providers/catalog.ts';

export type Suggestion = { text: string };

// The last reply goes to a model (beam by default, which keeps prompts), so the project's privacy level holds here as
// in any run: under zdr runPrompt refuses a model that is not zero-data-retention and nothing is suggested.
export async function generateSuggestion(opts: { cwd: string; model?: string; lastResult: string }): Promise<Suggestion | null> {
  const model = resolveModel(opts.model ?? 'beam');
  // Logged like any session, so `cedia usage` counts what the suggestions cost.
  const r = await runSide({
    cwd: opts.cwd,
    model,
    role: 'suggest',
    access: { kind: 'none' },
    system: 'Predict the user\'s next prompt in one short sentence. Reply with only the suggestion.',
    prompt: opts.lastResult || 'continue',
    maxTurns: 1,
  });
  if (r.subtype !== 'success' || !r.result.trim()) return null;
  return { text: r.result.trim() };
}
