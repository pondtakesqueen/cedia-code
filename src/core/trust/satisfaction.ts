// Satisfaction judge: did the agent's work actually help the user?
// Reuses the goal-judge pattern (core/trust/goal.ts): a fresh read-only session on a judge model reads the
// task, the agent's report, and the user's follow-up message, and answers whether the original task succeeded.
// "unsure" counts as not satisfied, as in goal mode.

export type SatisfactionVerdict = 'satisfied' | 'not_satisfied' | 'impossible';

export type SatisfactionResult = { verdict: SatisfactionVerdict; reason: string };

export const satisfactionPrompt = (task: string, report: string, followUp: string) =>
  `You are a judge. You did not write the code. Decide whether the original task was actually completed, using the user's follow-up message as evidence. If you are unsure, answer not satisfied.

<task>
${task}
</task>

<agent_report>
${report}
</agent_report>

<user_followup>
${followUp}
</user_followup>

Answer on the first line with exactly one of: SATISFIED, NOT_SATISFIED, or IMPOSSIBLE. Then a second line with one sentence explaining what the follow-up shows. If the user moved on to another task or confirmed success, that is SATISFIED. If the user reported an error, repeated the request, asked to undo, or stayed on the same problem, that is NOT_SATISFIED.`;

export function parseSatisfaction(text: string): SatisfactionResult {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const first = (lines[0] ?? '').toUpperCase();
  let verdict: SatisfactionVerdict = 'not_satisfied';
  if (first.includes('SATISFIED') && !first.includes('NOT')) verdict = 'satisfied';
  else if (first.includes('IMPOSSIBLE')) verdict = 'impossible';
  else if (first.includes('NOT_SATISFIED') || first.includes('NOT SATISFIED')) verdict = 'not_satisfied';
  const reason = lines.slice(1).join(' ').trim() || (lines[0] ?? '').trim();
  return { verdict, reason };
}
