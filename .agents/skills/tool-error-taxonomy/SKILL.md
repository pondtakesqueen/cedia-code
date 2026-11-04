---
name: tool-error-taxonomy
description: Classify tool failures in an agent harness into InvalidArguments, UnexpectedEnvironment, ProviderError, Timeout, and UserAborted; baseline per tool and model; detect anomalies. Use when auditing why an agent's tool calls fail, building usage reports, or adding regression checks to a harness.
argument-hint: [tool results | session logs]
---

Classify every failed tool call into exactly one category, then baseline and monitor.

## Categories

- **InvalidArguments** — the model passed wrong/missing/malformed arguments to a tool. Points to a tool description/schema the model misunderstands, or a model weak spot. Fix: improve the schema/description or add a `repair` (cedia's tool specs already support `repair`).
- **UnexpectedEnvironment** — the harness assumed something about the repo/environment that did not hold (missing binary, wrong cwd, sandbox restriction). Fix: harness code, not the model.
- **ProviderError** — upstream service failure (API, MCP server, LSP). Fix: retry/backoff or provider swap.
- **Timeout** — operation took too long (inefficient search, huge repo, slow command). Fix: better tool implementation or limits.
- **UserAborted** — the user (or a stop hook) cancelled. Not a defect; track separately.

## Procedure

1. Read the tool results (cedia: `tool_result` events in session JSONL; `cedia failures` counts them by tool and category, and `cedia usage` shows tool errors, with `toolErrors` and `toolErrorBaselines` in its JSON).
2. For each failed result, assign a category from the output text + exit code + status. When ambiguous, pick the one that points to the cheapest fix and note the ambiguity.
3. Baseline: compute failure rate per (tool, model) pair. Different tools have different natural rates (search timeout is common in huge repos).
4. Anomaly detection: flag any new harness version / model change that moves a rate beyond its baseline band. This is how regressions surface before users report them.
5. Report: counts by category, worst (tool, model) pairs, and any anomalies. Propose one fix per top category.

## cedia specifics

- Tool results live in session logs as `{ kind: 'tool_result', callId, status, output: { text, isError, exitCode } }`.
- The classifier, baselines and anomaly check live in `src/core/trust/tool-errors.ts`; extend them there.
- Tool specs support `repair` for malformed inputs — use it for `InvalidArguments` before failing.
- Safety paths (`src/core/safety/`, sandbox) are high-risk: a human reviews changes there.
