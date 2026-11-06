import { cediaHome } from '../config.ts';
import { MAX_NOTE } from '../project/memory.ts';
import { notesPass } from '../project/consolidate.ts';

// `cedia memory extract`: a shorter pass than consolidation, on the beam model, keeping at most five notes.
const SYSTEM = `You extract durable memories from a session transcript. Keep short facts (commands that work, decisions and reasons, where things live, traps). Not progress. At most ${MAX_NOTE} chars per note. Use remember tool, at most 5 notes. If nothing durable, call nothing.`;

export async function gatherNotes(opts: { cwd: string; home?: string; model?: string; force?: boolean; now?: Date }) {
  const { ran, skipped, ...rest } = await notesPass({ ...opts, home: opts.home ?? cediaHome() }, {
    role: 'extract',
    from: 'extract',
    system: SYSTEM,
    prompt: (text) => `Extract durable memories from these transcripts:\n\n${text}`,
    maxTurns: 6,
    model: () => 'beam',
    busy: 'concurrent',
  });
  return { extracted: ran, ...(skipped ? { skipped } : {}), ...rest };
}
