import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctorReport, unmatchedHooks } from '../src/core/doctor.ts';

const skill = (home: string, dir: string, text: string) => {
  mkdirSync(join(home, 'skills', dir), { recursive: true });
  writeFileSync(join(home, 'skills', dir, 'SKILL.md'), text);
};

test('doctor lists skill folders that do not load and a skill a same-named one hides', () => {
  const home = mkdtempSync(join(tmpdir(), 'cedia-doctor-home-'));
  const cwd = mkdtempSync(join(tmpdir(), 'cedia-doctor-cwd-'));
  skill(home, 'good', '---\nname: good\ndescription: Does a thing.\n---\nbody');
  skill(home, 'bare', 'no front matter here');
  skill(home, 'quiet', '---\nname: quiet\n---\nbody');
  skill(home, 'twin', '---\nname: good\ndescription: Same name.\n---\nbody');
  mkdirSync(join(home, 'skills', 'empty'));
  const r = doctorReport(cwd, home);
  const broken = Object.fromEntries(r.skills.broken.map((b) => [b.path.split('/').at(-1), b.error]));
  expect(broken.bare).toContain('no front matter');
  expect(broken.quiet).toContain('no description');
  expect(broken.empty).toBe('no SKILL.md');
  expect(broken.good).toBeUndefined();
  expect(r.skills.shadowed).toHaveLength(1);
  expect(r.skills.shadowed[0]!.name).toBe('good');
});

test('a hook whose match names no tool is listed, with the tool it likely meant', () => {
  const got = unmatchedHooks({
    preToolUse: [
      { command: ['/bin/true'], match: 'Bash(git commit*)' },
      { command: ['/bin/true'], match: 'edit(src/*)' },
      { command: ['/bin/true'], match: 'mcp__github__create_issue' },
      { command: ['/bin/true'], match: 'webfetch' },
      { command: ['/bin/true'] },
    ],
    postToolUse: [{ command: ['/bin/true'], match: 'Write' }],
  });
  expect(got).toEqual([
    { event: 'preToolUse', match: 'Bash(git commit*)', reason: 'no tool is named Bash; did you mean bash?' },
    { event: 'preToolUse', match: 'webfetch', reason: 'no tool is named webfetch' },
    { event: 'postToolUse', match: 'Write', reason: 'no tool is named Write; did you mean write?' },
  ]);
});

test("every tool cedia gives the model is a name a hook's match may use", async () => {
  const { RULE_TOOLS } = await import('../src/core/doctor.ts');
  const { CORE_TOOLS } = await import('../src/core/tools/index.ts');
  const { ASK_TOOL } = await import('../src/core/tools/ask.ts');
  const { BROWSER_TOOL } = await import('../src/core/tools/browser.ts');
  const { TODO_TOOL } = await import('../src/core/tools/todo.ts');
  const { MCP_CALL_TOOL } = await import('../src/core/mcp/tools.ts');
  for (const name of [...CORE_TOOLS.map((t) => t.name), ASK_TOOL, BROWSER_TOOL, TODO_TOOL, MCP_CALL_TOOL]) expect(RULE_TOOLS).toContain(name);
});
