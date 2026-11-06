import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runThread } from '../src/core/run/thread.ts';
import type { CoreMessage } from '../src/protocol/index.ts';

// The TUI runs a prompt in its own process through runThread and takes its messages as objects, with no JSONL in
// between. These are the messages `-p --output-format stream-json` writes as lines (test/headless.test.ts).
const saved = { script: process.env.CEDIA_FAUX_SCRIPT, home: process.env.CEDIA_HOME };
afterEach(() => {
  for (const [k, v] of [['CEDIA_FAUX_SCRIPT', saved.script], ['CEDIA_HOME', saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function run(live: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-run-thread-'));
  writeFileSync(join(dir, 'script.json'), JSON.stringify([{ blocks: [{ type: 'text', text: 'streamed' }] }]));
  process.env.CEDIA_FAUX_SCRIPT = join(dir, 'script.json');
  process.env.CEDIA_HOME = join(dir, 'home');
  const got: CoreMessage[] = [];
  const notes: string[] = [];
  const result = await runThread({ prompt: 'go', model: 'faux', cwd: dir, live, note: (t) => void notes.push(t) }, (m) => void got.push(m));
  return { got, notes, result };
}

test('live: every session event and the stream as objects, then the result itself', async () => {
  const { got, result } = await run(true);
  expect(got.at(-1)).toBe(result);
  expect(result).toMatchObject({ type: 'result', subtype: 'success', result: 'streamed' });
  expect(got.some((m) => m.type === 'stream' && m.event.type === 'text_delta')).toBe(true);
  expect(got.flatMap((m) => (m.type === 'event' ? [m.event.kind] : []))).toEqual(['session', 'reminder', 'user', 'request', 'attempt', 'assistant', 'turn_end']);
});

test('not live: only the result, and no summary lines unless asked', async () => {
  const { got, notes, result } = await run(false);
  expect(got).toEqual([result]);
  expect(notes.join('')).not.toContain('cedia thread:');
});
