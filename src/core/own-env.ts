import { userSettings } from './config.ts';
import { CATALOG } from './providers/catalog.ts';
import { SECRET_ENV } from './safety/secrets.ts';

// The environment of the programs cedia runs on its own behalf, not the model's: git for the status line, /diff,
// /commit and /pr (and the repository's hooks, filters and credential helper under it), gh, ripgrep, ffmpeg.
// They keep the user's environment, which git and gh need (GH_TOKEN, SSH_AUTH_SOCK, proxies), but never the keys
// cedia calls its models with: a pre-commit hook of a repository just cloned would otherwise read them.
// The model's own commands get the stricter scrubbedEnv (tools/bash.ts). Claude Code 2.1.323 made the same change
// for its git and ripgrep.
const PROVIDER_KEYS = new Set(['ANTHROPIC_AUTH_TOKEN', ...CATALOG.flatMap((m) => [m.auth.env, m.auth.altEnv ?? ''])].filter(Boolean));

// A local model's key (`authEnv` in localModels) is named by the user, so it is read from the settings.
function localKeys(): Set<string> {
  try {
    const raw = userSettings().localModels;
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.flatMap((e) => (e && typeof e === 'object' && typeof (e as { authEnv?: unknown }).authEnv === 'string' ? [(e as { authEnv: string }).authEnv] : [])));
  } catch {
    return new Set();
  }
}

export function ownEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const local = localKeys();
  // cedia's own secret-looking variables (CEDIA_ANTHROPIC_API_KEY, CEDIA_FAUX_KEY) go too; CEDIA_GH_BIN and the
  // like stay, since tests and the user point cedia at programs with them.
  const dropped = (name: string) => PROVIDER_KEYS.has(name) || local.has(name) || (name.startsWith('CEDIA_') && SECRET_ENV.test(name));
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !dropped(e[0])));
}
