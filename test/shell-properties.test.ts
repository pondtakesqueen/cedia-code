import { expect, test } from 'bun:test';
import fc from 'fast-check';
import { FRAME_TAGS, inert } from '../src/core/trust/frame.ts';
import { matchCheck } from '../src/core/trust/ledger.ts';
import { redactSecrets, REDACTED } from '../src/core/safety/secrets.ts';
import { checkReadOnly } from '../src/core/safety/shell.ts';

// Property tests for the code that decides what is safe: a generator writes the inputs, so the edge cases are not
// the ones the author thought of. The seed is fixed, so a failure reproduces; raise numRuns locally to search more.
const RUNS = { numRuns: 300, seed: 20261118 };

// The same word as bash reads it, written another way: a letter escaped with a backslash, or a stretch of it in
// single or double quotes. bash hands the program the same word, so the read-only check must judge it the same.
const respelled = (word: string) =>
  fc.array(fc.constantFrom('plain', 'backslash', 'single', 'double'), { minLength: word.length, maxLength: word.length }).map((how) =>
    [...word]
      .map((ch, i) => (how[i] === 'backslash' && /[A-Za-z-]/.test(ch) ? `\\${ch}` : how[i] === 'single' ? `'${ch}'` : how[i] === 'double' ? `"${ch}"` : ch))
      .join(''),
  );

// Commands that write a file or run another program, each split into the words a respelling may touch.
const WRITERS: string[][] = [
  ['sed', '-i', 's/a/b/', 'f'],
  ['sed', '-ni', 's/a/b/p', 'f'],
  ['sort', '-o', 'out', 'f'],
  ['sort', '-uo', 'out', 'f'],
  ['tee', 'out'],
  ['rm', 'f'],
  ['rg', '--pre=sh', 'x'],
  ['find', '.', '-delete'],
  ['find', '.', '-exec', 'rm', '{}', ';'],
  ['git', 'commit', '-m', 'x'],
  ['awk', 'BEGIN{system("touch x")}'],
];

test('a command that writes stays not read-only however its words are spelled', () => {
  fc.assert(
    fc.property(
      fc.constantFrom(...WRITERS).chain((words) => fc.tuple(...words.map((w) => (w === '{}' || w === ';' ? fc.constant(w === ';' ? '\;' : w) : respelled(w))))),
      (words) => {
        const command = words.join(' ');
        expect([command, checkReadOnly(command).ok]).toEqual([command, false]);
      },
    ),
    RUNS,
  );
});

test('a read-only command joined to a writing one by an operator is not read-only', () => {
  fc.assert(
    fc.property(fc.constantFrom('ls', 'cat f', 'git status', 'grep -r x .'), fc.constantFrom(';', '&&', '||', '|', '\n'), fc.constantFrom(...WRITERS), (read, op, w) => {
      const command = `${read} ${op} ${w.map((x) => (x === ';' ? '\;' : x)).join(' ')}`;
      expect([command, checkReadOnly(command).ok]).toEqual([command, false]);
    }),
    RUNS,
  );
});

const SECRETS = ['sk-ant-api03-' + 'x1'.repeat(20), 'ghp_' + 'a1'.repeat(18), 'AKIAIOSFODNN7EXAMPLE'];

test('redaction hides a secret wherever it sits in text, and redacting twice changes nothing more', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 80 }), fc.constantFrom(...SECRETS), fc.string({ maxLength: 80 }), fc.constantFrom(' ', '\n', '=', '"', ':'), (before, secret, after, sep) => {
      const text = `${before}${sep}${secret}${sep}${after}`;
      const once = redactSecrets(text).text;
      expect(once).not.toContain(secret);
      expect(once).toContain(REDACTED);
      expect(redactSecrets(once).text).toBe(once);
    }),
    RUNS,
  );
});

test('framed text never holds a tag that could open or close a frame, and inert is idempotent', () => {
  const tagged = fc.tuple(fc.string({ maxLength: 30 }), fc.constantFrom(...FRAME_TAGS), fc.constantFrom('<', '</'), fc.constantFrom('>', ' ', '/', '\n', ''), fc.boolean(), fc.string({ maxLength: 30 }));
  fc.assert(
    fc.property(tagged, ([a, tag, open, end, upper, b]) => {
      const out = inert(`${a}${open}${upper ? tag.toUpperCase() : tag}${end}${b}`);
      const live = new RegExp(`<\\/?(${FRAME_TAGS.join('|')})(?=[\\s>/]|$)`, 'i');
      expect(live.test(out)).toBe(false);
      expect(inert(out)).toBe(out);
    }),
    RUNS,
  );
});

test('a declared check matches however its spaces are laid out, and never through a pipe', () => {
  const check = 'bun test test/a.test.ts';
  fc.assert(
    fc.property(fc.array(fc.constantFrom(' ', '  ', '\t'), { minLength: 4, maxLength: 4 }), fc.constantFrom('', ' ', '  '), fc.boolean(), (gaps, lead, redirect) => {
      const words = check.split(' ');
      const spaced = `${lead}${words.map((w, i) => (i ? gaps[i - 1] : '') + w).join('')}${redirect ? ' 2>&1' : ''}`;
      expect(matchCheck(spaced, [check])).toBe(check);
      expect(matchCheck(`${spaced} | tail`, [check])).toBeUndefined();
    }),
    RUNS,
  );
});
