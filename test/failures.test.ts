import { describe, expect, test } from 'bun:test';
import { mineToolFailures, summarizeFailures } from '../src/core/trust/failures.ts';

describe('mineToolFailures', () => {
  test('classifies failed tool results', () => {
    const events = [
      { kind: 'assistant', blocks: [{ type: 'tool_use', id: 'c1', name: 'bash', input: { command: 'rg x' } }] },
      { kind: 'tool_result', callId: 'c1', status: 'failed', output: { text: 'command not found: rg', isError: true } },
      { kind: 'assistant', blocks: [{ type: 'tool_use', id: 'c2', name: 'bash', input: { command: 'sleep 100' } }] },
      { kind: 'tool_result', callId: 'c2', status: 'failed', output: { text: 'timed out', isError: true } },
      { kind: 'assistant', blocks: [{ type: 'tool_use', id: 'c3', name: 'read', input: { path: 'x' } }] },
      { kind: 'tool_result', callId: 'c3', status: 'completed', output: { text: 'ok', isError: false } },
    ] as any;
    const recs = mineToolFailures(events);
    expect(recs.length).toBe(2);
    expect(recs[0]).toMatchObject({ tool: 'bash', category: 'UnexpectedEnvironment' });
    expect(recs[1]).toMatchObject({ tool: 'bash', category: 'Timeout' });
  });
});

describe('summarizeFailures', () => {
  test('groups and sorts by count', () => {
    const recs = [
      { kind: 'tool', tool: 'bash', category: 'Timeout', callId: 'a', detail: '' },
      { kind: 'tool', tool: 'bash', category: 'Timeout', callId: 'b', detail: '' },
      { kind: 'tool', tool: 'read', category: 'UnexpectedEnvironment', callId: 'c', detail: '' },
    ] as any;
    const s = summarizeFailures(recs);
    expect(s[0]).toEqual({ tool: 'bash', category: 'Timeout', count: 2 });
    expect(s[1]).toEqual({ tool: 'read', category: 'UnexpectedEnvironment', count: 1 });
  });
});
