import { expect, test } from 'bun:test';
import { resolveModel } from '../src/core/providers/catalog.ts';
import { sideModel } from '../src/core/side-model.ts';

// One rule for the model a side task (a commit message, a review, a change guide, an inline edit) runs on, so the
// CLI and the TUI pick the same model for the same task.
const code = resolveModel('anthropic/claude-haiku-5-5');
const reviewer = resolveModel('anthropic/claude-opus-5-5');
const plain = { code };
const withReview = { code, review: { via: 'cedia' as const, model: reviewer } };
const viaClaudeCode = { code, review: { via: 'claude-code' as const, model: 'opus', effort: 'medium' as const } };
const writer = 'anthropic/claude-sonnet-5-5';

test.each([
  ['write', {}, plain, code.ref],
  ['write', { threadWriter: writer }, plain, writer],
  ['write', { picked: 'faux', threadWriter: writer }, plain, 'faux/scripted'],
  ['write', { picked: 'auto', threadWriter: writer }, plain, writer],
  ['write', { explicit: 'faux', picked: 'anthropic/claude-opus-5-5', threadWriter: writer }, plain, 'faux/scripted'],
  ['write', {}, withReview, code.ref],
  ['review', {}, plain, code.ref],
  ['review', { threadWriter: writer }, plain, writer],
  ['review', { threadWriter: writer, picked: 'faux' }, withReview, reviewer.ref],
  ['review', { picked: 'faux' }, viaClaudeCode, 'faux/scripted'],
  ['review', { picked: 'oplan', threadWriter: writer }, viaClaudeCode, writer],
  ['review', { explicit: 'faux' }, withReview, 'faux/scripted'],
] as const)('%s %o', (purpose, opts, roles, want) => {
  expect(sideModel(purpose, opts, roles).ref).toBe(want);
});
