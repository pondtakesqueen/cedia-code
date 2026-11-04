import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, READ_ONLY_POLICY } from '../src/core/safety/policy.ts';
import { projectKey } from '../src/core/session/log.ts';
import { jobsDir, jobTool, readJobs } from '../src/core/tools/jobs.ts';

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal }) as any;
const until = async (ok: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok() && Date.now() < end) await Bun.sleep(50);
  return ok();
};

describe('Job: commands that outlive the session', () => {
  test('start runs in the background; status says running, then the exit code and the output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-jobs-'));
    const tool = jobTool(join(dir, 'jobs'), 't-1');
    const started = await tool.run({ action: 'start', command: 'sleep 0.5; echo hi; exit 3' }, ctx(dir));
    expect(started.isError).toBe(false);
    const id = /job (j-[0-9a-z-]+)/.exec(started.text)![1]!;
    expect((await tool.run({ action: 'status', id }, ctx(dir))).text).toContain('running');
    expect(await until(() => readJobs(join(dir, 'jobs')).some((j) => j.id === id && j.exitCode !== undefined))).toBe(true);
    const done = await tool.run({ action: 'status', id }, ctx(dir));
    expect(done.text).toContain('exited 3');
    expect(done.text).toContain('hi');
    // With no id: every job, newest first, each with its thread.
    expect((await tool.run({ action: 'status' }, ctx(dir))).text).toContain(`${id} (thread t-1)`);
  });

  test('a job goes on after the process that started it exits, and its exit code lands on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-jobs-'));
    const jobs = join(dir, 'jobs');
    const src = join(import.meta.dir, '..', 'src', 'core', 'tools', 'jobs.ts');
    const starter = `const { jobTool } = await import(${JSON.stringify(src)}); const r = await jobTool(${JSON.stringify(jobs)}).run({ action: 'start', command: 'sleep 1; echo survived > out.txt' }, { cwd: ${JSON.stringify(dir)}, signal: new AbortController().signal }); console.log(r.text); process.exit(0);`;
    const p = Bun.spawnSync(['bun', '-e', starter], { stdout: 'pipe', stderr: 'pipe' });
    expect(p.exitCode).toBe(0);
    // The starter is gone well before the job ends.
    expect(existsSync(join(dir, 'out.txt'))).toBe(false);
    expect(await until(() => readJobs(jobs)[0]?.exitCode === 0, 8000)).toBe(true);
    expect(readFileSync(join(dir, 'out.txt'), 'utf8')).toBe('survived\n');
  });

  test('stop ends the job and what it started', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-jobs-'));
    const tool = jobTool(join(dir, 'jobs'));
    const id = /job (j-[0-9a-z-]+)/.exec((await tool.run({ action: 'start', command: 'sleep 30 & sleep 30; wait' }, ctx(dir))).text)![1]!;
    const stopped = await tool.run({ action: 'stop', id }, ctx(dir));
    expect(stopped.isError).toBe(false);
    expect(await until(() => readJobs(join(dir, 'jobs'))[0]?.state === 'stopped')).toBe(true);
    expect((await tool.run({ action: 'stop', id: 'j-nope' }, ctx(dir))).isError).toBe(true);
  });

  test('the policy holds start to bash rules and lets status read under read-only', () => {
    const tool = jobTool('/tmp/none');
    expect(decide(READ_ONLY_POLICY, tool, { action: 'status' }, '/tmp').decision).toBe('allow');
    expect(decide(READ_ONLY_POLICY, tool, { action: 'start', command: 'bun test' }, '/tmp').decision).toBe('deny');
    const workspace = { mode: 'workspace' as const, allow: [], deny: ['bash(bun test*)'] };
    expect(decide(workspace, tool, { action: 'start', command: 'bun test' }, '/tmp').decision).toBe('deny');
    expect(decide({ mode: 'workspace', allow: [], deny: [] }, tool, { action: 'start', command: 'git push --force origin main' }, '/tmp').decision).toBe('deny');
  });

  test('--jobs on: the writer starts a job that is still there, with its exit code, after the run ends', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-jobs-'));
    const home = join(dir, 'home');
    const script = join(dir, 'script.json');
    const step = (id: string, input: Record<string, unknown>) => ({ blocks: [{ type: 'tool_use', id, name: 'Job', input }] });
    await Bun.write(script, JSON.stringify([step('j1', { action: 'start', command: 'sleep 0.5; echo later' }), { blocks: [{ type: 'text', text: 'started it' }] }]));
    const BIN = join(import.meta.dir, '..', 'bin', 'cedia');
    const p = Bun.spawnSync([BIN, '-m', 'faux', '--cwd', dir, '-p', 'run the slow thing', '--output-format', 'json', '--permission', 'workspace', '--sandbox', 'off', '--jobs', 'on'], { env: { ...process.env, CEDIA_FAUX_SCRIPT: script, CEDIA_HOME: home }, stdin: 'ignore' });
    expect(p.exitCode).toBe(0);
    const root = jobsDir(home, projectKey(dir));
    const [job] = readJobs(root);
    expect(job).toMatchObject({ command: 'sleep 0.5; echo later', thread: JSON.parse(p.stdout.toString()).thread });
    expect(await until(() => readJobs(root)[0]?.exitCode === 0)).toBe(true);
    expect(readFileSync(join(job!.dir, 'log'), 'utf8')).toBe('later\n');
  });
});
