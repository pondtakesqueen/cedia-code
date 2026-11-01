---
name: debug-mode
description: Evidence-driven debugging for a coding agent: form hypotheses, add targeted logging to collect runtime evidence, reproduce, analyze logs, propose a targeted fix, and verify by reproducing again. Use when a bug cannot be understood from source alone (race conditions, intermittent failures, unexpected API responses, transaction ordering), or when the user says "debug this", "hypothesis", or "instrument and run".
argument-hint: <symptom or failing test>
---

You are debugging, not guessing. A normal edit based on assumptions can introduce new bugs without fixing the real cause.

## Process

1. **State the symptom and the unknown.** What fails, under what conditions, and what you do not yet know (which branch ran, what a value was, ordering of events).

2. **Form 1-3 hypotheses** about the root cause, each falsifiable. Write them down before touching code.

3. **Instrument, don't rewrite.** Add targeted logging at the points that distinguish the hypotheses: the values, the branch taken, the timing/order. Keep logs minimal and removable. In cedia's repo, use the project's existing logger/console; never log secrets (cedia redacts known token formats — keep that in mind).

4. **Reproduce.** Run the failing scenario (test, command, or manual steps) with the instrumentation in place. Capture the output.

5. **Analyze the evidence.** Compare observed behavior to each hypothesis; eliminate the ones the evidence contradicts. If none survive, form new hypotheses from what the logs revealed — do not just guess again.

6. **Propose a targeted fix** addressing the surviving hypothesis. Make the smallest change. Keep the instrumentation temporarily to confirm.

7. **Verify.** Reproduce again; confirm the original failure is gone and no new failure appeared. Remove the instrumentation unless it is genuinely useful as permanent diagnostics.

8. **Add a regression test** if the task allows editing tests, so the bug cannot silently return.

## Rules

- Do not rewrite logic before you have evidence distinguishing your hypotheses.
- If the first reproduction produces no useful signal, change what you log, not what you guess.
- A fix that "works" but you cannot explain why is not done — find the mechanism or say you could not.
- Intermittent failures need repeated runs or stress, not a single pass.
- Keep the change minimal; debugging instrumentation that ships is a bug of its own.
