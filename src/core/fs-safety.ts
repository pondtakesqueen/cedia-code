import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

// Path and secret facts that the policy, the sandbox, the file tools, instructions, skills and the classifier all
// judge with. One copy each, in a leaf that imports nothing of cedia's, so two parts can never read one path two
// ways (the tilde bypass of 2026-11-06 was exactly that).

// `~` and `~/…` are the home directory; anything else is left as written.
export const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? homedir() + p.slice(1) : p);

// The file a path a tool was given names: `~` expanded, a relative path read from `cwd`.
export function toolPath(path: string, cwd: string): string {
  const expanded = expandHome(path);
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

// The real path of a file that exists, or undefined for one that does not (or cannot be read).
export const realExisting = (p: string): string | undefined => {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
};

// Resolves symlinks on the part of the path that exists, so a link out of the workspace is caught. A part that
// cannot be read (EPERM under the OS sandbox, which denies ~/.ssh even a stat) counts as one that does not exist:
// nothing can follow a link through it either, and throwing here failed every call that named such a path.
export function realPrefix(path: string, realpath: (p: string) => string = realpathSync): string {
  let head = path;
  const tail: string[] = [];
  for (;;) {
    if (existsSync(head)) {
      try {
        return resolve(realpath(head), ...tail);
      } catch {}
    }
    const up = dirname(head);
    if (up === head) return path;
    tail.unshift(head.slice(up.length).replace(/^\//, ''));
    head = up;
  }
}

// `p` is `root` or under it. Both are taken as given: resolve links first where that matters.
export const inside = (root: string, p: string): boolean => {
  const rel = relative(root, p);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
};

// `p` is under `root` and not `root` itself.
export const strictlyInside = (root: string, p: string): boolean => p !== root && relative(root, p) !== '' && inside(root, p);

// Files named like credentials: never imported into instructions, listed or read by a skill, shown to the
// classifier, or searched by grep. The globs are the source; the name test is made from them.
export const SECRET_GLOBS = ['.env', '.env.*', '*.pem', '*.key', '*.p12', '*.pfx', '*.keystore', '*.jks', 'id_rsa*', 'id_dsa*', 'id_ecdsa*', 'id_ed25519*', '.netrc', '.npmrc', '.pypirc', 'credentials', 'credentials.json'];
export const SECRET_NAME = new RegExp(`^(${SECRET_GLOBS.map((g) => g.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')).join('|')})$`, 'i');

// A file under `root` that cedia keeps away from what it reads on the model's behalf: one named like a
// credential, or anything inside .git.
export const isSecretFile = (root: string, p: string): boolean => SECRET_NAME.test(basename(p)) || relative(root, p).split(sep).includes('.git');
