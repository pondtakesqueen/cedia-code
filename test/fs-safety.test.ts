import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandHome, inside, isSecretFile, SECRET_NAME, strictlyInside } from '../src/core/fs-safety.ts';
import { grepTool } from '../src/core/tools/grep.ts';

describe('fs-safety', () => {
  test('the name test covers what the old hand-written one did', () => {
    for (const n of ['.env', '.env.local', 'server.pem', 'a.key', 'x.p12', 'x.pfx', 'k.keystore', 'k.jks', 'id_rsa', 'id_ed25519.pub', '.netrc', '.npmrc', '.pypirc', 'credentials', 'credentials.json', '.ENV', 'Server.PEM'])
      expect(SECRET_NAME.test(n)).toBe(true);
    for (const n of ['env.ts', 'README.md', 'keys.ts', 'credentials.ts', 'xenv'])
      expect(SECRET_NAME.test(n)).toBe(false);
  });

  test('inside and strictlyInside', () => {
    expect(inside('/a', '/a')).toBe(true);
    expect(inside('/a', '/a/b')).toBe(true);
    expect(inside('/a', '/a/..b')).toBe(true);
    expect(inside('/a', '/ab')).toBe(false);
    expect(inside('/a', '/')).toBe(false);
    expect(strictlyInside('/a', '/a')).toBe(false);
    expect(strictlyInside('/a', '/a/b')).toBe(true);
  });

  test('expandHome and the secret file test', () => {
    expect(expandHome('~')).toBe(homedir());
    expect(expandHome('~/x')).toBe(join(homedir(), 'x'));
    expect(expandHome('~x')).toBe('~x');
    expect(isSecretFile('/r', '/r/.git/config')).toBe(true);
    expect(isSecretFile('/r', '/r/src/.env')).toBe(true);
    expect(isSecretFile('/r', '/r/src/a.ts')).toBe(false);
  });

  test.skipIf(!Bun.which('rg'))('grep skips a credential file whatever its case, as the name test does', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-fss-'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', '.ENV'), 'TOKEN=needle\n');
    writeFileSync(join(dir, 'sub', 'a.txt'), 'needle\n');
    const r = await grepTool.run({ pattern: 'needle', files_only: true }, { cwd: dir, signal: new AbortController().signal });
    expect(r.text).toContain('a.txt');
    expect(r.text).not.toContain('.ENV');
  });
});
