// The TUI's slash commands: one list that /help, autocomplete, the palette and the picker all read, so a command
// cannot be offered in one and missing from another. handleCommand in app.tsx runs them; test/tui-ink-commands.test.ts
// checks that every command here has a case there, and the reverse.

export type CommandGroup = 'thread' | 'run' | 'project' | 'view' | 'other';
// `opens`: the command opens a picker or a view with no argument, so accepting it from autocomplete runs it
// at once instead of waiting for another Enter.
export type InkCommand = { name: string; description: string; group: CommandGroup; opens?: true };

export const INK_COMMANDS: readonly InkCommand[] = [
  { name: 'help', description: 'these commands and keys', group: 'other' },
  { name: 'clear', description: 'clear the chat view', group: 'view' },
  { name: 'quit', description: 'leave', group: 'other' },
  { name: 'cost', description: 'spend, context tokens, rate', group: 'view' },
  { name: 'context', description: 'what fills the context: prompt, tools, MCP, history', group: 'view' },
  { name: 'status', description: 'the status line', group: 'view' },
  { name: 'transcript', description: 'show the full transcript', group: 'view' },
  { name: 'search', description: 'search the chat transcript', group: 'view' },
  { name: 'actions', description: 'message actions menu', group: 'view', opens: true },
  { name: 'new', description: 'start a new thread', group: 'thread' },
  { name: 'diff', description: 'working tree changes', group: 'thread' },
  { name: 'undo', description: 'put back the files the last turn changed', group: 'thread' },
  { name: 'redo', description: 'put them forward again', group: 'thread' },
  { name: 'rewind', description: 'go back to before a run', group: 'thread' },
  { name: 'commit', description: 'commit the files this thread changed', group: 'project' },
  { name: 'pr', description: 'push and open a pull request', group: 'project' },
  { name: 'review', description: 'review the uncommitted changes', group: 'project' },
  { name: 'ultrareview', description: 'review the changes or a pull request once per focus, side by side; Esc stops it', group: 'project' },
  { name: 'plan', description: 'send this prompt to the planner first', group: 'run' },
  { name: 'quick', description: 'send this prompt straight to the writer', group: 'run' },
  { name: 'memory', description: 'project memory', group: 'project' },
  { name: 'skills', description: 'skills this session can load', group: 'project' },
  { name: 'mcp', description: 'MCP servers configured', group: 'project' },
  { name: 'fork', description: 'fork a thread', group: 'thread' },
  { name: 'thread', description: 'go on with a thread', group: 'thread' },
  { name: 'model', description: 'the model the next turn runs on', group: 'run', opens: true },
  { name: 'goal', description: 'keep each turn going until a judge finds this holds', group: 'run' },
  { name: 'palette', description: 'command palette', group: 'view', opens: true },
  { name: 'settings', description: 'show the current settings', group: 'view' },
  { name: 'config', description: 'show settings.json', group: 'other' },
  { name: 'rename', description: 'rename this thread', group: 'thread' },
  { name: 'resume', description: 'go on with a thread', group: 'thread' },
  { name: 'branch', description: 'git branches', group: 'view', opens: true },
  { name: 'copy', description: 'copy the last reply', group: 'view' },
  { name: 'tasks', description: 'alias for /agents', group: 'view', opens: true },
  { name: 'agents', description: 'watch this thread\'s sub-threads, even mid-turn (← → between them)', group: 'view', opens: true },
  { name: 'compact', description: 'show handoff/compaction status', group: 'view' },
  { name: 'fast', description: 'toggle fast mode', group: 'run' },
  { name: 'export', description: 'export this thread to a file', group: 'view' },
  { name: 'btw', description: 'ask a side question', group: 'other' },
  { name: 'theme', description: 'the current theme', group: 'view', opens: true },
  { name: 'color', description: 'alias for /theme', group: 'view', opens: true },
  { name: 'doctor', description: 'versions, settings, MCP, sandbox', group: 'view' },
  { name: 'permission', description: 'permission mode', group: 'run', opens: true },
  { name: 'vim', description: 'toggle vim mode', group: 'other' },
  { name: 'hooks', description: 'hooks configured', group: 'other' },
  { name: 'effort', description: 'show or set starting effort', group: 'run' },
  { name: 'output-style', description: 'output style', group: 'other', opens: true },
  { name: 'suggest', description: 'suggest a next prompt', group: 'other' },
  { name: 'trust', description: 'accept trust', group: 'other' },
  { name: 'onboarding', description: 'onboarding status', group: 'other' },
  { name: 'statusline', description: 'run a status line command', group: 'other' },
  { name: 'notify', description: 'tell you when a turn ends while you look away (auto | bell | off)', group: 'other' },
];

export const GROUP_ORDER: readonly CommandGroup[] = ['thread', 'run', 'project', 'view', 'other'];

// What /help lists: each group's commands, in the list's order.
export const helpGroups = (): [CommandGroup, InkCommand[]][] => GROUP_ORDER.map((g) => [g, INK_COMMANDS.filter((c) => c.group === g)]);

// Names handleCommand takes that are not commands a user types: keybinding actions and aliases.
export const KEY_ACTIONS = ['exit', 'historyUp', 'historyDown', 'historySearchUp', 'historySearchDown'] as const;
