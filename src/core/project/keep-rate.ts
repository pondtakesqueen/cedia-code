// Keep Rate: how much of the code an agent run changed is still in the working tree later.
// cedia records which files each writing call changed (snapshot events' `changed`), so a run's footprint
// is recoverable from its session logs. Retention is then "of those files, how many still exist" — a cheap,
// honest proxy for Cursor's line-level Keep Rate, without needing blame or diff replay.

import type { SessionEvent } from '../types.ts';

export function changedFilesOfEvents(events: SessionEvent[]): string[] {
  const out = new Set<string>();
  for (const e of events) {
    if (e.kind === 'snapshot' && Array.isArray(e.changed)) {
      for (const f of e.changed) if (typeof f === 'string' && f.length) out.add(f);
    }
  }
  return [...out].sort();
}

export type RetentionResult = {
  total: number;
  kept: number;
  rate: number;
  missing: string[];
};

export function retentionOf(baseline: string[], exists: (path: string) => boolean): RetentionResult {
  const missing: string[] = [];
  let kept = 0;
  for (const f of baseline) {
    if (exists(f)) kept++;
    else missing.push(f);
  }
  const total = baseline.length;
  return { total, kept, rate: total === 0 ? 1 : kept / total, missing };
}
