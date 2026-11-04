import { expect, test } from 'bun:test';
import { pickerItems } from '../src/clients/tui-ink/app.tsx';

const items = [
  { value: 'auto', label: '  auto  the writer with a plan and a review' },
  { value: 'anthropic/claude-haiku-5-5', label: '  anthropic/claude-haiku-5-5  Haiku' },
  { value: 'deepseek', label: '- deepseek  no key' },
];

test('a searchable picker keeps the items whose value or label holds the query, in any case', () => {
  expect(pickerItems({ items, searchable: true }, 'HAIKU').map((i) => i.value)).toEqual(['anthropic/claude-haiku-5-5']);
  expect(pickerItems({ items, searchable: true }, 'no key').map((i) => i.value)).toEqual(['deepseek']);
  expect(pickerItems({ items, searchable: true }, 'zzz')).toEqual([]);
  expect(pickerItems({ items, searchable: true }, '')).toBe(items);
});

test('a picker that is not searchable shows every item whatever was typed', () => {
  expect(pickerItems({ items }, 'haiku')).toBe(items);
});
