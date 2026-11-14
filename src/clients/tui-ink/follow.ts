// Following the open thread while another cedia runs it: the desktop, the daemon or `cedia -p --thread` write to
// the same thread file, so the TUI reads it again when it changes and says what started and ended there. Runs of
// this process are its own turns, already on screen. busy.ts keeps two runs of a thread from overlapping, so a run
// another process holds is the thread's only one.
import type { Thread } from '../../core/threads/threads.ts';

export type FollowMark = { runs: number; running: boolean };

export const markOf = (t: Thread): FollowMark => ({ runs: t.runs.length, running: t.running });

const firstLine = (text: string, max = 120) => {
  const line = text.trim().split('\n')[0]!.trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
};

/** What to tell about the thread since `mark`, and the mark after. `self` is this process's pid. */
export function followLines(t: Thread, mark: FollowMark, self: number): { lines: string[]; mark: FollowMark } {
  const lines: string[] = [];
  const fresh = t.runs.slice(mark.runs);
  const last = t.runs.at(-1);
  const ours = (pid?: number) => pid === self;
  for (const r of fresh) {
    if (ours(r.pid)) continue;
    const ended = r !== last || !t.running;
    lines.push(`another cedia${r.pid ? ` (pid ${r.pid})` : ''} ${ended ? 'ran' : 'started a run of'} this thread: ${firstLine(r.prompt)}`);
  }
  // The last run ended since the last look: it was running then, or it started and ended in between.
  const endedNow = last && !ours(last.pid) && !t.running && (mark.running || fresh.includes(last));
  if (endedNow) {
    if (t.state === 'asking' && t.question) lines.push(`that run asks you: ${firstLine(t.question.question)}`);
    else {
      const said = { done: 'is done', failed: 'failed', stopped: 'was stopped' }[t.state as string] ?? `ended (${t.state})`;
      lines.push(`that run ${said}${t.result ? `: ${firstLine(t.result)}` : ''}`);
    }
  }
  return { lines, mark: markOf(t) };
}
