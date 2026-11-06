import { describe, expect, test } from 'bun:test';
import { receipt } from '../src/core/run/thread.ts';
import { checkTail, evidence, ledgerEntries } from '../src/core/trust/ledger.ts';
import type { SessionEvent } from '../src/core/types.ts';

describe('what a check showed', () => {
  test("keeps the runner's own outcome lines, not cedia's trailer", () => {
    const bun = 'test/a.test.ts:\n(pass) a\n\n 1110 pass\n 17 skip\n 3 fail\n 4933 expect() calls\nRan 1130 tests across 114 files. [177.79s]\n[exit 1]';
    expect(checkTail(bun)).toBe('1110 pass · 17 skip · 3 fail · Ran 1130 tests across 114 files. [177.79s]');
    expect(checkTail('collected 5 items\n.....\n===== 5 passed in 0.12s =====\n[exit 0]')).toBe('===== 5 passed in 0.12s =====');
    expect(checkTail('running 2 tests\ntest result: ok. 2 passed; 0 failed; 0 ignored')).toBe('running 2 tests · test result: ok. 2 passed; 0 failed; 0 ignored');
  });

  test('falls back to the last two lines, and is empty for a silent check', () => {
    expect(checkTail('$ tsc --noEmit\nsrc/a.ts(3,1): something odd\n[exit 2]')).toBe('$ tsc --noEmit · src/a.ts(3,1): something odd');
    expect(checkTail('(no output)\n[exit 0]')).toBeUndefined();
    expect(checkTail('\n[exit 0]')).toBeUndefined();
  });

  test('is capped', () => {
    const long = Array.from({ length: 10 }, (_, i) => `${i} tests failed: ${'x'.repeat(200)}`).join('\n');
    expect(checkTail(long)!.length).toBeLessThanOrEqual(300);
  });

  test('reaches the evidence and the receipt from the log', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 10, 4, 0, 0, s)).toISOString();
    const events = [
      { id: '1', parentId: null, at: at(0), kind: 'tool_intent', callId: 'c1', tool: 'bash', input: { command: 'bun test' } },
      { id: '2', parentId: '1', at: at(41), kind: 'tool_result', callId: 'c1', status: 'completed', output: { text: ' 12 pass\n 0 fail\n[exit 0]', isError: false, exitCode: 0 } },
    ] as unknown as SessionEvent[];
    const ev = evidence(ledgerEntries(events, ['bun test']));
    expect(ev.checks).toEqual([{ command: 'bun test', exitCode: 0, tail: '12 pass · 0 fail', ms: 41_000 }]);
    expect(receipt(ev)).toBe('cedia receipt: changed none; checks bun test (exit 0: 12 pass · 0 fail, 41s); unverified none');
  });
});
