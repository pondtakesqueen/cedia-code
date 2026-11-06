# Thorough or turn-saving stop lines on DeepSeek V4.1 Flash

Question: does the turn-saving base prompt (stop once a declared check passes; skip edge cases nobody asked for) cost
an open model passes on hidden-test tasks? mini-swe-agent leads the Hugging Face harness leaderboard (GLM-5.3-Flash,
effort low, Terminal-Bench 2.1 and DeepSWE) with a prompt that asks for a reproduction script, the fix, a rerun and
edge cases before it submits; cedia gives every model without `thorough` the opposite line.

Setup: the frontier suite (`evals/gate/frontier.json`), `openrouter/deepseek-v4.1-flash`, 8 runs a task, 4 at a time,
commit c4985ae plus a one-line patch that forced the thorough prompt (now `--thorough on`). Run sequentially, frugal
first, on 2026-11-06.

| Task | Frugal pass | Thorough pass | Frugal turns / s / $ | Thorough turns / s / $ |
|---|---|---|---|---|
| frontier-cron | 7/8 (1 false done) | 8/8 | 9.8 / 123 / 0.106 | 12.8 / 193 / 0.152 |
| frontier-semver | 7/8 | 7/8 | 9.9 / 258 / 0.214 | 11.2 / 275 / 0.211 |
| hard-redact-bugs | 8/8 | 8/8 | 15.2 / 149 / 0.108 | 14.9 / 220 / 0.153 |
| All | 22/24 (91.7%) | 23/24 (95.8%) | | +21% cost, +30% time |

Reading: one run apart, Fisher p = 1.0, so pass@1 does not separate the two. Tasks passed in all 8 runs went from 1
of 3 to 2 of 3, and the frugal miss on cron was a false done, the failure the done gate exists to stop. Several
semver runs in both arms hit the 300 s task limit. The suite is near the ceiling for this model; the next measurement
needs harder hidden-test tasks (a Terminal-Bench subset through Harbor) before the default changes.

Spend: $0.94 for both arms, about 9 times the gate's token estimate. Raw rows: the project folder
`evals/thorough-vs-frugal-deepseek-flash-2026-11-06/`.
