import { isMode, loadRoles, type RoleChoice } from './config.ts';
import type { ThreadStore } from './threads/threads.ts';
import { resolveModel } from './providers/catalog.ts';
import type { ModelSpec } from './types.ts';

// The model a side task runs on: a commit message, an inline edit or a completion (`write`), or a review or a change
// guide (`review`). Every client asks here, so `cedia commit` and the TUI's /commit, or `cedia review` and /review,
// pick the same model for the same thread.
//
// In order: the model named for this call (`--model`); for a review, the review role when cedia runs it (a Claude
// Code review role has no cedia model, so it is skipped); the model picked in the client, unless it is a mode
// (`auto`, `oplan`), which keeps the code role's writer; the thread's last writer; the code role.
export type SidePurpose = 'write' | 'review';

export type SideModelInput = { explicit?: string; picked?: string; threadWriter?: string };

export function sideModel(purpose: SidePurpose, opts: SideModelInput, roles: { code: ModelSpec; review?: RoleChoice } = loadRoles({})): ModelSpec {
  if (opts.explicit) return resolveModel(opts.explicit);
  if (purpose === 'review' && roles.review?.via === 'cedia') return roles.review.model;
  const picked = opts.picked && !isMode(opts.picked) ? opts.picked : undefined;
  const ref = picked ?? opts.threadWriter;
  return ref ? resolveModel(ref) : roles.code;
}

// The model the thread's last kept session ran on (a rewound one is not the writer any more).
export const threadWriter = (store: ThreadStore, id: string): string | undefined =>
  store.read(id).sessions.filter((s) => !s.rewound).at(-1)?.model;
