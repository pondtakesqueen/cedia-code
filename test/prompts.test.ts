import { describe, expect, test } from 'bun:test';
import { BASE_SYSTEM, preamble, READ_ONLY_SYSTEM, systemFor, timeNote } from '../src/core/prompts.ts';
import type { SessionEvent } from '../src/core/types.ts';
import { CATALOG, FAUX_MODEL, resolveModel } from '../src/core/providers/catalog.ts';

describe('system prompt per model', () => {
  test("DeepSeek Flash and Opus get their own lines after the base; other models get the base alone", () => {
    for (const ref of ['opencode-go/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash', 'openrouter/deepseek-v4.1-flash']) {
      const s = systemFor(resolveModel(ref));
      expect(s.startsWith(`${BASE_SYSTEM}\n\nFor this model in particular:\n`)).toBe(true);
      expect(s).toContain('Do not create test files of your own.');
      expect(s).toContain('Run a check once after your last change.');
    }
    expect(systemFor(resolveModel('haiku'))).toBe(BASE_SYSTEM);
    for (const ref of ['opus', 'anthropic/claude-opus-5-5-fast']) {
      const s = systemFor(resolveModel(ref));
      expect(s.startsWith('You are cedia')).toBe(true);
      expect(s).toContain('\n\nFor this model in particular, correctness comes before brevity:\n');
      expect(s).toContain('Walk the failure paths');
    }
    expect(systemFor(resolveModel('sonnet'))).toBe(BASE_SYSTEM);
    expect(systemFor(FAUX_MODEL)).toBe(BASE_SYSTEM);
  });

  test("Opus gets the base without its turn-saving lines; every other model keeps them word for word", () => {
    const turnSaving = ['so it costs the user time and money', 'Extra probes, edge cases or improvements nobody asked for widen the change and cost turns'];
    for (const m of CATALOG) {
      const s = systemFor(m);
      for (const line of turnSaving) expect(s.includes(line)).toBe(!m.thorough);
      if (!m.thorough) expect(s.startsWith(BASE_SYSTEM)).toBe(true);
    }
    expect(CATALOG.filter((m) => m.thorough).map((m) => m.ref)).toEqual(['anthropic/claude-opus-5-5', 'anthropic/claude-opus-5-5-fast']);
    const opus = systemFor(resolveModel('opus'));
    expect(opus).toContain('Leave improvements nobody asked for out of the change.');
  });

  test('a thorough writer checks, probes and reads its diff before it stops, and adds tests in a new file when told to', () => {
    const s = systemFor({ thorough: true });
    const at = (line: string) => {
      const i = s.indexOf(line);
      expect([line, i >= 0]).toEqual([line, true]);
      return i;
    };
    const order = ['1. Run a declared check', '2. Probe your own change', '3. Read your whole diff', '4. If step 2 or 3 changed anything', 'Then stop: write the report and end.', '- Finish with a short report'].map(at);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(s).toContain('Keep what makes a stated rule hold, the state after an error included.');
    expect(s).toContain('put new tests in a new test file');
    expect(s).not.toContain('Prefer the smallest change that solves the task.');
    expect(s).not.toContain('when the task lets you change tests');
  });

  test('a session that only reads is not told to edit, check its change or read its own diff', () => {
    for (const line of ['Change files with edit', 'Run the project\'s checks after a change', 'git diff', 'smallest change'])
      expect([line, READ_ONLY_SYSTEM.includes(line)]).toEqual([line, false]);
    expect(READ_ONLY_SYSTEM).toContain('you change nothing');
    expect(READ_ONLY_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}|\/home\/|\/Users\/|\$\{/);
  });

  test('a model prompt holds no per-session value, so the prefix stays cacheable (cache rule 1)', () => {
    for (const m of CATALOG.filter((c) => c.prompt)) expect(m.prompt).not.toMatch(/\d{4}-\d{2}-\d{2}|\/home\/|\/Users\/|\$\{/);
  });

  test('the sandbox line names $TMPDIR as the place for scratch files', () => {
    const p = preamble('/w', { sandbox: { on: true, allowedDomains: [] } }, new Date('2026-10-22'));
    expect(p).toContain('the temp dir ($TMPDIR, which is not always /tmp: put scratch files there or in the working directory)');
  });
});

describe('time note on a resumed session', () => {
  const ev = (at: string, body: Record<string, unknown>) => ({ id: crypto.randomUUID(), parentId: null, at, ...body }) as unknown as SessionEvent;
  const session = (opened: string, lastRequest: string, later: string[] = []): SessionEvent[] => [
    ev(opened, { kind: 'session', cwd: '/', role: 'code', model: 'faux/scripted', system: '', tools: [] }),
    ev(opened, { kind: 'user', text: `<environment>\nworking directory: /\ndate: ${opened.slice(0, 10)}\nplatform: linux\n</environment>\n\ngo` }),
    ...later.map((text) => ev(lastRequest, { kind: 'user', text })),
    ev(lastRequest, { kind: 'request', model: 'faux/scripted', toolsHash: '', systemHash: '', bodyHash: '', headers: {} }),
  ];

  test('the same day and a short gap say nothing', () => {
    expect(timeNote(session('2026-11-01T09:00:00Z', '2026-11-01T10:00:00Z'), new Date('2026-11-01T12:00:00Z'))).toBeUndefined();
  });

  test('a new day says the date and how long since the last message', () => {
    expect(timeNote(session('2026-11-01T22:00:00Z', '2026-11-01T23:00:00Z'), new Date('2026-11-02T01:00:00Z'))).toBe('<time>\ntoday: 2026-11-02, the last message was 2 hours ago\n</time>');
  });

  test('more than six hours on the same day says so too', () => {
    expect(timeNote(session('2026-11-01T01:00:00Z', '2026-11-01T02:00:00Z'), new Date('2026-11-01T09:00:00Z'))).toBe('<time>\ntoday: 2026-11-01, the last message was 7 hours ago\n</time>');
  });

  test('a date the session was already told is not said again', () => {
    const told = ['<time>\ntoday: 2026-11-02, the last message was 14 hours ago\n</time>\n\nnext'];
    expect(timeNote(session('2026-11-01T09:00:00Z', '2026-11-02T08:00:00Z', told), new Date('2026-11-02T09:00:00Z'))).toBeUndefined();
  });

  test('reads the date from the preamble cedia writes', () => {
    const opened = new Date('2026-11-01T09:00:00Z');
    const events = session('2026-11-01T09:00:00Z', '2026-11-01T10:00:00Z');
    (events[1] as { text: string }).text = `${preamble('/x', {}, opened)}\n\ngo`;
    expect(timeNote(events, new Date('2026-11-01T11:00:00Z'))).toBeUndefined();
    expect(timeNote(events, new Date('2026-11-02T11:00:00Z'))).toBe('<time>\ntoday: 2026-11-02, the last message was 25 hours ago\n</time>');
  });

  test('days are counted past 48 hours', () => {
    expect(timeNote(session('2026-11-01T09:00:00Z', '2026-11-01T10:00:00Z'), new Date('2026-11-04T11:00:00Z'))).toBe('<time>\ntoday: 2026-11-04, the last message was 3 days ago\n</time>');
  });
});
