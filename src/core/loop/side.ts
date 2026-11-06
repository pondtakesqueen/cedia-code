import { loadPolicy, loadPrivacy } from '../config.ts';
import { READ_ONLY_SYSTEM } from '../prompts.ts';
import { providerFor } from '../providers/index.ts';
import { fauxScript } from '../providers/faux.ts';
import type { Policy } from '../safety/policy.ts';
import { SessionLog, sessionPath } from '../session/log.ts';
import { CORE_TOOLS } from '../tools/index.ts';
import type { ToolSpec } from '../tools/registry.ts';
import type { Effort, HeadlessResult, ModelSpec, SessionEvent } from '../types.ts';
import { runPrompt } from './run.ts';

// A side session: one prompt, answered in a session of its own, beside the user's run. A commit message, a review,
// a change guide, an inline edit, a completion, a prompt suggestion and memory consolidation are each one. Each is
// logged like any session (so `cedia usage` counts it) and runs on the faux script when CEDIA_FAUX_SCRIPT is set.
//
// What it may touch is one of three:
// - `read-only`: the core tools that do not write the workspace, the repo's policy forced to read-only, and the
//   read-only system prompt unless the caller gives one. The rule that a side review changes nothing lives here.
// - `none`: no tools at all; the answer is the reply's text.
// - `tools`: the caller's own tools under the caller's policy (memory consolidation's remember tool).
export type SideAccess =
  | { kind: 'read-only'; policy?: { allow?: string[]; deny?: string[]; unlock?: string[] } }
  | { kind: 'none' }
  | { kind: 'tools'; tools: ToolSpec[]; permission: Policy };

export type SideSession = {
  cwd: string;
  model: ModelSpec;
  role: string;
  access: SideAccess;
  prompt: string;
  // Required unless access is read-only.
  system?: string;
  maxTurns: number;
  maxTokens?: number;
  effort?: Effort;
  privacy?: string;
  signal?: AbortSignal;
  // cedia's home for the session's log; the default home when absent.
  home?: string;
  onEvent?: (e: SessionEvent) => void;
};

// The tools, permission and system a side session gets, for `access`.
export function sideAccess(cwd: string, access: SideAccess, system?: string): { tools: ToolSpec[]; permission?: Policy; system: string } {
  if (access.kind === 'read-only') {
    const p = access.policy ?? {};
    return {
      tools: CORE_TOOLS.filter((t) => t.effect !== 'write_workspace'),
      permission: { ...loadPolicy(cwd, { allow: p.allow ?? [], deny: p.deny ?? [], unlock: p.unlock ?? [] }), mode: 'read-only' },
      system: system ?? READ_ONLY_SYSTEM,
    };
  }
  if (system === undefined) throw new Error(`a side session with access ${access.kind} needs a system prompt`);
  return access.kind === 'none' ? { tools: [], system } : { tools: access.tools, permission: access.permission, system };
}

export async function runSide(s: SideSession): Promise<HeadlessResult> {
  const id = crypto.randomUUID();
  const log = SessionLog.create({ id, path: s.home ? sessionPath(s.cwd, id, s.home) : sessionPath(s.cwd, id) });
  if (s.onEvent) log.listeners.push(s.onEvent);
  const { tools, permission, system } = sideAccess(s.cwd, s.access, s.system);
  return runPrompt(
    {
      log,
      provider: providerFor(s.model, { fauxScript: fauxScript() }),
      model: s.model,
      tools,
      system,
      cwd: s.cwd,
      role: s.role,
      ...(permission ? { permission } : {}),
      privacy: loadPrivacy(s.cwd, s.privacy),
      maxTurns: s.maxTurns,
      ...(s.maxTokens ? { maxTokens: s.maxTokens } : {}),
      ...(s.effort ? { effort: s.effort } : {}),
      ...(s.signal ? { signal: s.signal } : {}),
    },
    s.prompt,
  );
}
