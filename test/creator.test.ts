import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installPlugin, loadInstalled } from '../src/core/plugins/plugins.ts';
import { lintSession } from '../src/core/session/lint.ts';
import { SessionLog } from '../src/core/session/log.ts';
import { findSkill, loadSkills, skillTool } from '../src/core/skills/skills.ts';
import { pluginCallOf, pluginTool } from '../src/core/tools/plugin.ts';
import { effectOf } from '../src/core/tools/registry.ts';

const BIN = join(import.meta.dir, '..', 'bin', 'cedia');

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-creator-'));
  Bun.spawnSync(['git', 'init', '-q'], { cwd: dir });
  const home = join(dir, '.home');
  mkdirSync(home, { recursive: true });
  return { dir, home };
}

// A plugin the model wrote in the workspace: a manifest and one skill.
function written(at: string, name = 'mine', body = 'Bump the version, then tag.') {
  const p = join(at, name);
  mkdirSync(join(p, '.claude-plugin'), { recursive: true });
  writeFileSync(join(p, '.claude-plugin', 'plugin.json'), JSON.stringify({ name, version: '0.1.0' }));
  mkdirSync(join(p, 'skills', 'release'), { recursive: true });
  writeFileSync(join(p, 'skills', 'release', 'SKILL.md'), `---\nname: release\ndescription: Cut a release of this repo\n---\n\n${body}\n`);
  return p;
}

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal });

describe('creator mode: the plugin tool', () => {
  test('a call: install with a path, uninstall with a name, or list', () => {
    expect(pluginCallOf({ action: 'install', path: 'plugins/mine' })).toEqual({ action: 'install', path: 'plugins/mine' });
    expect(pluginCallOf({ action: 'uninstall', name: 'mine' })).toEqual({ action: 'uninstall', name: 'mine' });
    expect(pluginCallOf({ action: 'list' })).toEqual({ action: 'list' });
    expect(pluginCallOf({ action: 'install' })).toBe('install needs `path`, the plugin folder in the working directory');
    expect(pluginCallOf({ action: 'uninstall' })).toBe('uninstall needs `name`');
    expect(pluginCallOf({ action: 'enable' })).toBe('action is install, uninstall or list');
  });

  test('list only reads; install and uninstall count as commands', () => {
    const { dir, home } = repo();
    const tool = pluginTool({ home, skills: [] });
    expect(effectOf(tool, { action: 'list' })).toBe('read');
    expect(effectOf(tool, { action: 'install', path: 'x' })).toBe('exec');
    expect(effectOf(tool, { action: 'uninstall', name: 'x' })).toBe('exec');
    expect(tool.pathOf?.({ action: 'install', path: join(dir, 'x') })).toBe(join(dir, 'x'));
  });

  test('install: the skill is usable at once in the same session, and the session can take it away again', async () => {
    const { dir, home } = repo();
    written(join(dir, 'plugins'));
    const skills = loadSkills(dir, home);
    const skill = skillTool(skills);
    const tool = pluginTool({ home, skills });
    expect(findSkill(skills, 'mine:release')).toBeUndefined();
    const r = await tool.run({ action: 'install', path: 'plugins/mine' }, ctx(dir));
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Installed plugin mine 0.1.0');
    expect(r.text).toContain('- mine:release: Cut a release of this repo');
    expect(existsSync(join(home, 'plugins', 'mine', 'skills', 'release', 'SKILL.md'))).toBe(true);
    const loaded = await skill.run({ name: 'mine:release' }, ctx(dir));
    expect(loaded.isError).toBe(false);
    expect(loaded.text).toContain('Bump the version, then tag.');
    // Installing again from the same folder replaces it, and the session sees the new text.
    written(join(dir, 'plugins'), 'mine', 'Tag first.');
    expect((await tool.run({ action: 'install', path: 'plugins/mine' }, ctx(dir))).isError).toBe(false);
    expect(skills.filter((s) => s.name === 'mine:release')).toHaveLength(1);
    expect((await skill.run({ name: 'mine:release' }, ctx(dir))).text).toContain('Tag first.');
    const listed = await tool.run({ action: 'list' }, ctx(dir));
    expect(listed.text).toContain('mine 0.1.0');
    const gone = await tool.run({ action: 'uninstall', name: 'mine' }, ctx(dir));
    expect(gone.isError).toBe(false);
    expect(existsSync(join(home, 'plugins', 'mine'))).toBe(false);
    expect(findSkill(skills, 'mine:release')).toBeUndefined();
  });

  test('install takes a folder inside the working directory only', async () => {
    const { dir, home } = repo();
    const outside = mkdtempSync(join(tmpdir(), 'cedia-elsewhere-'));
    written(outside);
    const tool = pluginTool({ home, skills: [] });
    const r = await tool.run({ action: 'install', path: join(outside, 'mine') }, ctx(dir));
    expect(r.isError).toBe(true);
    expect(r.text).toContain('is outside the working directory');
    expect(existsSync(join(home, 'plugins', 'mine'))).toBe(false);
    const none = await tool.run({ action: 'install', path: '.' }, ctx(dir));
    expect(none.isError).toBe(true);
    expect(none.text).toContain('no plugin.json');
  });

  test("the user's own plugins are not the session's to replace or remove", async () => {
    const { dir, home } = repo();
    const theirs = mkdtempSync(join(tmpdir(), 'cedia-theirs-'));
    written(theirs, 'pstack');
    installPlugin(join(theirs, 'pstack'), home);
    written(join(dir, 'plugins'), 'pstack', 'Planted.');
    const tool = pluginTool({ home, skills: [] });
    const r = await tool.run({ action: 'install', path: 'plugins/pstack' }, ctx(dir));
    expect(r.isError).toBe(true);
    expect(r.text).toContain('the user installed pstack from');
    const u = await tool.run({ action: 'uninstall', name: 'pstack' }, ctx(dir));
    expect(u.isError).toBe(true);
    expect(loadInstalled(home).plugins.pstack?.source).toBe(join(theirs, 'pstack'));
  });

  test('MCP servers and hooks a written plugin ships do not start: the result says how the user turns servers on', async () => {
    const { dir, home } = repo();
    const p = written(join(dir, 'plugins'));
    writeFileSync(join(p, '.mcp.json'), JSON.stringify({ mcpServers: { srv: { command: 'bun', args: ['${CLAUDE_PLUGIN_ROOT}/server.ts'] } } }));
    mkdirSync(join(p, 'hooks'), { recursive: true });
    writeFileSync(join(p, 'hooks', 'hooks.json'), '{}');
    const r = await pluginTool({ home, skills: [] }).run({ action: 'install', path: 'plugins/mine' }, ctx(dir));
    expect(r.text).toContain('cedia plugin mcp mine');
    expect(r.text).toContain('hooks');
  });
});

describe('creator mode: a headless run', () => {
  const firstTools = (home: string) => {
    const sessions = join(home, 'sessions');
    const [project] = readdirSync(sessions);
    const [file] = readdirSync(join(sessions, project!));
    const events = SessionLog.load(join(sessions, project!, file!)).events;
    const header = events[0];
    return { events, tools: header && header.kind === 'session' ? header.tools.map((t) => t.name) : [] };
  };

  test('off by default: no plugin tool, so the tool list is what it was', () => {
    const { dir, home } = repo();
    const script = join(dir, '.script.json');
    writeFileSync(script, JSON.stringify([{ blocks: [{ type: 'text', text: 'ok' }] }]));
    const p = Bun.spawnSync([BIN, '-m', 'faux', '-p', 'hi', '--cwd', dir, '--sandbox', 'off', '--permission', 'workspace'], { env: { ...process.env, CEDIA_FAUX_SCRIPT: script, CEDIA_HOME: home } });
    expect(p.exitCode).toBe(0);
    expect(firstTools(home).tools).not.toContain('plugin');
  });

  test('--creator on: the writer writes a plugin, installs it and loads its skill in the same run', () => {
    const { dir, home } = repo();
    const script = join(dir, '.script.json');
    const skillMd = '---\nname: release\ndescription: Cut a release of this repo\n---\n\nBump the version, then tag.\n';
    writeFileSync(
      script,
      JSON.stringify([
        {
          blocks: [
            { type: 'tool_use', id: 'w1', name: 'write', input: { path: 'plugins/mine/.claude-plugin/plugin.json', content: '{"name":"mine","version":"0.1.0"}\n' } },
            { type: 'tool_use', id: 'w2', name: 'write', input: { path: 'plugins/mine/skills/release/SKILL.md', content: skillMd } },
          ],
        },
        { blocks: [{ type: 'tool_use', id: 'p1', name: 'plugin', input: { action: 'install', path: 'plugins/mine' } }] },
        { blocks: [{ type: 'tool_use', id: 's1', name: 'skill', input: { name: 'mine:release' } }] },
        { blocks: [{ type: 'text', text: 'done' }] },
      ]),
    );
    const p = Bun.spawnSync([BIN, '-m', 'faux', '-p', 'make a release skill', '--cwd', dir, '--sandbox', 'off', '--permission', 'workspace', '--creator', 'on'], { env: { ...process.env, CEDIA_FAUX_SCRIPT: script, CEDIA_HOME: home } });
    expect(p.exitCode).toBe(0);
    const { events, tools } = firstTools(home);
    expect(tools).toContain('plugin');
    expect(tools).toContain('skill');
    const results = events.filter((e) => e.kind === 'tool_result').map((e) => JSON.stringify(e));
    expect(results.some((t) => t.includes('Installed plugin mine 0.1.0'))).toBe(true);
    expect(results.some((t) => t.includes('Bump the version, then tag.'))).toBe(true);
    expect(lintSession(events)).toEqual([]);
  });

  test('--creator on in a read-only session: install is denied, list still works', () => {
    const { dir, home } = repo();
    written(join(dir, 'plugins'));
    const script = join(dir, '.script.json');
    writeFileSync(script, JSON.stringify([{ blocks: [{ type: 'tool_use', id: 'p1', name: 'plugin', input: { action: 'install', path: 'plugins/mine' } }] }, { blocks: [{ type: 'text', text: 'ok' }] }]));
    const p = Bun.spawnSync([BIN, '-m', 'faux', '-p', 'hi', '--cwd', dir, '--sandbox', 'off', '--permission', 'read-only', '--creator', 'on'], { env: { ...process.env, CEDIA_FAUX_SCRIPT: script, CEDIA_HOME: home } });
    expect(p.exitCode).toBe(0);
    expect(existsSync(join(home, 'plugins', 'mine'))).toBe(false);
  });
});
