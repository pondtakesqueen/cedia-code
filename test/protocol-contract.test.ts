import { describe, expect, test } from 'bun:test';
import schema from '../src/protocol/protocol.schema.json';

// The schema states what cedia sends: the prompt suggestion line is a CoreMessage, and nothing claims a client
// sends commands that no part of cedia reads.
describe('protocol contract', () => {
  test('prompt_suggestion is a CoreMessage', () => {
    expect(JSON.stringify((schema as { definitions: Record<string, unknown> }).definitions.CoreMessage)).toContain('prompt_suggestion');
  });
  test('no Command root', () => {
    expect(Object.keys((schema as { roots: Record<string, unknown> }).roots)).not.toContain('Command');
  });
});
