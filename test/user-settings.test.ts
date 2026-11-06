import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userSettings, writeSettings } from '../src/core/config.ts';
import { localModels } from '../src/core/providers/catalog.ts';
import { loadOutputStyleSetting } from '../src/core/output-styles/styles.ts';
import { applyAllowRules } from '../src/core/safety/suggest.ts';
import { sessionPath } from '../src/core/session/log.ts';

// Every reader of ~/.cedia/settings.json goes through one checked read: a bad file fails the same way everywhere,
// with its path, instead of some readers skipping it.

const before = process.env.CEDIA_HOME;
afterEach(() => {
  if (before === undefined) delete process.env.CEDIA_HOME;
  else process.env.CEDIA_HOME = before;
});

function home(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-us-'));
  writeFileSync(join(dir, 'settings.json'), text);
  process.env.CEDIA_HOME = dir;
  return dir;
}

describe('user settings, read once', () => {
  test('a malformed file fails local models with its path, as it fails every loader', () => {
    const dir = home('{ not json');
    expect(() => localModels()).toThrow(join(dir, 'settings.json'));
  });

  test('a malformed file fails the output style with its path', () => {
    const dir = home('{ not json');
    expect(() => loadOutputStyleSetting(dir)).toThrow(join(dir, 'settings.json'));
  });

  test('an unknown key fails the output style, as checkSettings fails it elsewhere', () => {
    const dir = home(JSON.stringify({ outputStyle: 'terse', nope: 1 }));
    expect(() => loadOutputStyleSetting(dir)).toThrow('unknown setting "nope"');
  });

  test('the output style is read from a good file', () => {
    const dir = home(JSON.stringify({ outputStyle: 'terse' }));
    expect(loadOutputStyleSetting(dir)).toBe('terse');
  });

  test('a rewrite is seen on the next read', () => {
    const dir = home(JSON.stringify({ todo: true }));
    expect(userSettings().todo).toBe(true);
    writeSettings({ todo: false, jobs: true }, join(dir, 'settings.json'));
    expect(userSettings()).toEqual({ todo: false, jobs: true });
  });

  test('no file is no settings', () => {
    process.env.CEDIA_HOME = mkdtempSync(join(tmpdir(), 'cedia-us-'));
    expect(userSettings()).toEqual({});
  });

  test('allow rules keep keys they do not touch and refuse a bad file', () => {
    const dir = home(JSON.stringify({ todo: true, permissions: { allow: ['a'] } }));
    expect(applyAllowRules(dir, ['a', 'b'])).toEqual({ added: ['b'] });
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({ todo: true, permissions: { allow: ['a', 'b'] } });
    const bad = home('{ not json');
    expect(() => applyAllowRules(bad, ['c'])).toThrow(join(bad, 'settings.json'));
    expect(existsSync(join(bad, 'settings.json'))).toBe(true);
  });

  test('sessions live under CEDIA_HOME', () => {
    const dir = home('{}');
    expect(sessionPath('/tmp/x', 'id').startsWith(join(dir, 'sessions'))).toBe(true);
  });
});
