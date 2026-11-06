import { expect, test } from 'bun:test';
import { printable } from '../src/core/printable.ts';

test('printable shows escapes, C1 and bidi controls as text and leaves the rest', () => {
  expect(printable('a\x1b[31mb')).toBe('a\\u001b[31mb');
  expect(printable('x\x9by')).toBe('x\\u009by');
  expect(printable('p‮q')).toBe('p\\u202eq');
  expect(printable('line\nnext')).toBe('line\\u000anext');
  expect(printable('plain é ✓')).toBe('plain é ✓');
});
