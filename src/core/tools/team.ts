import { TeamStore } from '../project/teams.ts';
import type { ToolSpec } from './registry.ts';

export function teamTool(store: TeamStore, threadId: string): ToolSpec {
  return {
    name: 'team',
    description:
      'A task list shared by the sub-threads of this project, kept outside the session. action create makes a team (name) and returns its id; list shows every team with done/total counts; get returns one team with its tasks as JSON; add puts a task (title, optional assignee) on a team; set-status sets a task\'s status and optionally its assignee. There is no join: a sub-thread uses a team by its id. A read-only session may list and get only.',
    // The task list is shared state outside this session: a read-only session may list and get, not change it.
    effect: 'write_workspace',
    effectOf: (input) => (input.action === 'list' || input.action === 'get' ? 'read' : 'write_workspace'),
    replay: 'unsafe',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'add', 'set-status', 'get'] },
        team: { type: 'string', description: 'Team id (from create or list); needed by get, add and set-status' },
        name: { type: 'string', description: 'Name for a new team (create)' },
        title: { type: 'string', description: 'The task, in a line (add)' },
        taskId: { type: 'string', description: 'Task id (from add or get); needed by set-status' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'] },
        assignee: { type: 'string' },
      },
      required: ['action'],
    },
    run: async (input) => {
      const a = input.action;
      if (a === 'create') {
        const t = store.create((input.name as string | undefined) ?? 'team');
        return { text: `created team ${t.id}: ${t.name}`, isError: false };
      }
      if (a === 'list') {
        const teams = store.list();
        if (!teams.length) return { text: 'no teams', isError: false };
        return { text: teams.map((t) => `${t.id}  ${t.name}  [${t.tasks.filter((x) => x.status === 'done').length}/${t.tasks.length}]`).join('\n'), isError: false };
      }
      if (a === 'get') {
        const t = input.team ? store.get(input.team as string) : undefined;
        if (!t) return { text: 'no such team', isError: true };
        return { text: JSON.stringify(t, null, 2), isError: false };
      }
      if (a === 'add') {
        if (!input.team || !input.title) return { text: 'team and title required', isError: true };
        const task = store.addTask(input.team as string, input.title as string, input.assignee as string | undefined);
        if (!task) return { text: 'no such team', isError: true };
        return { text: `added ${task.id}: ${task.title}`, isError: false };
      }
      if (a === 'set-status') {
        if (!input.team || !input.taskId || !input.status) return { text: 'team, taskId, status required', isError: true };
        const t = store.updateTask(input.team as string, input.taskId as string, { status: input.status as 'pending'|'in_progress'|'done'|'blocked', assignee: input.assignee as string | undefined });
        if (!t) return { text: 'no such team/task', isError: true };
        return { text: `${t.id}: ${t.status}`, isError: false };
      }
      return { text: 'unknown action', isError: true };
    },
  };
}
