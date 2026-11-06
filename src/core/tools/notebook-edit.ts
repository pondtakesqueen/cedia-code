import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { toolPath, type ToolSpec } from './registry.ts';

type Cell = { cell_type: string; source: string | string[]; metadata?: Record<string, unknown>; outputs?: unknown[]; execution_count?: number | null; id?: string };

function loadNotebook(path: string): { nb: any; cells: Cell[] } {
  const raw = readFileSync(path, 'utf8');
  const nb = JSON.parse(raw);
  if (!nb || typeof nb !== 'object' || !Array.isArray(nb.cells)) throw new Error('invalid notebook: missing cells array');
  return { nb, cells: nb.cells as Cell[] };
}

export const notebookEditTool: ToolSpec = {
  name: 'NotebookEdit',
  description:
    'Change one cell of a Jupyter notebook (.ipynb). edit_mode replace (the default) sets the source of the cell cell_id names; insert adds a new cell after cell_id, or at the end without one; delete removes the cell cell_id names. Outputs of a new code cell start empty.',
  schema: {
    type: 'object',
    properties: {
      notebook_path: { type: 'string', description: 'Notebook path, absolute or relative to the working directory' },
      cell_id: { type: 'string', description: 'The cell to replace or delete, or to insert after' },
      new_source: { type: 'string', description: 'The cell source for replace and insert' },
      cell_type: { type: 'string', enum: ['code', 'markdown'] },
      edit_mode: { type: 'string', enum: ['replace', 'insert', 'delete'] },
    },
    required: ['notebook_path'],
    additionalProperties: false,
  },
  effect: 'write_workspace',
  replay: 'unsafe',
  // The path the policy checks, as edit and write give theirs: outside the working directory and git's or cedia's
  // own config are denied.
  pathOf: (input) => (typeof input.notebook_path === 'string' ? input.notebook_path : undefined),
  opensFile: true,
  async run(input, ctx) {
    const given = String(input.notebook_path ?? '');
    const path = toolPath(given, ctx.cwd);
    const mode = String(input.edit_mode ?? 'replace');
    const cellId = input.cell_id !== undefined ? String(input.cell_id) : undefined;
    const newSource = input.new_source !== undefined ? String(input.new_source) : '';
    const cellType = input.cell_type ? String(input.cell_type) : 'code';
    try {
      const { nb, cells } = loadNotebook(path);
      if (mode === 'delete') {
        if (cellId === undefined) return { text: 'cell_id required for delete', isError: true };
        const idx = findCell(cells, cellId);
        if (idx < 0) return { text: `cell not found: ${cellId}`, isError: true };
        cells.splice(idx, 1);
      } else if (mode === 'insert') {
        const cell: Cell = { cell_type: cellType, source: newSource, metadata: {}, outputs: cellType === 'code' ? [] : undefined, execution_count: null };
        if (cellId === undefined) {
          cells.push(cell);
        } else {
          const idx = findCell(cells, cellId);
          const at = idx < 0 ? cells.length : idx + 1;
          cells.splice(at, 0, cell);
        }
      } else {
        // replace
        if (cellId === undefined) return { text: 'cell_id required for replace', isError: true };
        const idx = findCell(cells, cellId);
        if (idx < 0) return { text: `cell not found: ${cellId}`, isError: true };
        cells[idx]!.source = newSource;
        if (input.cell_type) cells[idx]!.cell_type = cellType;
      }
      nb.cells = cells;
      // atomic write
      const tmp = join(dirname(path) || '.', `.nb-${randomBytes(6).toString('hex')}.tmp`);
      writeFileSync(tmp, JSON.stringify(nb, null, 1));
      renameSync(tmp, path);
      return { text: `notebook ${mode} ok`, isError: false };
    } catch (e) {
      return { text: (e as Error).message, isError: true };
    }
  },
};

function findCell(cells: Cell[], id: string): number {
  // A cell's id first; a number that matches no id is an index.
  const n = Number(id);
  const byId = cells.findIndex((c) => c.id === id);
  if (byId >= 0) return byId;
  if (Number.isInteger(n) && n >= 0 && n < cells.length) return n;
  return -1;
}
