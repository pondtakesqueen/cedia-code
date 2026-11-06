import type { ThreadArgs } from '../../core/run/thread.ts';

// The arguments a terminal UI runs with: everything headless takes except the prompt itself (typed, not given),
// how the run is shown (a live screen: every message as it comes, no summary lines), and the run controls the TUI
// owns (note, signal).
export type TuiArgs = Omit<ThreadArgs, 'prompt' | 'note' | 'signal' | 'live' | 'summary'>;
