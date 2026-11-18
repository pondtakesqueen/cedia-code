# What reviews of cedia look at

cedia's reviewers (the review after a run, `/review`, `/ultrareview`, `cedia review`) read this file as it was before the change, so a change cannot rewrite it.

- Run the items of `.agents/skills/code-review/checklist.md` whose trigger the diff matches, and name the item in each finding it gives.
- A change that touches `src/core/safety/`, `src/core/providers/`, the sandbox, `scripts/`, CI workflows or `src/cli.ts` needs a person's review whatever its size: say so.
- A finding on code the change did not add is `[Pre-existing]`, not `[Important]`.
