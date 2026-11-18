# Reliability checklist

Read the diff, then run only the items whose trigger it matches (usually 3 to 10). Each item has a trigger you can
read from the diff, the check, and the incident or rule it comes from. A finding from an item names the item.

Adding an item: the same miss must show in at least two PRs (or one incident plus a rule in AGENTS.md or SPEC.md),
and the trigger must be readable from a diff. Prune an item when its trigger has not matched in three months or a
test now enforces it; say so in the PR that removes it.

| # | Trigger (in the diff) | Check | Source |
|---|---|---|---|
| 1 | Anything that builds the system prompt, tool schemas, tool descriptions or message 0 (`src/core/prompts.ts`, a tool's `description`/`schema`, `context/build.ts`) | The cached prefix stays byte-identical across turns and across a thread's runs: nothing per-turn (time, counts, paths that change) lands in it. `test/` has a prefix-stability test that covers the new input. | SPEC "Cache rules"; 14e7593, 49aba70 |
| 2 | A new or changed path that ends a turn, aborts, denies or skips a tool call (`loop/run.ts`, `runTools`, a guard) | Every `tool_use` still gets a `tool_result`, including denied and `not_started` calls, on every exit path (abort between two calls of one reply included). | AGENTS.md; c7fb551 |
| 3 | Text that reaches the model from somewhere cedia did not write (a file, a diff, a hook, a sub-thread report, a web page) | It is logged as an event first, and framed with `inert()`; a new frame tag joins `FRAME_TAGS` (`trust/frame.ts`), or text inside can close the frame. | AGENTS.md "model-visible means logged"; this branch's `review_guide` |
| 4 | `Bun.spawn`, `spawnSync`, `execFile` or `gitSync` of a program cedia runs itself | It gets `ownEnv()` (or `scrubbedEnv()` for the model's commands), never `process.env` whole, so a repo hook or credential helper cannot read provider keys. | ff7a962 |
| 5 | A change to `safety/shell.ts`, `checkReadOnly`, `simpleCommands` or a deny-list entry | Try the bypass forms: backslash-escaped flags (`sed \-i`), bundled short flags (`sort -uo`), quotes around the dangerous part, aliases (`git -c alias.x=...`), `bash -c`/`env -S` wrappers. The property tests in `test/shell-properties.test.ts` still pass. | 096cc38, 9d86871, 9a0cc78 |
| 6 | A tool that takes a path, or the policy's path handling | The policy and the tool resolve the path the same way (`toolPath`): `~`, `..`, symlinks created earlier in the same reply, and a directory above a credential store for tools that read a tree. | 3c26a2b, b29d165, 193f093 |
| 7 | A name or id from the model or a repository joined into a filesystem path (plugins, teams, skills, profiles) | It is one path segment of the expected shape; `../x` cannot reach outside the store. | 7bd0706 |
| 8 | A change to a type in `src/protocol/` or one it re-exports (`CommitDraft`, `CodeFinding`, a headless result field) | `bun scripts/protocol-schema.ts` was run and `protocol.schema.json` is in the diff; a run whose output changed also ran `bun scripts/session-fixtures.ts`. | 2715481, a35db4d |
| 9 | Settings read or written outside `config.ts`'s helpers | A file that fails to parse is never replaced with `{}`; writes go through `checkSettings`. | 47ff2b1 |
| 10 | Something that listens on a port or accepts requests (`serve`, a daemon, a preview) | Loopback only and a token, and the runs it starts keep the sandbox. | 999ac89 |
| 11 | A tool or loop step that waits (sleep, Monitor, a watch, a child process) or holds output | It ends on the abort signal, and what it keeps in memory and returns is bounded (spill file for the rest). | 3e86ee0 |
| 12 | Review, goal or plan steps, or anything they read | A judge never reads what the change under judgment could rewrite: instructions and REVIEW.md come from before the writer (or HEAD), checks from `.cedia/` or the owner. Findings outside the diff go through `verifyFindings`. | 386647f, 6bc29b9, c53c36c |
| 13 | A git command cedia runs, or a deny-list change for git | Hooks, fsmonitor and `-C` outside the workspace are handled by `gitSync`; commands that delete, move or rewrite refs are refused (`drop-refs`). | f401ff4, this branch's `movesBranch` |
| 14 | A user-visible change (a flag, a default, output a user reads) | One line under `## Unreleased` in `CHANGELOG.md`, and `docs/CLI.md` when a command or flag changed. | CONTRIBUTING.md |
