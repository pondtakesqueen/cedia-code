import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatMessages } from '../src/core/providers/chat.ts';
import { localModels } from '../src/core/providers/catalog.ts';
import type { WireRequest } from '../src/core/types.ts';

// A model declared under `localModels` gets the reasoning handling its wire reads, the way a catalog model on the
// same wire does. The harness leaderboard (joelniklaus/harness-leaderboard, CHANGELOG 2026-11-16) found a harness
// that did not resend reasoning on providers it did not know losing score; a DeepSeek-style tool loop wants it back.

const before = process.env.CEDIA_HOME;
afterEach(() => {
  if (before === undefined) delete process.env.CEDIA_HOME;
  else process.env.CEDIA_HOME = before;
});

function declare(...models: object[]) {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-lm-'));
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ localModels: models }));
  process.env.CEDIA_HOME = dir;
}

const base = { url: 'http://127.0.0.1:8000/v1/chat/completions' };

test('a reasoning model on each wire gets that wire\'s reasoning kind', () => {
  declare(
    { ...base, ref: 'local/chat', reasoning: true },
    { ...base, ref: 'local/resp', wire: 'openai-responses', reasoning: true },
    { ...base, ref: 'local/plain' },
  );
  const [chat, resp, plain] = localModels();
  expect(chat!.caps.reasoning).toBe('reasoning_content');
  expect(resp!.caps.reasoning).toBe('responses-item');
  expect(plain!.caps.reasoning).toBe('none');
});

test('a chat reasoning model gets its reasoning back inside a tool loop, and not from earlier turns', () => {
  declare({ ...base, ref: 'local/chat', reasoning: true });
  const model = localModels()[0]!;
  expect(model.caps.replayReasoning).toBe('same-turn');
  const think = (text: string) => ({ role: 'assistant' as const, wire: 'chat-completions', blocks: [{ type: 'thinking', text }, { type: 'tool_use', id: `c-${text}`, name: 'read', input: {} }] });
  const result = (id: string) => ({ role: 'user' as const, parts: [{ type: 'tool_result', callId: id, text: 'ok' }] });
  const req = {
    model,
    system: 's',
    tools: [],
    maxTokens: 1000,
    messages: [
      { role: 'user', parts: [{ type: 'text', text: 'first' }] },
      think('old'),
      result('c-old'),
      { role: 'user', parts: [{ type: 'text', text: 'second' }] },
      think('new'),
      result('c-new'),
    ],
  } as unknown as WireRequest;
  const assistants = chatMessages(req).filter((m) => m.role === 'assistant');
  expect(assistants.map((m) => m.reasoning_content)).toEqual([undefined, 'new']);
});

test('a declared replayReasoning wins', () => {
  declare({ ...base, ref: 'local/chat', reasoning: true, replayReasoning: 'forbidden' });
  expect(localModels()[0]!.caps.replayReasoning).toBe('forbidden');
});
