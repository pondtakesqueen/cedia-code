import { resolve } from 'node:path';
import { installPlugin, listInstalled, loadInstalled, loadManifest, pluginContents, pluginsDir, uninstallPlugin } from '../plugins/plugins.ts';
import { inside, realExisting } from '../fs-safety.ts';
import { refreshPluginSkills, type Skill } from '../skills/skills.ts';
import { inert } from '../trust/frame.ts';
import type { JsonObject, ToolOutput } from '../types.ts';
import type { ToolSpec } from './registry.ts';

// Creator mode (`--creator on`, `creator` in user settings; off by default): the writer may extend cedia with a
// plugin it wrote. It writes the plugin's folder in the working directory with its ordinary tools (Claude Code's
// layout, core/plugins/plugins.ts), then installs it with this tool, and the plugin's skills and commands are
// loadable with the skill tool in the same session (refreshPluginSkills) and listed in every session after.
//
// The tool installs from a folder inside the working directory only, so what goes into ~/.cedia/plugins is what the
// session wrote or read there; never from a URL or a marketplace. It neither replaces nor removes a plugin the user
// installed from elsewhere. Install and uninstall count as commands (`exec`): a read-only session needs an allow rule
// (`plugin`), and the classifier reads them where one runs. Nothing a written plugin ships runs on its own, as for
// any plugin: its MCP servers start only once the user runs `cedia plugin mcp <name>`, and its hooks never run.

export type PluginCall = { action: 'install'; path: string } | { action: 'uninstall'; name: string } | { action: 'list' };

export function pluginCallOf(input: JsonObject): PluginCall | string {
  const action = input.action;
  if (action === 'list') return { action };
  if (action === 'install') return typeof input.path === 'string' && input.path.trim() ? { action, path: input.path.trim() } : 'install needs `path`, the plugin folder in the working directory';
  if (action === 'uninstall') return typeof input.name === 'string' && input.name.trim() ? { action, name: input.name.trim() } : 'uninstall needs `name`';
  return 'action is install, uninstall or list';
}

// Whether a plugin came from a folder inside the working directory, so this session may replace or remove it.
const fromHere = (source: string | undefined, cwd: string): boolean => {
  const root = realExisting(cwd);
  const at = source ? realExisting(source) : undefined;
  return !!root && !!at && inside(root, at);
};

const fail = (text: string): ToolOutput => ({ text, isError: true });

export function pluginTool(opts: { home: string; skills: Skill[] }): ToolSpec {
  const { home, skills } = opts;
  return {
    name: 'plugin',
    description:
      "Install a plugin you wrote in the working directory, so cedia has its skills and commands in this session and every later one. A plugin is a folder with `.claude-plugin/plugin.json` ({\"name\", \"version\"}), `skills/<name>/SKILL.md` (front matter `name` and `description`, then the instructions) and `commands/<name>.md`. Write the folder first, install it with `path`, then load one of its skills with the skill tool to check it. Installing the same folder again replaces it. `uninstall` removes one this workspace installed; `list` shows what is installed. For the whole procedure load the skill `make-plugin`.",
    schema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['install', 'uninstall', 'list'] },
        path: { type: 'string', description: 'install: the plugin folder, inside the working directory' },
        name: { type: 'string', description: "uninstall: the plugin's name" },
      },
      required: ['action'],
      additionalProperties: false,
    },
    effect: 'exec',
    effectOf: (input) => (input.action === 'list' ? 'read' : 'exec'),
    pathOf: (input) => (input.action === 'install' && typeof input.path === 'string' ? input.path : undefined),
    replay: 'unsafe',
    async run(input, ctx) {
      const call = pluginCallOf(input);
      if (typeof call === 'string') return fail(call);
      if (call.action === 'list') {
        const all = listInstalled(home);
        if (!all.length) return { text: 'no plugins installed', isError: false };
        const lines = all.map((p) => `- ${inert(p.name)} ${inert(p.version)}${p.enabled ? '' : ' (disabled)'}${fromHere(p.source, ctx.cwd) ? ', from this workspace' : ''}`);
        return { text: `Installed plugins:\n${lines.join('\n')}`, isError: false };
      }
      if (call.action === 'uninstall') {
        const rec = loadInstalled(home).plugins[call.name];
        if (!rec) return fail(`no plugin ${call.name}`);
        if (!fromHere(rec.source, ctx.cwd)) return fail(`the user installed ${call.name}; only they remove it (cedia plugin uninstall ${call.name})`);
        uninstallPlugin(call.name, home);
        refreshPluginSkills(skills, home, call.name);
        return { text: `Uninstalled plugin ${call.name}; its skills are gone from this session.`, isError: false };
      }
      const dir = realExisting(resolve(ctx.cwd, call.path));
      const root = realExisting(ctx.cwd);
      if (!dir || !root || !inside(root, dir)) return fail(`${call.path} is outside the working directory; install a plugin from a folder you wrote here`);
      const manifest = loadManifest(dir);
      if (!manifest) return fail(`no plugin.json (or .claude-plugin/plugin.json) with a name in ${call.path}; write {"name": "<name>", "version": "0.1.0"} there first`);
      const before = loadInstalled(home).plugins[manifest.name];
      if (before && !fromHere(before.source, ctx.cwd))
        return fail(`the user installed ${manifest.name} from ${inert(before.source ?? 'elsewhere')}; give your plugin another name`);
      try {
        installPlugin(dir, home);
      } catch (e) {
        return fail(`could not install ${call.path}: ${(e as Error).message}`);
      }
      const now = refreshPluginSkills(skills, home, manifest.name);
      const c = pluginContents(dir);
      const lines = [`Installed plugin ${manifest.name} ${manifest.version} into ${pluginsDir(home)}/${manifest.name}.`];
      lines.push(now.length ? `Load these with the skill tool now; later sessions list them too:\n${now.map((s) => `- ${s.name}: ${inert(s.description)}`).join('\n')}` : 'It has no skills or commands cedia could read: each needs skills/<name>/SKILL.md with a name and a description, or commands/<name>.md.');
      if (c.mcpServers.length) lines.push(`Its MCP servers (${c.mcpServers.join(', ')}) do not start until the user runs: cedia plugin mcp ${manifest.name}`);
      if (c.hooks || c.agents.length) lines.push('Its hooks and agents are not run by cedia.');
      return { text: lines.join('\n'), isError: false };
    },
  };
}
