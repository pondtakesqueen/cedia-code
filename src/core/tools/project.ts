import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { ProjectRequest, Question } from '../types.ts';
import type { ToolSpec } from './registry.ts';

// add_project: the writer asks the desktop to add a folder as one of the owner's projects, made first when it is
// new, and to carry this chat over to it. Nothing is written here: like ask_user, the call ends the run and the
// thread waits as `asking`, its question carrying the request. The desktop shows the owner what would change, and
// only on their yes does it make the folder, add it to its projects (its own `desktop` key, which cedia never
// writes) and, for a carry, run `cedia threads carry`. The answer comes back as the thread's next prompt, unless
// the chat was carried, which ends this thread. Present only when the client says it carries such requests out
// (`--desktop on`), on a writer session of a thread.

export const PROJECT_TOOL = 'add_project';
export const ALLOW = 'Allow';
export const DENY = 'Deny';

const DESCRIPTION = `Ask the owner to add a folder to the desktop app as one of their projects, and optionally to carry this chat over to it. Use it only when the owner asked for a project to be made or added, or for this chat to move to one. The call ends this run: the app shows the owner a card with exactly what would change, and nothing changes unless they allow it.

- path: the folder, absolute or starting with ~/. With create, it must not exist yet; the app makes it and runs git init there.
- carry: the owner asked for this chat to go on in that project. On their yes a new thread opens there with a recap of this one, and this thread is archived.

The owner's answer arrives as the next message of this thread. If they allowed a carry, this thread ends there instead and the chat goes on in the new project.`;

const SCHEMA: ToolSpec['schema'] = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'The project folder: absolute, or starting with ~/' },
    create: { type: 'boolean', description: 'The folder is new: make it and run git init there (default false)' },
    carry: { type: 'boolean', description: 'Carry this chat over to the project (default false)' },
    why: { type: 'string', description: 'One sentence for the owner: what they asked for that this does' },
  },
  required: ['path', 'why'],
  additionalProperties: false,
};

const ASKED = { text: 'Asked. This run ends after this turn; the owner sees what would change, and their answer arrives as the next message of this thread (unless they allow a carry, which moves the chat to the new project).', isError: false };

// Where `path` points, with ~/ for the home folder; the real path of the part that exists, so a symlink cannot
// smuggle a forbidden folder past the checks below.
function expand(path: string, home: string): string | undefined {
  const raw = path.trim();
  const full = raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw;
  if (!isAbsolute(full)) return undefined;
  const abs = resolve(full);
  if (existsSync(abs)) return realpathSync(abs);
  const parent = dirname(abs);
  return existsSync(parent) ? join(realpathSync(parent), abs.slice(parent.length + 1)) : abs;
}

const within = (dir: string, path: string) => {
  const r = relative(dir, path);
  return r === '' || (!r.startsWith('..') && !isAbsolute(r));
};

// The request a call makes, or why it cannot be made. `home` and `cediaHome` are injectable for tests.
export function projectRequestOf(input: Record<string, unknown>, opts: { home?: string; cediaHome: string; cwd: string }): ProjectRequest | string {
  const home = opts.home ?? homedir();
  if (typeof input.path !== 'string' || !input.path.trim()) return 'path is required';
  if (typeof input.why !== 'string' || !input.why.trim()) return 'why is required';
  for (const k of ['create', 'carry'] as const) if (input[k] !== undefined && typeof input[k] !== 'boolean') return `${k} must be true or false`;
  const path = expand(input.path, home);
  if (!path) return `path must be absolute or start with ~/: ${input.path}`;
  const create = input.create === true;
  const carry = input.carry === true;
  if (path === '/' || path === home) return `${path} is too wide to be a project; name a folder inside it`;
  const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
  if (within(real(opts.cediaHome), path)) return `${path} is inside cedia's own folder, which is never a project`;
  if (create) {
    if (existsSync(path)) return `${path} already exists; leave out create to add it`;
    if (!existsSync(dirname(path)) || !statSync(dirname(path)).isDirectory()) return `${dirname(path)} does not exist; create makes one folder, not its parents`;
  } else if (!existsSync(path) || !statSync(path).isDirectory()) return `${path} is not a folder; set create to make it`;
  if (carry && existsSync(opts.cwd) && real(opts.cwd) === path) return 'this chat is already in that folder';
  return { kind: 'project', path, create, carry, why: input.why.trim() };
}

// The question the thread waits on: what would change, in the owner's terms, with the writer's reason.
export function projectQuestion(r: ProjectRequest): Question {
  const what = r.create ? `Create ${r.path} (a new git repository) and add it as a project` : `Add ${r.path} as a project`;
  return { question: `${what}${r.carry ? ', and carry this chat over to it' : ''}?\n\n${r.why}`, options: [ALLOW, DENY], request: r };
}

export function projectTool(opts: { cediaHome: string; cwd: string; home?: string }): ToolSpec {
  return {
    name: PROJECT_TOOL,
    description: DESCRIPTION,
    schema: SCHEMA,
    effect: 'read',
    replay: 'safe',
    asks(input) {
      const r = projectRequestOf(input, opts);
      return typeof r === 'string' ? undefined : projectQuestion(r);
    },
    async run(input) {
      const r = projectRequestOf(input, opts);
      return typeof r === 'string' ? { text: r, isError: true } : ASKED;
    },
  };
}
