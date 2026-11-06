import { describe, expect, test } from 'bun:test';
import { checkReadOnly } from '../src/core/tools/bash.ts';

// Read-only bash is judged on the words bash will run. A backslash outside quotes takes away the meaning of the
// character after it, so the check reads it the way bash does: `\-i` is the flag -i, and `\'` is a plain quote
// character that opens no string.

describe('read-only bash and backslashes', () => {
  test('an escaped flag is still the flag', () => {
    for (const c of ['sed \\-i s/a/b/ f', 'sed -\\i s/a/b/ f', 'sort \\-o out f', 'sort -\\o out f', 'rg \\--pre=sh x'])
      expect(checkReadOnly(c).ok).toBe(false);
  });

  test('an escaped quote opens no string that could hide a second command', () => {
    expect(checkReadOnly("echo \\'; touch pwned; echo \\'").ok).toBe(false);
    expect(checkReadOnly("echo \\' > out \\'").ok).toBe(false);
    expect(checkReadOnly('echo \\" | sh \\"').ok).toBe(false);
  });

  test('plain reads with backslashes still read', () => {
    expect(checkReadOnly('grep -n "a\\|b" f').ok).toBe(true);
    expect(checkReadOnly("grep 'a\\b' f").ok).toBe(true);
    expect(checkReadOnly('cat my\\ file.txt').ok).toBe(true);
    expect(checkReadOnly('ls "dir with \\"quote\\""').ok).toBe(true);
  });
});
