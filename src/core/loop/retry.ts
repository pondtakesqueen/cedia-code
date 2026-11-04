import { isRetryable } from '../providers/http.ts';
import type { AttemptError } from '../types.ts';

// What the loop does after an attempt fails: decided from the error, the attempt's number and what was already
// waited, with no I/O, so every path is a table test (test/retry-policy.test.ts). The loop logs, sleeps and
// resends; this says which.
//
// - `strip`: a gateway rejected a beta-gated feature on the first attempt; resend the turn once without it (no
//   effort messages, no role-system mapping, custom headers kept). The loop falls back to deciding again with
//   `stripped` set when the provider has nothing to strip.
// - `quota`: a spent quota said when it comes back and the run may wait for it (quotaWaitMs): sleep one slice of at
//   most recheckMs, then send again, so a lifted limit ends the wait early. Slices do not use up retries; the
//   ceiling bounds the total, and the last slice is cut short at it.
// - `wait`: a retryable error; sleep the retry-after, else exponential backoff from baseMs up to capMs.
// - `fail`: not retryable, or the retries (max attempts in all) are spent.
export type RetryDecision = { kind: 'strip' } | { kind: 'quota'; waitMs: number } | { kind: 'wait'; waitMs: number } | { kind: 'fail' };

export type RetryConfig = { max: number; baseMs: number; capMs: number; recheckMs: number; quotaWaitMs?: number };

export function retryDecision(error: AttemptError, at: { n: number; stripped: boolean; quotaWaited: number }, cfg: RetryConfig): RetryDecision {
  if (at.n === 1 && !at.stripped && error.code === 'bad_request' && (error.status === undefined || error.status === 400) && /beta/i.test(error.message)) return { kind: 'strip' };
  const after = error.retryAfterMs;
  const budget = cfg.quotaWaitMs;
  if (error.code === 'quota' && budget !== undefined && after !== undefined && after > 0 && at.quotaWaited < budget) {
    const step = Math.min(after, cfg.recheckMs, budget - at.quotaWaited);
    return step > 0 ? { kind: 'quota', waitMs: step } : { kind: 'fail' };
  }
  if (!isRetryable(error) || at.n >= cfg.max) return { kind: 'fail' };
  return { kind: 'wait', waitMs: after ?? Math.min(cfg.capMs, cfg.baseMs * 2 ** (at.n - 1)) };
}
