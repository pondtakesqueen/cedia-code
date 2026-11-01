// Classify a failed tool call into one of Cursor-style error categories, so harness regressions can be
// attributed and baselined per tool and model. The classification is heuristic and evidence-based: it reads
// the tool result's text, exit code and status. It returns 'none' when the call did not fail.
//
// See .agents/skills/tool-error-taxonomy/SKILL.md for the category definitions and the procedure.

export type ToolErrorCategory =
  | 'InvalidArguments'
  | 'UnexpectedEnvironment'
  | 'ProviderError'
  | 'Timeout'
  | 'UserAborted'
  | 'none';

export type ClassifiableToolResult = {
  text: string;
  isError: boolean;
  exitCode?: number;
};

export function classifyToolError(
  output: ClassifiableToolResult,
  status?: string,
): ToolErrorCategory {
  // A denied or not-started call is not a tool failure of these kinds.
  if (status === 'denied' || status === 'not_started') return 'none';
  if (!output.isError && status !== 'failed' && status !== 'interrupted_unknown') return 'none';

  const t = output.text.toLowerCase();

  if (status === 'interrupted_safe' || /user aborted|cancelled by (the )?user|aborted by user/.test(t)) {
    return 'UserAborted';
  }
  if (/timed out|timeout|etimedout|deadline exceeded/.test(t)) {
    return 'Timeout';
  }
  if (
    /invalid (argument|param|option|flag)|unknown (flag|option|command)|missing (required|argument)|expected .+ but (got|received)|usage:/i.test(
      output.text,
    )
  ) {
    return 'InvalidArguments';
  }
  if (
    /command not found|no such file or directory|cannot find module|module not found|not installed|permission denied|operation not permitted|sandbox|eacces|enoent/.test(t)
  ) {
    return 'UnexpectedEnvironment';
  }
  if (
    /provider|rate limit|service unavailable|connection (refused|reset|timed out)|econn(refused|reset)|5\d\d|bad gateway|gateway timeout/.test(t)
  ) {
    return 'ProviderError';
  }
  // A failed call with no recognizable cause is most often an environment assumption that did not hold.
  if (output.isError || status === 'failed' || status === 'interrupted_unknown') {
    return 'UnexpectedEnvironment';
  }
  return 'none';
}
