import { cediaHome } from '../../core/config.ts';
import { selectSessions } from '../../core/session/select.ts';
import { isUsageEvent, usageReport } from '../../core/session/usage.ts';

export type ProjectUsageSummary = {
  models: { model: string; costUsd: number; requests: number }[];
  sessions: number;
  requests: number;
  tokens: { in: number; cache: number; out: number };
  handoffs: number;
};

/** Per-model spend for the Settings Usage tab, from this project's recent session logs. */
export function loadProjectUsage(cwd: string, home = cediaHome(), limit = 20): ProjectUsageSummary | null {
  try {
    const sessions = selectSessions({ cwd, home, last: limit }).map((s) => ({ ...s, events: s.events.filter(isUsageEvent) }));
    if (!sessions.length) return null;
    const report = usageReport(sessions, {});
    return {
      models: report.models,
      sessions: report.sessions,
      requests: report.requests,
      tokens: { in: report.tokens.input, cache: report.tokens.cacheRead, out: report.tokens.output },
      handoffs: report.handoffs,
    };
  } catch {
    return null;
  }
}
