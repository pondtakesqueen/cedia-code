# Eval results

Only the write-ups live in git: one `README.md` per experiment folder, which the code comments cite as evidence.
The raw output of a run (`.jsonl`, `.diff`, `.log`, judge verdicts, generated scripts) stays local and is ignored
by `.gitignore`. A baseline worth keeping goes in `evals/baseline/` or `evals/gate/baseline/`.

## Raw files up to 2026-11-04

The raw files committed before this folder was trimmed (about 1,690 files) are still in git history. To get them back:

```bash
git checkout eddca92 -- evals/results      # or: git archive eddca92 evals/results | tar -x
```

The same files are also packed as `cedia-eval-results-eddca92.tar.gz` (7 MB) in the project folder.

The test fixtures `test/score.test.ts` reads were copied from here to `test/fixtures/evals/`.
