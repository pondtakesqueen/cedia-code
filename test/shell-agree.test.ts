import { describe, expect, test } from 'bun:test';
import { checkReadOnly, readOnlyCommands } from '../src/core/safety/shell.ts';
import { simpleCommands } from '../src/core/safety/shell.ts';

// The read-only check and the policy's simple-command split read one command line; they must agree on the words
// of every simple command, or a rule and the read-only check judge two different commands.
const CORPUS = [
  'ls -la',
  'cat "my file.txt"',
  "grep -n 'a b' src/x.ts",
  'grep -n "a\\|b" f',
  'cat my\\ file.txt',
  'ls "dir with \\"quote\\""',
  "echo 'it'\\''s'",
  'git log --oneline -5 && git status',
  'cd src; ls',
  'cat a | grep b | wc -l',
  'sed -n 1,5p f',
  'rg -e "x y" -- src',
  'echo "$HOME"',
  'echo \\$HOME',
  'printf "%s\\n" a',
  'ls \\\nsrc',
];

describe('one tokenizer', () => {
  for (const c of CORPUS) {
    test(JSON.stringify(c), () => {
      expect(readOnlyCommands(c)).toEqual(simpleCommands(c));
    });
  }
  test('the check still refuses what it refused', () => {
    for (const c of ['sed \\-i s/a/b/ f', "echo \\'; touch x; echo \\'", 'sort -o out f', 'cat x > y', 'echo $(id)', 'FOO=1 ls', 'sudo cat x', 'bash -c "cat x"'])
      expect(checkReadOnly(c).ok).toBe(false);
  });
});

test('simpleCommands reads backslashes as bash does', () => {
  // In double quotes a backslash escapes only $ ` " \ and a newline; `\|` keeps both characters.
  expect(simpleCommands('grep "a\\|b" f')).toEqual([['grep', 'a\\|b', 'f']]);
  expect(simpleCommands('echo "\\$HOME"')).toEqual([['echo', '$HOME']]);
  // A backslash-newline joins the lines and leaves nothing behind.
  expect(simpleCommands('ls \\\nsrc')).toEqual([['ls', 'src']]);
  expect(simpleCommands('rm -r\\\nf x')).toEqual([['rm', '-rf', 'x']]);
});
