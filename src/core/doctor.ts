// `cedia doctor`: one read-only pass over versions, user settings, MCP config and the sandbox. Pure data out; cli.ts prints it (text and --json), and the TUIs can adopt it instead of
// their inline copies. Nothing here starts a server or touches the network.
import { existsSync } from 'node:fs';
import { cediaHome, readSettings, settingsPath, sharedSkillDirs } from './config.ts';
import { HOOK_EVENTS, type Hooks } from './hooks.ts';
import { skillProblems, type SkillProblem } from './skills/skills.ts';
import { listMcp } from './mcp/manage.ts';
import { versionInfo } from '../protocol/version.ts';

export type TierStatus = { present: boolean; ok: boolean; error?: string };

const tier = (present: boolean, load: () => unknown): TierStatus => {
  if (!present) return { present: false, ok: true };
  try {
    load();
    return { present: true, ok: true };
  } catch (e) {
    return { present: true, ok: false, error: (e as Error).message };
  }
};

export type DoctorReport = {
  version: string;
  protocol: string;
  bun: string;
  home: string;
  cwd: string;
  settings: { user: TierStatus };
  sandbox: { available: boolean; tool: string | null };
  mcp: { servers: { name: string; error?: string }[] };
  // Skill folders that do not load and skills a same-named one hides: loading skips both without a word.
  skills: { broken: SkillProblem[]; shadowed: { name: string; path: string; by: string }[] };
  // Hooks whose `match` names no tool cedia has, so they never run (a Claude Code `Bash(...)` rule, a typo).
  hooks: { unmatched: { event: string; match: string; reason: string }[] };
};

// The tools a hook's `match` (or an allow or deny rule) can name. MCP tools are `mcp__<server>__<tool>`.
export const RULE_TOOLS = ['read', 'grep', 'edit', 'write', 'bash', 'sleep', 'NotebookEdit', 'ToolSearch', 'Monitor', 'Job', 'spawn', 'team', 'threads', 'read_thread', 'message_thread', 'recall', 'web_fetch', 'plugin', 'skill', 'remember', 'forget', 'revise', 'ask_user', 'browser', 'schedule', 'open_thread', 'todo', 'mcp_call'];

// Hooks whose match can never fire: the tool it names is not one cedia has (case counts: `Bash` is not `bash`).
export function unmatchedHooks(hooks: Hooks): DoctorReport['hooks']['unmatched'] {
  const out: DoctorReport['hooks']['unmatched'] = [];
  for (const event of HOOK_EVENTS)
    for (const h of hooks[event] ?? []) {
      if (!h.match) continue;
      const tool = /^([\w-]+)(?:\(.*\))?$/.exec(h.match.trim())?.[1];
      if (!tool) out.push({ event, match: h.match, reason: 'not a rule: write a tool name, or tool(pattern)' });
      else if (!tool.startsWith('mcp__') && !RULE_TOOLS.includes(tool)) {
        const near = RULE_TOOLS.find((t) => t.toLowerCase() === tool.toLowerCase());
        out.push({ event, match: h.match, reason: `no tool is named ${tool}${near ? `; did you mean ${near}?` : ''}` });
      }
    }
  return out;
}

export function doctorReport(cwd: string, home = cediaHome()): DoctorReport {
  const info = versionInfo();
  const readUserSettings = () => readSettings(settingsPath(home));
  const tool = Bun.which('bwrap') ?? Bun.which('sandbox-exec') ?? null;
  let servers: DoctorReport['mcp']['servers'] = [];
  try {
    servers = listMcp().servers.map((s) => ({ name: s.name, ...('error' in s && typeof s.error === 'string' ? { error: s.error } : {}) }));
  } catch {
    servers = [];
  }
  return {
    version: info.version,
    protocol: info.protocol,
    bun: Bun.version,
    home,
    cwd,
    settings: {
      user: tier(existsSync(settingsPath(home)), readUserSettings),
    },
    sandbox: { available: tool !== null, tool },
    mcp: { servers },
    skills: skillProblems(cwd, home, sharedSkillDirs()),
    hooks: { unmatched: (() => {
      try {
        return unmatchedHooks((readUserSettings() as { hooks?: Hooks }).hooks ?? {});
      } catch {
        return [];
      }
    })() },
  };
}
