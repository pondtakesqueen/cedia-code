import { describe, expect, test } from 'bun:test';
import { CONTINUE_AFTER_LIMIT, EMPTY_REPLY, endGuards, judgeEnd, MAX_STOP_REFUSALS, pass, stopHookReminder, unverifiedReminder, type EndGuard, type TurnEnd } from '../src/core/loop/guards.ts';

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

// The rules themselves, read from a turn alone: no loop, no log.
describe('the guards of one run', () => {
  const turn = (over: Partial<TurnEnd> = {}): TurnEnd => ({ stop: 'end_turn', text: 'done', slop: () => [], verified: () => true, checks: ['bun test'], softChecks: false, stopHook: async () => undefined, ...over });
  const first = async (g: ReturnType<typeof endGuards>, t: TurnEnd) => judgeEnd(g.guards(t));

  test('a clean claim passes every guard', async () => {
    expect(await first(endGuards(), turn())).toBeUndefined();
  });

  test('a reply cut at the output limit is told to go on, every time', async () => {
    const g = endGuards();
    for (let i = 0; i < 3; i++) expect((await first(g, turn({ stop: 'max_tokens' })))?.verdict).toEqual({ kind: 'remind', text: CONTINUE_AFTER_LIMIT });
  });

  test('an empty reply is reminded once, then stops; a turn that did something resets it', async () => {
    const g = endGuards();
    expect((await first(g, turn({ text: ' ' })))?.verdict).toEqual({ kind: 'remind', text: EMPTY_REPLY });
    expect((await first(g, turn({ text: '' })))?.verdict).toEqual({ kind: 'stop', stop: { as: 'empty-reply' } });
    g.activity();
    expect((await first(g, turn({ text: '' })))?.verdict.kind).toBe('remind');
  });

  test('the done gate reminds once and asks to escalate, then refuses the claim', async () => {
    const g = endGuards();
    expect((await first(g, turn({ verified: () => false })))).toEqual({ name: 'done-gate', verdict: { kind: 'remind', text: unverifiedReminder(['bun test']), escalate: true } });
    expect((await first(g, turn({ verified: () => false })))?.verdict).toEqual({ kind: 'stop', stop: { as: 'unverified' } });
  });

  test('with soft checks the done gate reminds once and never refuses', async () => {
    const g = endGuards();
    expect((await first(g, turn({ verified: () => false, softChecks: true })))?.verdict.kind).toBe('remind');
    expect(await first(g, turn({ verified: () => false, softChecks: true }))).toBeUndefined();
  });

  test('the slop guard names what it found once, and is not scanned after', async () => {
    const g = endGuards();
    let scans = 0;
    const slop = () => (scans++, [{ kind: 'skipped-test', file: 'a.test.ts', line: 1, text: 'test.skip(' }] as unknown as ReturnType<TurnEnd['slop']>);
    expect((await first(g, turn({ slop })))?.name).toBe('slop');
    expect(await first(g, turn({ slop }))).toBeUndefined();
    expect(scans).toBe(1);
  });

  test('stop hooks may refuse twice; the third refusal ends the run unverified', async () => {
    const g = endGuards();
    const stopHook = async () => ({ hook: 'lint', reason: 'lint fails' });
    expect((await first(g, turn({ stopHook })))?.verdict).toEqual({ kind: 'remind', text: stopHookReminder('lint', 'lint fails') });
    expect((await first(g, turn({ stopHook })))?.verdict.kind).toBe('remind');
    expect((await first(g, turn({ stopHook })))?.verdict).toEqual({ kind: 'stop', stop: { as: 'unverified' } });
    expect(MAX_STOP_REFUSALS).toBe(2);
  });

  test('a refusal stops the run before any reminder, even on an empty reply', async () => {
    const refusal = { category: 'cyber', explanation: 'no' };
    expect(await first(endGuards(), turn({ stop: 'refusal', text: '', refusal }))).toEqual({ name: 'refusal', verdict: { kind: 'stop', stop: { as: 'refusal', refusal } } });
  });
});
