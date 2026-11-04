import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commandEnv } from './bash.ts';
import { clip, MAX_SHELL_OUTPUT_CHARS, type ToolSpec } from './registry.ts';

// Job: a command that runs apart from the session, so it goes on when the run ends, the session hands off, the
// quota runs out or cedia crashes. Each job is a directory under the project's jobs dir:
//   job.json   what was started: JobRecord
//   log        its stdout and stderr
//   exit       its exit code, written by the wrapper when the command ends (the "did it finish" answer for any
//              later session, the way IntelligenceRegulation's `.done` markers are)
//   stopped    present when a Job stop ended it
// A job whose process is gone with no exit file was killed from outside (a reboot, a kill): `lost`.
// The command runs under the same policy as bash and, when the sandbox is on, inside it. The sandbox's network
// proxy lives in the cedia process, so a sandboxed job has no network once the session that started it is gone.

export type JobRecord = { id: string; thread?: string; command: string; cwd: string; pid: number; startedAt: string };
export type JobState = 'running' | 'exited' | 'stopped' | 'lost';
export type Job = JobRecord & { state: JobState; exitCode?: number; dir: string };

export const jobsDir = (home: string, slug: string) => join(home, 'projects', slug, 'jobs');

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function readJob(dir: string): Job | undefined {
  try {
    const rec = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')) as JobRecord;
    const exitText = existsSync(join(dir, 'exit')) ? readFileSync(join(dir, 'exit'), 'utf8').trim() : undefined;
    const exitCode = exitText !== undefined && /^\d+$/.test(exitText) ? Number(exitText) : undefined;
    const state: JobState = existsSync(join(dir, 'stopped')) ? 'stopped' : exitCode !== undefined ? 'exited' : alive(rec.pid) ? 'running' : 'lost';
    return { ...rec, state, ...(exitCode !== undefined ? { exitCode } : {}), dir };
  } catch {
    return undefined;
  }
}

/** Every job under `root`, newest first. */
export function readJobs(root: string): Job[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((d) => readJob(join(root, d)))
    .filter((j): j is Job => !!j)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

const TAIL_CHARS = 4000;
function tail(dir: string): string {
  const path = join(dir, 'log');
  if (!existsSync(path)) return '';
  const text = readFileSync(path, 'utf8');
  return text.length > TAIL_CHARS ? `[… ${text.length - TAIL_CHARS} earlier characters in ${path}]\n${text.slice(-TAIL_CHARS)}` : text;
}

const stateText = (j: Job) => (j.state === 'exited' ? `exited ${j.exitCode}` : j.state);
const lineOf = (j: Job) => `${j.id}${j.thread ? ` (thread ${j.thread})` : ''}: ${stateText(j)}, started ${j.startedAt}: ${clip(j.command, 200)}`;

export function jobTool(root: string, thread?: string): ToolSpec {
  return {
    name: 'Job',
    description:
      'Run a command in the background, apart from this session: it keeps running when this run ends, hands off or stops, and its output and exit code stay on disk for any later session. Use it for a command that takes minutes (a long test suite, a build, a benchmark) so the work survives you; use bash for a command that finishes in a call. action start runs `command` and returns the job id; status with an id gives its state (running, exited N, stopped, lost) and the end of its output, without an id every job of this project; stop ends a job and what it started. Same permission rules and sandbox as bash; inside the sandbox a job loses its network once the session that started it ends.',
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'status', 'stop'] },
        command: { type: 'string', description: 'start: the command, run with bash in the working directory' },
        id: { type: 'string', description: 'status or stop: the job id' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    effect: 'exec',
    effectOf: (input) => (input.action === 'status' ? 'read' : 'exec'),
    replay: 'unsafe',
    async run(input, ctx) {
      const action = String(input.action ?? '');
      if (action === 'start') {
        const command = String(input.command ?? '').trim();
        if (!command) return { text: 'start needs a command', isError: true };
        const id = `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const dir = join(root, id);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'run.sh'), ctx.wrap ? await ctx.wrap(command) : command);
        // The wrapper leads a session of its own (detached), so it outlives cedia; the exit code is written by
        // rename, so a reader never sees half of it.
        const wrapper = `bash --noprofile --norc ${q(join(dir, 'run.sh'))} > ${q(join(dir, 'log'))} 2>&1 < /dev/null; echo $? > ${q(join(dir, 'exit.tmp'))}; mv ${q(join(dir, 'exit.tmp'))} ${q(join(dir, 'exit'))}`;
        const proc = Bun.spawn(['bash', '--noprofile', '--norc', '-c', wrapper], { cwd: ctx.cwd, env: commandEnv(), stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached: true });
        proc.unref();
        const rec: JobRecord = { id, ...(thread ? { thread } : {}), command, cwd: ctx.cwd, pid: proc.pid, startedAt: new Date().toISOString() };
        writeFileSync(join(dir, 'job.tmp'), JSON.stringify(rec));
        renameSync(join(dir, 'job.tmp'), join(dir, 'job.json'));
        return { text: `started job ${id}; its output goes to ${join(dir, 'log')}. Check it with Job status.`, isError: false };
      }
      if (action === 'status') {
        if (!input.id) {
          const all = readJobs(root);
          return { text: all.length ? all.map(lineOf).join('\n') : 'no jobs', isError: false };
        }
        const j = readJob(join(root, String(input.id)));
        if (!j) return { text: `no job ${String(input.id)}`, isError: true };
        const out = tail(j.dir);
        return { text: clip(`${lineOf(j)}\n${out || '(no output yet)'}`, MAX_SHELL_OUTPUT_CHARS), isError: false };
      }
      if (action === 'stop') {
        const j = readJob(join(root, String(input.id ?? '')));
        if (!j) return { text: `no job ${String(input.id ?? '')}`, isError: true };
        if (j.state !== 'running') return { text: `${j.id} is not running: ${stateText(j)}`, isError: false };
        writeFileSync(join(j.dir, 'stopped'), new Date().toISOString());
        try {
          process.kill(-j.pid, 'SIGTERM');
        } catch {}
        return { text: `stopped ${j.id}`, isError: false };
      }
      return { text: `unknown action ${action}: use start, status or stop`, isError: true };
    },
  };
}
