import { expect, test } from 'bun:test';
import { CORE_TOOLS } from '../src/core/tools/index.ts';

// The loop shows a folder's own instructions after the first call that opens a file under it. Which calls do is the
// tool's to say (ToolSpec.opensFile), not a list of names in the loop.
test('exactly read, edit, write and NotebookEdit open a file, and name it by pathOf', () => {
  expect(CORE_TOOLS.filter((t) => t.opensFile).map((t) => t.name).sort()).toEqual(['NotebookEdit', 'edit', 'read', 'write']);
  const path = (name: string, input: Record<string, unknown>) => CORE_TOOLS.find((t) => t.name === name)!.pathOf!(input as never);
  expect(path('read', { path: 'a.ts' })).toBe('a.ts');
  expect(path('edit', { path: 'b.ts' })).toBe('b.ts');
  expect(path('write', { path: 'c.ts' })).toBe('c.ts');
  expect(path('NotebookEdit', { notebook_path: 'n.ipynb' })).toBe('n.ipynb');
});
