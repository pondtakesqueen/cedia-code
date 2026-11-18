import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hunks, located, srcFiles, stage, summarize, unstage, type Cases, type Row } from '../evals/review-recall/run.ts';

const cases = JSON.parse(readFileSync(join(import.meta.dir, '..', 'evals', 'review-recall', 'cases.json'), 'utf8')) as Cases;

test('every case stages: the fix undoes cleanly at its commit, and each control replays on its parent', () => {
  const ids = [...cases.bugs.map((b) => b.id), ...cases.controls.map((c) => c.id)];
  expect(new Set(ids).size).toBe(ids.length);
  for (const b of cases.bugs) {
    expect(b.key.length).toBeGreaterThan(20);
    const files = srcFiles(b.fix);
    expect(files.length).toBeGreaterThan(0);
    const s = stage(b.fix, b.fix, `${b.fix}^`, files);
    try {
      expect(hunks(s.patch).size).toBeGreaterThan(0);
    } finally {
      unstage(s.dir);
    }
  }
  for (const c of cases.controls) {
    const s = stage(`${c.commit}^`, `${c.commit}^`, c.commit, srcFiles(c.commit));
    try {
      expect(hunks(s.patch).size).toBeGreaterThan(0);
    } finally {
      unstage(s.dir);
    }
  }
}, 60_000);

test('a finding counts as located only on a changed file, within three lines of a hunk', () => {
  const at = hunks('+++ b/src/a.ts\n@@ -10,2 +10,4 @@\n+x\n+++ b/src/b.ts\n@@ -1 +1 @@\n-y\n+z\n');
  expect(at.get('src/a.ts')).toEqual([[10, 13]]);
  expect(located('`src/a.ts:16` drops x', at)).toBe(true);
  expect(located('src/a.ts:17 drops x', at)).toBe(false);
  expect(located('src/c.ts:10 drops x', at)).toBe(false);
  expect(located('no place named', at)).toBe(false);
});

test('the summary gives recall per stage and the false alarms on controls', () => {
  const row = (r: Partial<Row>): Row => ({ id: 'x', kind: 'bug', arm: 'review', model: 'm', costUsd: 0.1, findings: 1, dropped: 0, ...r });
  const s = summarize([row({ raw: true, kept: true, important: false }), row({ raw: true, kept: false, important: false }), row({ kind: 'control', findings: 2 }), row({ error: 'boom' })]);
  expect(s).toContain('recall raw 2/2 (100%), kept 1 (50%), important 0 (0%)');
  expect(s).toContain('controls: 2 findings on 1 clean changes (1 with any)');
  expect(s).toContain('errors 1');
});
