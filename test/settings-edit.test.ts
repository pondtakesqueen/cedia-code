import { afterEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRoles } from '../src/core/config.ts';
import { getEditable, setEditable } from '../src/core/settings-edit.ts';

const before = process.env.CEDIA_HOME;
afterEach(() => {
  if (before === undefined) delete process.env.CEDIA_HOME;
  else process.env.CEDIA_HOME = before;
});

function home(settings?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-se-'));
  if (settings) writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
  process.env.CEDIA_HOME = dir;
  return dir;
}
const file = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));

describe('cedia settings get|set|unset', () => {
  test('get names the editable keys and their defaults, never the rest of the file', () => {
    home({ roles: { plan: 'opus@high' }, mcpServers: { x: { command: 'x', env: { TOKEN: 'secret' } } }, media: 'none' });
    const e = getEditable();
    expect(e.roles).toEqual({ plan: 'opus@high' });
    expect(e.media).toBe('none');
    expect(e.defaults.code).toBe('opencode-go/claude-haiku-5-5');
    expect(JSON.stringify(e)).not.toContain('secret');
  });

  test('set writes the key a run then reads, keeping the other keys and their order', () => {
    const dir = home({ privacy: 'zdr', roles: { code: 'haiku' }, desktop: { theme: 'light' } });
    setEditable('roles.plan', 'claude-code:opus@medium');
    setEditable('maxEffort', 'high');
    setEditable('fallback.haiku', 'none');
    const s = file(dir);
    expect(Object.keys(s)).toEqual(['privacy', 'roles', 'desktop', 'maxEffort', 'fallback']);
    expect(s.roles).toEqual({ code: 'haiku', plan: 'claude-code:opus@medium' });
    expect(loadRoles({}, {}).plan).toEqual({ via: 'claude-code', model: 'opus', effort: 'medium' });
  });

  test('unset removes the key, and an object left empty', () => {
    const dir = home({ roles: { review: 'opus' }, onQuota: 'wait:30' });
    setEditable('roles.review', undefined);
    setEditable('onQuota', undefined);
    expect(file(dir)).toEqual({});
  });

  test('a value a run would refuse is refused before the file is written', () => {
    const dir = home({ roles: { code: 'haiku' } });
    expect(() => setEditable('roles.code', 'claude-code:opus')).toThrow('roles.code');
    expect(() => setEditable('roles.plan', 'no-such-model')).toThrow('unknown model');
    expect(() => setEditable('roles.triage', 'none')).toThrow('cannot be none');
    expect(() => setEditable('maxEffort', 'huge')).toThrow('maxEffort');
    expect(() => setEditable('onQuota', 'wait:soon')).toThrow('on-quota');
    expect(() => setEditable('planWhen', 'sometimes')).toThrow('planWhen');
    expect(() => setEditable('permissions.mode', 'workspace')).toThrow('not a setting this command edits');
    expect(() => setEditable('media', 'opencode-go/deepseek-v4.1-flash')).toThrow('reads text only');
    expect(file(dir)).toEqual({ roles: { code: 'haiku' } });
  });

  test('an old invalid role does not block fixing another', () => {
    const dir = home({ roles: { review: 'gone-model' } });
    setEditable('roles.plan', 'opus');
    setEditable('roles.review', undefined);
    expect(file(dir).roles).toEqual({ plan: 'opus' });
  });

  test('the CLI prints the settings after a set and fails with the reason', () => {
    const dir = home();
    const cli = (...args: string[]) => spawnSync('bun', ['src/cli.ts', 'settings', ...args, '--json'], { encoding: 'utf8', env: { ...process.env, CEDIA_HOME: dir } });
    const ok = cli('set', 'roles.review', 'opus@high');
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout).roles).toEqual({ review: 'opus@high' });
    const bad = cli('set', 'subthreadEffort', 'loud');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('subthreadEffort');
    expect(cli('set', 'media').status).toBe(2);
  });
});
