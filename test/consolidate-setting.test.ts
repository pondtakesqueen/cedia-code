import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { userSettings } from '../src/core/config.ts';
import { getEditable, setEditable } from '../src/core/settings-edit.ts';

const before = process.env.CEDIA_HOME;
afterEach(() => {
  if (before === undefined) delete process.env.CEDIA_HOME;
  else process.env.CEDIA_HOME = before;
});

function home(settings: object): void {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-cm-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify(settings));
  process.env.CEDIA_HOME = dir;
}

// consolidateMemory (and autoDream, its older name) never had a caller: memory is consolidated only by
// `cedia memory consolidate`. The setting is gone, but a settings file that still holds it must load.
describe('the retired consolidateMemory setting', () => {
  test('a settings file that holds it, under either name, still loads', () => {
    home({ consolidateMemory: true, autoDream: false });
    expect(() => userSettings()).not.toThrow();
  });

  test('the settings page neither shows nor sets it', () => {
    home({ consolidateMemory: true });
    expect('consolidateMemory' in getEditable()).toBe(false);
    expect(() => setEditable('consolidateMemory', 'on')).toThrow('is not a setting this command edits');
  });
});
