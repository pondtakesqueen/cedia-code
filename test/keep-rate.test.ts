import { describe, expect, test } from 'bun:test';
import { changedFilesOfEvents, retentionOf } from '../src/core/project/keep-rate.ts';

describe('changedFilesOfEvents', () => {
  test('collects unique changed files from snapshot events', () => {
    const events = [
      { kind: 'snapshot', tree: 'a', changed: ['src/x.ts', 'src/y.ts'] },
      { kind: 'snapshot', tree: 'b', changed: ['src/y.ts', 'src/z.ts'] },
    ] as any;
    expect(changedFilesOfEvents(events)).toEqual(['src/x.ts', 'src/y.ts', 'src/z.ts']);
  });

  test('ignores non-snapshot events', () => {
    const events = [{ kind: 'tool_result', output: { text: 'ok', isError: false } }] as any;
    expect(changedFilesOfEvents(events)).toEqual([]);
  });
});

describe('retentionOf', () => {
  test('all kept', () => {
    const r = retentionOf(['a.ts', 'b.ts'], () => true);
    expect(r).toEqual({ total: 2, kept: 2, rate: 1, missing: [] });
  });

  test('partial', () => {
    const r = retentionOf(['a.ts', 'b.ts'], (p) => p === 'a.ts');
    expect(r).toEqual({ total: 2, kept: 1, rate: 0.5, missing: ['b.ts'] });
  });

  test('empty baseline is full retention', () => {
    const r = retentionOf([], () => false);
    expect(r).toEqual({ total: 0, kept: 0, rate: 1, missing: [] });
  });
});
