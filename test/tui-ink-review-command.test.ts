import { afterEach, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewCommand, type CommandCtx } from '../src/clients/tui-ink/command-review.ts';
import { ThreadStore } from '../src/core/project/threads.ts';

// The TUI's /review runs on a context of plain functions, so it is tested without Ink.
const saved = { script: process.env.CEDIA_FAUX_SCRIPT, home: process.env.CEDIA_HOME };
afterEach(() => {
  for (const [k, v] of [['CEDIA_FAUX_SCRIPT', saved.script], ['CEDIA_HOME', saved.home]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const git = (cwd: string, ...args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function setup(replies: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'cedia-review-cmd-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'user.email', 't@t');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'Start');
  writeFileSync(join(dir, 'base.txt'), 'base\nextra\n');
  const script = join(dir, '.git', 'script.json');
  writeFileSync(script, JSON.stringify(replies.map((text) => ({ blocks: [{ type: 'text', text }] }))));
  process.env.CEDIA_FAUX_SCRIPT = script;
  process.env.CEDIA_HOME = join(dir, '.git', 'home');
  const said: string[] = [];
  const replied: string[] = [];
  const sent: string[] = [];
  const asked: { what: string; yes: () => Promise<void> | void }[] = [];
  let spent = 0;
  const ctx: CommandCtx = {
    cwd: dir,
    model: 'faux',
    store: new ThreadStore(join(dir, '.git', 'threads')),
    policy: { allow: [], deny: [], unlock: [] },
    say: (t) => said.push(t),
    reply: (t) => replied.push(t),
    toolEvent: () => {},
    spend: (usd) => (spent += usd),
    confirm: (what, yes) => asked.push({ what, yes }),
    send: (p) => void sent.push(p),
  };
  return { ctx, said, replied, sent, asked, spent: () => spent };
}

test('/review shows the review, and on findings offers to send them to the writer', async () => {
  const t = setup(['Read it.\nFINDING: base.txt:2 adds a line nobody asked for\nVERDICT: changes']);
  await reviewCommand(t.ctx);
  expect(t.said[0]).toBe('reviewing the uncommitted changes with faux/scripted…');
  expect(t.replied.join('\n')).toContain('FINDING: base.txt:2');
  expect(t.said.some((s) => s.startsWith('review done · 1 turn'))).toBe(true);
  expect(t.asked.map((a) => a.what)).toEqual(['sending the findings']);
  await t.asked[0]!.yes();
  expect(t.sent[0]).toContain('base.txt:2 adds a line nobody asked for');
});

test('/review that approves asks nothing', async () => {
  const t = setup(['Looks fine.\nVERDICT: approve']);
  await reviewCommand(t.ctx);
  expect(t.asked).toEqual([]);
  expect(t.sent).toEqual([]);
});
