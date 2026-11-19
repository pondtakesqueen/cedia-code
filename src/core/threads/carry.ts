import { existsSync, realpathSync, statSync } from 'node:fs';
import { inert } from '../trust/frame.ts';
import { titleOf, type Thread, type ThreadStore } from './threads.ts';

// `cedia threads carry <id> --to <dir>`: a chat goes on in another project. Its session cannot follow: the
// conversation's first message names the old folder and the cached prefix is that message's bytes (SPEC "Cache
// rules"), and the files it read are not in the new folder. So the new project gets a new thread whose task is a
// recap of this one, written from the thread file with no model call, and the old thread is archived with a
// result that says where it went. Nothing is moved or deleted; both thread files stay as they were, appended to.
//
//   the new thread  an `open` event (the old title, the recap as its task), then `stopped`, since nothing runs
//                   until the owner writes to it; the next run's opening note carries the recap (resumeNote).
//   the old thread  `done` with a result naming the new thread and folder, then `archived`.
//
// The desktop runs it when the owner allows an add_project request that asked for a carry (core/tools/project.ts).

// What `threads carry <id> --to <dir> --json` prints: the new thread and the folder whose project it is in.
export type CarryResult = { thread: string; cwd: string; from: string };

// Enough of each later message to know what the owner asked; the recall of a whole log is not carried.
const MAX_SAID = 1500;
const MAX_MESSAGES = 12;

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

// The new thread's task: where the chat came from, what it was about, what the owner said since, and where it
// stopped. Every piece is the owner's or a model's earlier words, so each is made inert.
export function carryTask(t: Thread, fromRoot: string): string {
  const later = t.runs.slice(1).map((r) => r.prompt.trim()).filter(Boolean).slice(-MAX_MESSAGES);
  const said = later.length ? `\n\nWhat the owner said after it, oldest first:\n\n${later.map((p) => `<message>\n${inert(clip(p, MAX_SAID))}\n</message>`).join('\n')}` : '';
  const stop = t.handoff ? `<handoff>\n${inert(t.handoff.note)}\n</handoff>` : t.result ? `<result>\n${inert(t.result)}\n</result>` : '';
  return `This chat was carried over from thread ${t.id} ("${inert(t.title)}") of the project in ${fromRoot}, at the owner's request. That thread is archived and its logs stay with that project, so nothing here can recall them. Paths it named are in ${fromRoot}, not here.\n\nIts first task was:\n\n<task>\n${inert(t.task)}\n</task>${said}${stop ? `\n\nWhere it stopped:\n\n${stop}` : ''}`;
}

export function carryThread(from: ThreadStore, id: string, fromRoot: string, to: ThreadStore, toDir: string, now = new Date()): CarryResult | { error: string } {
  if (!from.has(id)) return { error: `no thread ${id} in this project` };
  if (!existsSync(toDir) || !statSync(toDir).isDirectory()) return { error: `${toDir} is not a folder` };
  const t = from.read(id);
  if (t.running) return { error: `thread ${id} is running; stop it first` };
  if (t.side) return { error: `thread ${id} is a side chat, which stays with its thread` };
  const cwd = realpathSync(toDir);
  const thread = to.open(carryTask(t, fromRoot), { title: titleOf(t.title || t.task), now });
  to.append(thread, { kind: 'state', state: 'stopped', result: `Carried over from thread ${id} of ${fromRoot}. Write to go on.` }, now);
  from.append(id, { kind: 'state', state: 'done', result: `Carried over to thread ${thread} of the project in ${cwd}.` }, now);
  from.append(id, { kind: 'archived', archived: true }, now);
  return { thread, cwd, from: id };
}
