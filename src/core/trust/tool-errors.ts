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

// --- Baselines and anomaly detection (Cursor-style): error rates per tool and model, so a harness
// regression shows up as a spike against the baseline instead of being lost in the aggregate. ---

export type ToolErrorSession = { events: import('../types.ts').SessionEvent[]; model?: string };

export type ToolErrorBaseline = {
  tool: string;
  model: string;
  calls: number;
  errors: number;
  rate: number;
  byCategory: Partial<Record<ToolErrorCategory, number>>;
};

const sessionModelOf = (events: import('../types.ts').SessionEvent[]): string => {
  for (const e of events) if (e.kind === 'session') return (e as { model: string }).model;
  return 'unknown';
};

// Per-tool, per-model error baseline from a set of sessions.
export function toolErrorBaselines(sessions: ToolErrorSession[]): ToolErrorBaseline[] {
  const map = new Map<string, { tool: string; model: string; calls: number; errors: number; byCategory: Partial<Record<ToolErrorCategory, number>> }>();
  for (const s of sessions) {
    const model = s.model ?? sessionModelOf(s.events);
    const toolOf = new Map<string, string>();
    for (const e of s.events) {
      if (e.kind === 'assistant') {
        for (const b of (e as { blocks: { type: string; callId?: string; id: string; name: string }[] }).blocks) {
          if (b.type === 'tool_use') toolOf.set(b.callId ?? b.id, b.name);
        }
      } else if (e.kind === 'tool_result') {
        const tr = e as { callId: string; output: ClassifiableToolResult; status?: string };
        const tool = toolOf.get(tr.callId) ?? 'unknown';
        const key = `${tool}\u0000${model}`;
        const row = map.get(key) ?? { tool, model, calls: 0, errors: 0, byCategory: {} };
        row.calls++;
        const cat = classifyToolError(tr.output, tr.status);
        if (cat !== 'none') {
          row.errors++;
          row.byCategory[cat] = (row.byCategory[cat] ?? 0) + 1;
        }
        map.set(key, row);
      }
    }
  }
  return [...map.values()]
    .map((r) => ({ ...r, rate: r.calls ? r.errors / r.calls : 0 }))
    .sort((a, b) => b.errors - a.errors || b.calls - a.calls);
}

export type ToolErrorAnomaly = {
  tool: string;
  model: string;
  baselineRate: number;
  currentRate: number;
  baselineCalls: number;
  currentCalls: number;
  currentErrors: number;
};

// Compare a current batch of sessions against a baseline; flag (tool, model) pairs whose error rate rose
// beyond `threshold` times the baseline (and at least `minErrors` errors), so a harness regression surfaces.
export function detectToolErrorAnomalies(
  baseline: ToolErrorBaseline[],
  current: ToolErrorSession[],
  opts: { threshold?: number; minErrors?: number } = {},
): ToolErrorAnomaly[] {
  const threshold = opts.threshold ?? 2;
  const minErrors = opts.minErrors ?? 3;
  const cur = toolErrorBaselines(current);
  const baseMap = new Map(baseline.map((b) => [`${b.tool}\u0000${b.model}`, b]));
  const out: ToolErrorAnomaly[] = [];
  for (const c of cur) {
    if (c.errors < minErrors) continue;
    const b = baseMap.get(`${c.tool}\u0000${c.model}`);
    const baseRate = b?.rate ?? 0;
    const baseCalls = b?.calls ?? 0;
    // Spike: current rate above threshold*baseline, and not just noise on a zero baseline.
    const spiked = baseCalls > 0 ? c.rate > baseRate * threshold : c.rate > 0.25;
    if (!spiked) continue;
    out.push({
      tool: c.tool,
      model: c.model,
      baselineRate: baseRate,
      currentRate: c.rate,
      baselineCalls: baseCalls,
      currentCalls: c.calls,
      currentErrors: c.errors,
    });
  }
  return out.sort((a, b) => b.currentRate - a.currentRate);
}
