import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

// Every git command cedia runs on its own (not the model's bash) goes through gitSync, hardened the same way:
// - core.fsmonitor=false: a repository's config can name a program git runs on status and diff (fsmonitor), and
//   cedia reads repositories it was only pointed at.
// - GIT_TERMINAL_PROMPT=0: a command that needs credentials fails instead of waiting on a prompt nobody sees.
// Options turn on what only some callers need: `locks: false` (--no-optional-locks) for looks that must never
// take the index lock from under the user, `literal` (GIT_LITERAL_PATHSPECS) where paths are data, and
// `hooks: false` (core.hooksPath=/dev/null) where the repository's hooks must not run.
export type GitOptions = { locks?: false; literal?: true; hooks?: false; input?: string; timeout?: number };

export function gitSync(cwd: string, args: string[], opts: GitOptions = {}): SpawnSyncReturns<string> {
  const pre = ['-c', 'core.fsmonitor=false', ...(opts.hooks === false ? ['-c', 'core.hooksPath=/dev/null'] : []), ...(opts.locks === false ? ['--no-optional-locks'] : [])];
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.literal ? { GIT_LITERAL_PATHSPECS: '1' } : {}) };
  return spawnSync('git', [...pre, ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env, ...(opts.input !== undefined ? { input: opts.input } : {}), ...(opts.timeout ? { timeout: opts.timeout } : {}) });
}
