import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GROUP_ORDER, helpGroups, INK_COMMANDS, KEY_ACTIONS } from '../src/clients/tui-ink/commands.ts';

// One list of slash commands: /help, autocomplete and the palette read it, and handleCommand runs each.
const app = readFileSync(join(import.meta.dir, '..', 'src', 'clients', 'tui-ink', 'app.tsx'), 'utf8');
const handler = app.slice(app.indexOf('const handleCommand'));
const cases = new Set([...handler.matchAll(/case '([\w-]+)'/g)].map((m) => m[1]!));

test('every command in the list has a case in handleCommand, and every case is a command or a key action', () => {
  const names = INK_COMMANDS.map((c) => c.name);
  expect(names.filter((n) => !cases.has(n))).toEqual([]);
  const known = new Set<string>([...names, ...KEY_ACTIONS]);
  expect([...cases].filter((c) => !known.has(c))).toEqual([]);
  expect(new Set(names).size).toBe(names.length);
});

test('/help lists every command once, by group', () => {
  const listed = helpGroups().flatMap(([, cmds]) => cmds.map((c) => c.name));
  expect(listed.sort()).toEqual(INK_COMMANDS.map((c) => c.name).sort());
  expect(helpGroups().map(([g]) => g)).toEqual([...GROUP_ORDER]);
  expect(listed).toContain('fast');
  expect(listed).toContain('color');
});
