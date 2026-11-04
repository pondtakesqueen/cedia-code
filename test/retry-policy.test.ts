import { expect, test } from 'bun:test';
import { retryDecision, type RetryConfig } from '../src/core/loop/retry.ts';
import type { AttemptError } from '../src/core/types.ts';

// What the loop does after a failed attempt, decided from the error and the attempt's state alone.
const cfg: RetryConfig = { max: 5, baseMs: 1000, capMs: 30_000, recheckMs: 300_000 };
const err = (code: AttemptError['code'], extra: Partial<AttemptError> = {}): AttemptError => ({ code, message: code, ...extra });
const at = (n: number, extra: { stripped?: boolean; quotaWaited?: number } = {}) => ({ n, stripped: false, quotaWaited: 0, ...extra });

test('a retryable error backs off exponentially up to the cap, then fails after the last retry', () => {
  expect(retryDecision(err('overloaded'), at(1), cfg)).toEqual({ kind: 'wait', waitMs: 1000 });
  expect(retryDecision(err('overloaded'), at(3), cfg)).toEqual({ kind: 'wait', waitMs: 4000 });
  expect(retryDecision(err('overloaded'), at(4), { ...cfg, capMs: 5000 })).toEqual({ kind: 'wait', waitMs: 5000 });
  expect(retryDecision(err('overloaded'), at(5), cfg)).toEqual({ kind: 'fail' });
});

test('a retry-after wins over the backoff', () => {
  expect(retryDecision(err('rate_limit', { retryAfterMs: 7000 }), at(1), cfg)).toEqual({ kind: 'wait', waitMs: 7000 });
});

test('an error that is not retryable fails at once', () => {
  expect(retryDecision(err('auth'), at(1), cfg)).toEqual({ kind: 'fail' });
  expect(retryDecision(err('quota', { retryAfterMs: 60_000 }), at(1), cfg)).toEqual({ kind: 'fail' });
});

test('a spent quota with a retry-after waits in slices up to its ceiling, without using retries', () => {
  const q = { ...cfg, quotaWaitMs: 600_000 };
  expect(retryDecision(err('quota', { retryAfterMs: 3_600_000 }), at(9), q)).toEqual({ kind: 'quota', waitMs: 300_000 });
  expect(retryDecision(err('quota', { retryAfterMs: 3_600_000 }), at(10, { quotaWaited: 450_000 }), q)).toEqual({ kind: 'quota', waitMs: 150_000 });
  expect(retryDecision(err('quota', { retryAfterMs: 3_600_000 }), at(11, { quotaWaited: 600_000 }), q)).toEqual({ kind: 'fail' });
  expect(retryDecision(err('quota', { retryAfterMs: 20_000 }), at(1), q)).toEqual({ kind: 'quota', waitMs: 20_000 });
});

test('a gateway that rejects a beta gets the first attempt resent without it, once', () => {
  const beta = err('bad_request', { status: 400, message: 'unknown beta header' });
  expect(retryDecision(beta, at(1), cfg)).toEqual({ kind: 'strip' });
  expect(retryDecision(beta, at(1, { stripped: true }), cfg)).toEqual({ kind: 'fail' });
  expect(retryDecision(beta, at(2), cfg)).toEqual({ kind: 'fail' });
  expect(retryDecision(err('bad_request', { message: 'unknown beta' }), at(1), cfg)).toEqual({ kind: 'strip' });
  expect(retryDecision(err('bad_request', { status: 422, message: 'beta' }), at(1), cfg)).toEqual({ kind: 'fail' });
});
