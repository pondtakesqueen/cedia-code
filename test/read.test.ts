import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { closeSync, ftruncateSync, mkdtempSync, openSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_OUTPUT_CHARS } from '../src/core/tools/registry.ts';
import { MAX_READ_BYTES, readTool } from '../src/core/tools/read.ts';

describe('read', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'cedia-read-'));
  const ctx = { cwd, signal: new AbortController().signal };
  writeFileSync(join(cwd, 'three.txt'), 'a\nb\nc\n');
  writeFileSync(join(cwd, 'empty.txt'), '');
  // 1500 lines of 60 characters: under the line limit, three times the character budget.
  writeFileSync(join(cwd, 'big.ts'), Array.from({ length: 1500 }, (_, i) => `const line${String(i + 1).padStart(4, '0')} = ${'x'.repeat(40)};`).join('\n'));
  const read = (input: Record<string, unknown>) => readTool.run(input as never, ctx);

  test('an offset past the end says so, instead of calling the file empty', async () => {
    expect(await read({ path: 'three.txt', offset: 10 })).toEqual({ text: 'three.txt has 3 lines; offset 10 is past the end', isError: true });
    expect(await read({ path: 'empty.txt' })).toEqual({ text: '(empty file)', isError: false });
  });

  test('an offset or limit that is not a number falls back to the default; one sent as a string is taken', async () => {
    expect((await read({ path: 'three.txt', offset: 'x', limit: 'all' })).text).toBe('     1\ta\n     2\tb\n     3\tc');
    expect((await read({ path: 'three.txt', offset: '2', limit: '1' })).text).toBe('     2\tb\n[1 more lines; read on with offset 3]');
  });

  test('a file past the character budget is paged in whole lines, with the offset to go on from', async () => {
    const r = await read({ path: 'big.ts' });
    expect(r.text.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS + 100);
    expect(r.text).not.toContain('characters cut');
    const rows = r.text.split('\n').slice(0, -1);
    expect(rows.every((row, i) => row.startsWith(`${String(i + 1).padStart(6)}\tconst line${String(i + 1).padStart(4, '0')}`))).toBe(true);
    const next = rows.length + 1;
    expect(r.text.split('\n').at(-1)).toBe(`[${1500 - next + 1} more lines; read on with offset ${next}]`);
    const on = await read({ path: 'big.ts', offset: next });
    expect(on.text.startsWith(`${String(next).padStart(6)}\tconst line${String(next).padStart(4, '0')}`)).toBe(true);
  });

  test('one line longer than the budget is still shown, clipped', async () => {
    writeFileSync(join(cwd, 'min.js'), 'y'.repeat(MAX_OUTPUT_CHARS * 2) + '\nz\n');
    const r = await read({ path: 'min.js' });
    expect(r.text).toContain('characters cut');
    expect(r.text).toEndWith('[1 more lines; read on with offset 2]');
  });
});

describe('files that are not regular files, and files too large to read whole', () => {
  const run = (path: string, cwd = '/') => readTool.run({ path }, { cwd } as never);
  test('a device file is refused at once, not read until memory runs out', async () => {
    const t0 = Date.now();
    const r = await run('/dev/zero');
    expect(r.isError).toBe(true);
    expect(r.text).toContain('not a regular file');
    expect(Date.now() - t0).toBeLessThan(1000);
  });
  test('a FIFO is refused instead of blocking the session forever', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-read-fifo-'));
    spawnSync('mkfifo', [join(dir, 'pipe')]);
    const r = await Promise.race([run('pipe', dir), new Promise<{ text: string; isError: boolean }>((ok) => setTimeout(() => ok({ text: 'hung', isError: false }), 2000))]);
    expect(r.text).toContain('not a regular file');
  });
  test('a file past the size cap is refused with its size and what to use instead', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cedia-read-big-'));
    const fd = openSync(join(dir, 'big.log'), 'w');
    ftruncateSync(fd, MAX_READ_BYTES + 1);
    closeSync(fd);
    const r = await run('big.log', dir);
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/big\.log is \d+ MB/);
    expect(r.text).toContain('grep');
  });
});
