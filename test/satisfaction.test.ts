import { describe, expect, test } from 'bun:test';
import { parseSatisfaction, satisfactionPrompt } from '../src/core/trust/satisfaction.ts';

describe('parseSatisfaction', () => {
  test('satisfied', () => {
    expect(parseSatisfaction('SATISFIED\nUser moved on to dashboard.')).toEqual({ verdict: 'satisfied', reason: 'User moved on to dashboard.' });
  });
  test('not satisfied', () => {
    expect(parseSatisfaction('NOT_SATISFIED\nStill getting 401.')).toEqual({ verdict: 'not_satisfied', reason: 'Still getting 401.' });
  });
  test('impossible', () => {
    expect(parseSatisfaction('IMPOSSIBLE\nTask cannot be done with given repo.')).toEqual({ verdict: 'impossible', reason: 'Task cannot be done with given repo.' });
  });
  test('unsure defaults to not satisfied', () => {
    expect(parseSatisfaction('maybe\nnot sure').verdict).toBe('not_satisfied');
  });
  test('empty defaults to not satisfied', () => {
    expect(parseSatisfaction('').verdict).toBe('not_satisfied');
  });
});

describe('satisfactionPrompt', () => {
  test('includes task, report, followup', () => {
    const p = satisfactionPrompt('fix login', 'done', 'looks good');
    expect(p).toContain('fix login');
    expect(p).toContain('done');
    expect(p).toContain('looks good');
  });
});
