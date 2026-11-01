// Failure mining: turn session logs into grouped, evidence-backed failure records so recurring problems
// can become eval cases. See .agents/skills/improve-agent/SKILL.md and .agents/skills/tool-error-taxonomy/SKILL.md.

import type { SessionEvent } from '../types.ts';
import { classifyToolError } from './tool-errors.ts';

export type FailureRecord = {
  kind: 'tool';
  tool: string;
  category: string;
  callId: string;
  detail: string;
};

export function mineToolFailures(events: SessionEvent[]): FailureRecord[] {
  const toolOf = new Map<string, string>();
  const out: FailureRecord[] = [];
  for (const e of events) {
    if (e.kind === 'assistant') {
      for (const b of e.blocks) {
        if (b.type === 'tool_use') toolOf.set(b.callId ?? b.id, b.name);
      }
    } else if (e.kind === 'tool_result') {
      const category = classifyToolError(e.output, e.status);
      if (category !== 'none') {
        const tool = toolOf.get(e.callId) ?? 'unknown';
        out.push({ kind: 'tool', tool, category, callId: e.callId, detail: (e.output.text ?? '').slice(0, 200) });
      }
    }
  }
  return out;
}

export function summarizeFailures(records: FailureRecord[]): { tool: string; category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of records) {
    const key = `${r.tool}\u0000${r.category}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m]
    .map(([key, count]) => {
      const [tool, category] = key.split('\u0000');
      return { tool: tool ?? 'unknown', category: category ?? 'UnexpectedEnvironment', count };
    })
    .sort((a, b) => b.count - a.count);
}
