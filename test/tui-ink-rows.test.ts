import { describe, expect, test } from 'bun:test';
import { deniedRow, doneRow, editDiff, intentRow, resultRow, rowText, thinkingRow, toolTarget, type RowLine } from '../src/clients/tui-ink/rows.ts';

const plain = (lines: RowLine[]) => lines.map((l) => l.spans.map((s) => s.text).join(''));

describe('ink transcript rows', () => {
  test('a call shows its tool and target; its result keeps that line and adds a summary', () => {
    const input = { path: 'math.js', edits: [{ old_text: 'export function add(a, b) {\n  return a - b;\n}', new_text: 'export function add(a, b) {\n  return a + b;\n}' }] };
    expect(plain(intentRow('edit', input, 80))).toEqual(['● Edit  math.js']);
    const done = resultRow('edit', input, { text: 'edited math.js\nedit 1: lines 1-3', isError: false }, 1500, 80);
    // The changed lines with the unchanged ones around them; a narrow row is one column.
    expect(plain(done)).toEqual(['● Edit  math.js · +1 −1 · 1.5s', '   1   export function add(a, b) {', '   2 -   return a - b;', '   2 +   return a + b;', '   3   }']);
    expect(done.slice(1).map((l) => l.band)).toEqual([undefined, 'del', 'add', undefined]);
  });

  test('a diff past twelve rows says how many more changed lines there are', () => {
    const old_text = Array.from({ length: 8 }, (_, i) => `old ${i}`).join('\n');
    const new_text = Array.from({ length: 8 }, (_, i) => `new ${i}`).join('\n');
    const d = editDiff({ edits: [{ old_text, new_text }] }, 'edited x\nedit 1: lines 10-17');
    expect(d).toMatchObject({ added: 8, removed: 8 });
    expect(d.hunks[0]![0]).toEqual({ sign: '-', old: 10, text: 'old 0' });
    const rows = plain(resultRow('edit', { path: 'x', edits: [{ old_text, new_text }] }, { text: 'edited x\nedit 1: lines 10-17' }, 0, 80));
    expect(rows).toHaveLength(1 + 12 + 1);
    expect(rows.at(-1)).toBe('     … 4 more lines · alt+e');
  });

  test('bash shows its output without the exit marker, and a failing exit on the line', () => {
    expect(plain(resultRow('bash', { command: 'node t.js' }, { text: '5\n[exit 0]', exitCode: 0 }, 200, 80))).toEqual(['● Bash  node t.js', '  └ 5']);
    expect(plain(resultRow('bash', { command: 'false' }, { text: '(no output)\n[exit 1]', exitCode: 1 }, 0, 80))[0]).toBe('● Bash  false · exit 1');
    // The first three lines show, the rest is a count.
    expect(plain(resultRow('bash', { command: 'seq 5' }, { text: '1\n2\n3\n4\n5\n[exit 0]', exitCode: 0 }, 0, 80))).toEqual(['● Bash  seq 5', '  └ 1', '    2', '    3', '    … +2 lines · alt+e']);
  });

  test('a failing bash shows what went wrong, not the first line it printed, and its exit code', () => {
    const text = 'index.ts\nlib.ts\n[stderr]\ncat: nope.txt: No such file or directory\n[exit 1]';
    expect(plain(resultRow('bash', { command: 'ls && cat nope.txt' }, { text, isError: true }, 0, 80))).toEqual([
      '● Bash  ls && cat nope.txt · exit 1',
      '  └ cat: nope.txt: No such file or directory',
    ]);
    // No stderr: the last line it printed is the nearest to the failure.
    expect(plain(resultRow('bash', { command: 'make' }, { text: 'step 1\nstep 2 failed\n[exit 2]', isError: true, exitCode: 2 }, 0, 80))).toEqual([
      '● Bash  make · exit 2',
      '  └ step 2 failed',
    ]);
  });

  test('a search shows its pattern, and where it looked when that is not the root', () => {
    expect(toolTarget({ pattern: 'add\\(', path: '.' })).toBe('add\\(');
    expect(toolTarget({ pattern: 'TODO', path: 'src' })).toBe('TODO  in src');
    expect(toolTarget({ pattern: 'src/**/*.ts' })).toBe('src/**/*.ts');
  });

  test('write counts the lines of its content, not the empty one after the last newline', () => {
    expect(plain(resultRow('write', { path: 'a.ts', content: 'a\nb\n' }, { text: 'wrote a.ts' }, 0, 80))).toEqual(['● Write  a.ts · +2 lines']);
    expect(plain(resultRow('write', { path: 'a.ts', content: 'a' }, { text: 'wrote a.ts' }, 0, 80))).toEqual(['● Write  a.ts · +1 line']);
  });

  test('a todo call shows its steps as a checklist and how many are done', () => {
    const input = { items: [{ text: 'Add types', state: 'done' }, { text: 'Add a barrel file', state: 'doing' }, { text: 'Run the type check', state: 'pending' }] };
    expect(plain(resultRow('todo', input, { text: 'Saved: 1/3 done; now: Add a barrel file.' }, 0, 80))).toEqual([
      '● Todo · 1/3 done',
      '    ✓ Add types',
      '    ◐ Add a barrel file',
      '    ○ Run the type check',
    ]);
  });

  test('read counts lines; an error shows its first line under the call', () => {
    expect(plain(resultRow('read', { path: 'a' }, { text: '1\tx\n2\ty\n' }, 0, 80))).toEqual(['● Read  a · 2 lines']);
    expect(plain(resultRow('read', { path: 'a' }, { text: 'cannot read a: ENOENT', isError: true }, 0, 80))).toEqual(['● Read  a', '  └ cannot read a: ENOENT']);
  });

  test('a long target is cut to fit the width', () => {
    const [line] = plain(intentRow('bash', { command: 'x'.repeat(200) }, 60));
    expect(line!.length).toBeLessThanOrEqual(60);
    expect(line!.endsWith('…')).toBe(true);
    expect(toolTarget({ command: 'a\nb' })).toBe('a');
  });

  test('a denied call says it was blocked and by what', () => {
    expect(plain(deniedRow('bash', { command: 'rm -rf dist' }, 'deny', 'Bash(rm -rf *)', 80))).toEqual(['● Bash  rm -rf dist · blocked', '  └ deny: Bash(rm -rf *)']);
    // A long reason wraps instead of losing its end; the next call stopped by the same rule says so in a word.
    const reason = 'this session is read-only; writes and commands that change files are not allowed in it';
    expect(plain(deniedRow('edit', { path: 'a.ts' }, 'mode:read-only', reason, 60))).toEqual([
      '● Edit  a.ts · blocked',
      '  └ mode:read-only: this session is read-only; writes and',
      '    commands that change files are not allowed in it',
    ]);
    expect(plain(deniedRow('write', { path: 'b.ts' }, 'mode:read-only', reason, 60, true))).toEqual(['● Write  b.ts · blocked (same rule)']);
  });

  test('thinking is one line until expanded', () => {
    expect(plain(thinkingRow('a\nb', 1234, false))).toEqual(['∴ Thought for 1.2s  alt+t to expand']);
    expect(plain(thinkingRow('a\nb', 1234, true))).toEqual(['∴ Thought for 1.2s', '  a', '  b']);
  });

  test('the turn line names how it ended', () => {
    expect(plain(doneRow({ subtype: 'success', ms: 3200, tools: 3, files: 1, costUsd: 0.0045 }))).toEqual(['✓ Done in 3.2s · 3 tools · 1 file changed · $0.0045   /diff  /undo  /commit']);
    expect(plain(doneRow({ subtype: 'success', ms: 100, tools: 0, files: 0, costUsd: 0 }))).toEqual(['✓ Done in 0.1s · $0.0000']);
    expect(plain(doneRow({ subtype: 'interrupted', ms: 100, tools: 0, files: 0, costUsd: 0 }))[0]).toStartWith('■ Stopped');
  });

  test('rowText is the spans joined, line by line', () => {
    const lines = resultRow('edit', { path: 'm', edits: [{ old_text: 'a', new_text: 'b' }] }, { text: 'edited m\nedit 1: lines 4-4' }, 0, 80);
    expect(rowText(lines)).toBe(plain(lines).join('\n'));
  });
});
