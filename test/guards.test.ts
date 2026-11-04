import { describe, expect, test } from 'bun:test';
import { judgeEnd, pass, type EndGuard } from '../src/core/loop/guards.ts';

describe('end-of-turn guards', () => {
  test('the first guard that does not pass decides, and the guards after it are not judged', async () => {
    const judged: string[] = [];
    const guard = (name: EndGuard['name'], verdict: Awaited<ReturnType<EndGuard['judge']>>): EndGuard => ({ name, judge: () => (judged.push(name), verdict) });
    const ended = await judgeEnd([guard('output-limit', pass), guard('empty-reply', { kind: 'remind', text: 'go on' }), guard('done-gate', pass)]);
    expect(ended).toEqual({ name: 'empty-reply', verdict: { kind: 'remind', text: 'go on' } });
    expect(judged).toEqual(['output-limit', 'empty-reply']);
  });

  test('every guard passing lets the claim through; an async guard is awaited', async () => {
    expect(await judgeEnd([{ name: 'slop', judge: () => pass }, { name: 'stop-hooks', judge: async () => pass }])).toBeUndefined();
  });
});
