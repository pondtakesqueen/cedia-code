---
name: improve-agent
description: Run a product-level continuous improvement loop on an agent (coding or otherwise): collect execution traces, classify recurring failures with evidence, turn them into repeatable eval cases, experiment on harness changes, and verify before deploy. Use when the user asks to "improve the agent", "find why it fails in production", "mine failures", "build a feedback loop", or wants to apply Cursor-style self-improvement to cedia or another agent.
argument-hint: [trace source: thread ids | session logs | eval results]
---

You are turning production failures into the next version of the agent. This is product-level improvement, not task-level self-correction: nothing carries across future sessions unless something in the system (instructions, tools, context retrieval, memory, or model weights) actually changes.

## 0. Pick the evidence source

- cedia threads/sessions: `~/.cedia/projects/<slug>/threads/*.jsonl` and the session logs they name. Read with `cedia threads list`, `cedia threads show <id>`, `cedia usage --thread <id>`.
- Eval runs: `evals/results/*.jsonl`, plus `evals/gate` baselines.
- For other agents: whatever trace store exists (requests, tool calls, tool results, final outcome).

Read traces first. Do not invent failures.

## 1. Collect traces with enough fields

For every session record: what the user asked, what the agent did, each tool call (name + input), each tool result (output + error), how the interaction ended, and any follow-up user message. cedia's JSONL already has all of this (assistant events, tool_result events, turn_end reason). A run's `HeadlessResult` and `cedia usage` summarize spend and cache misses.

## 2. Classify failures with evidence, not vibes

Group by concrete signals, each tied to a trace:

- **Tool failures**: classify each failed tool call into one of `InvalidArguments` (model misused the tool), `UnexpectedEnvironment` (harness assumption broke for this repo), `ProviderError` (upstream), `Timeout` (slow/inefficient op), `UserAborted`. Baseline per tool and per model; flag a spike against the baseline as a regression.
- **Outcome failures**: the agent claimed done but the user's follow-up contradicts it ("still broken", repeated request, "undo"). Use a small judge model (reuse cedia's goal-judge pattern: fresh read-only session, verdict `met / not met (what's missing) / impossible`, unsure counts as not met).
- **Retention failures**: code the agent wrote that the user deleted/rewrote shortly after (Keep Rate). In cedia, compare the run's diff against `git` state N runs/commits later, or against `threads undo`.

Never trust the evaluator's explanation alone — ground each classification in the actual tool output or diff.

## 3. Turn recurring failures into eval cases

A failure that repeats becomes a task in `evals/tasks/` (or your eval suite) with a known-correct answer, so it is reproducible. Example: "agent edits wrong file" → a repo + task with one correct target file. Run the existing agent, record baseline, then experiment.

## 4. Experiment on the harness, one change at a time

Candidate levers (in order of cheapness): system prompt wording, tool description/schema, context retrieval (what is sent upfront vs fetched), guardrails added or removed, model-specific formats (patch vs string-replace), prompt fragments for known pathologies (e.g. "context anxiety"). Run the eval suite, compare to baseline. Reject changes that help one category and hurt another unless the gate accepts.

cedia's eval gate (`bun evals/gate.ts`) is the comparison harness: it refuses regressions and requires a reason for accepting one.

## 5. Verify with real-usage signals before deploy

Offline evals cannot stand in for users. Check Keep Rate, satisfaction verdicts, tool-error baselines, latency, token efficiency, cache hit rate. A change that passes benchmarks but lowers Keep Rate is a regression.

## 6. Deploy, then monitor

After deploy, watch the same signals. A spike in tool errors or a drop in Keep Rate means roll back or investigate. `cedia usage` surfaces cache misses and costliest tool results, `cedia failures` tool errors by category, and `cedia threads keep-rate <id>` retention.

## Rules

- Change one thing per experiment; record what and why.
- An improvement that only moves numbers without a traceable failure is not an improvement.
- Self-correction inside a task does not count as learning — something must persist (instructions, tool, context process, memory, or weights).
- Do not auto-deploy fixes without a human gate on safety paths (`src/core/safety/`, `src/core/providers/`, sandbox, `src/cli.ts`).

## cedia specifics

- Traces: `~/.cedia/projects/<slug>/threads/*.jsonl` (append-only; `cedia threads`).
- Eval: `evals/run.ts`, `evals/gate.ts`, baselines in `evals/gate/baseline/`.
- Judge model reuse: `core/trust/goal.ts` pattern (read-only session, verdict lines).
- Ratings: `cedia threads rate` (up/down + note) feed eval-case selection.
- Do not edit message 0 / cached prefix mid-session (cache rule).
