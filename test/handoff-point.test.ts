import { expect, test } from 'bun:test';
import { handoffDue, handoffFloor } from '../src/core/project/handoff.ts';

// When a session may hand off or compact, from numbers alone.
test('a fresh session must double the part of its first reply a handoff can shrink', () => {
  // 46k first reply, 41k of it system prompt and tools: the floor is 51k, not 92k.
  expect(handoffFloor({ context: 46_000, fixed: 41_000, fromSummary: false, keepTokens: 30_000 })).toBe(51_000);
  // Fixed part counted larger than the reply (chars/4 overcounts): no shrinking below the reply itself.
  expect(handoffFloor({ context: 10_000, fixed: 12_000, fromSummary: false, keepTokens: 30_000 })).toBe(10_000);
});

test('a session that starts from a summary must grow by what a compaction keeps', () => {
  expect(handoffFloor({ context: 50_000, fixed: 41_000, fromSummary: true, keepTokens: 27_000 })).toBe(77_000);
});

test('a point is due past the floor, and a continued session must have changed a file first', () => {
  const at = { size: 95_000, floor: 60_000, continues: false, changedHere: () => false };
  expect(handoffDue(90_000, at)).toBe(true);
  expect(handoffDue(100_000, at)).toBe(false);
  expect(handoffDue(90_000, { ...at, floor: 96_000 })).toBe(false);
  expect(handoffDue(90_000, { ...at, continues: true })).toBe(false);
  expect(handoffDue(90_000, { ...at, continues: true, changedHere: () => true })).toBe(true);
});
