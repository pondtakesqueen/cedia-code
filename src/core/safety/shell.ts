// Best-effort shell reading for the permission policy. It is not a shell parser: it splits a command
// into simple commands so a rule can look at each one's argv. The sandbox is the real boundary.

// What a backslash and the character after it leave in a word, as bash reads them: outside quotes the character
// itself (a backslash-newline joins two lines and leaves nothing); inside double quotes it escapes only $ ` " \
// and a newline, and is kept before anything else. Every word split in cedia goes through this, so the read-only
// check and the policy cannot read one word two ways.
export function unescape(next: string, inDouble: boolean): string {
  if (next === '\n') return '';
  if (!inDouble) return next;
  return '$`"\\'.includes(next) ? next : `\\${next}`;
}

const SEPARATORS = new Set([';', '\n', '&', '|', '(', ')', '`']);
// Commands that run the rest of their argv as another command. `value` lists the flags whose next word is
// their value (`nice -n 5 make` runs make, not 5); `positional` counts operands before the command (`timeout 5 make`).
type Wrapper = { value?: string[]; positional?: number };
const WRAPPERS = new Map<string, Wrapper>([
  ['sudo', { value: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U', '--user', '--group', '--host', '--prompt', '--chdir', '--role', '--type', '--other-user', '--close-from'] }],
  ['doas', { value: ['-u', '-C'] }],
  ['env', { value: ['-u', '-C', '-S', '--unset', '--chdir', '--split-string'] }],
  ['command', {}],
  ['nohup', {}],
  ['time', { value: ['-f', '-o', '--format', '--output'] }],
  ['exec', { value: ['-a'] }],
  ['nice', { value: ['-n', '--adjustment'] }],
  ['ionice', { value: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'] }],
  ['setsid', {}],
  ['stdbuf', { value: ['-i', '-o', '-e', '--input', '--output', '--error'] }],
  ['timeout', { value: ['-s', '-k', '--signal', '--kill-after'], positional: 1 }],
  ['xargs', { value: ['-a', '-d', '-E', '-e', '-I', '-i', '-L', '-l', '-n', '-P', '-s', '--arg-file', '--delimiter', '--eof', '--replace', '--max-lines', '--max-args', '--max-procs', '--max-chars', '--process-slot-var'] }],
]);
const KEYWORDS = new Set(['{', '}', '!', 'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until']);

// Splits on ; & | && || newlines, subshells, $( ) and backticks outside quotes, then into words.
// Heredoc bodies are data, except for the $( ) and backtick substitutions an unquoted delimiter lets run.
// Returns null for unbalanced quotes or substitutions.
export function simpleCommands(command: string): string[][] | null {
  const out: string[][] = [];
  const fromHeredocs: string[][] = [];
  const heredocs: { delim: string; quoted: boolean; dash: boolean }[] = [];
  let words: string[] = [];
  let cur = '';
  let has = false;
  let quote: '"' | "'" | null = null;
  const endWord = () => {
    if (cur || has) words.push(cur);
    cur = '';
    has = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) cur += unescape(command[++i]!, true);
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === '\\' && i + 1 < command.length) {
      cur += unescape(command[++i]!, false);
      has = true;
    } else if (ch === '&' && (command[i - 1] === '>' || command[i + 1] === '>')) {
      cur += ch; // 2>&1 and &> are redirections, not background jobs
    } else if (ch === '<' && command[i + 1] === '<' && command[i + 2] !== '<') {
      endWord();
      const head = /^<<(-?)[ \t]*(?:'([^']*)'|"([^"]*)"|\\?([^\s;&|<>()]+))/.exec(command.slice(i));
      if (!head) return null;
      const delim = head[2] ?? head[3] ?? head[4]!;
      heredocs.push({ delim, quoted: head[4] === undefined || head[0].includes('\\'), dash: head[1] === '-' });
      i += head[0].length - 1;
    } else if (ch === '\n' && heredocs.length) {
      endCommand();
      // Bodies start on the next line, one after another, each ended by a line that is its delimiter.
      for (const h of heredocs.splice(0)) {
        let body = '';
        while (i + 1 < command.length) {
          const end = command.indexOf('\n', i + 1);
          const line = command.slice(i + 1, end < 0 ? command.length : end);
          i = end < 0 ? command.length : end;
          if ((h.dash ? line.replace(/^\t+/, '') : line) === h.delim) break;
          body += line + '\n';
        }
        if (!h.quoted) {
          const subs = substitutions(body);
          if (!subs) return null;
          for (const sub of subs) {
            const inner = simpleCommands(sub);
            if (!inner) return null;
            fromHeredocs.push(...inner);
          }
        }
      }
    } else if (SEPARATORS.has(ch) || (ch === '$' && command[i + 1] === '(')) {
      endCommand();
    } else if (/\s/.test(ch)) {
      endWord();
    } else cur += ch;
  }
  if (quote) return null;
  endCommand();
  return [...out.flatMap(expand), ...fromHeredocs];
}

// The $( ) and backtick substitutions in text the shell expands (an unquoted heredoc body). Null when one is
// not closed.
function substitutions(text: string): string[] | null {
  const subs: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end < 0) return null;
      subs.push(text.slice(i + 1, end));
      i = end;
    } else if (text[i] === '$' && text[i + 1] === '(') {
      let depth = 0;
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === '(') depth++;
        else if (text[j] === ')' && --depth === 0) break;
      }
      if (j >= text.length) return null;
      subs.push(text.slice(i + 2, j));
      i = j;
    }
  }
  return subs;
}

// Drops redirections, leading assignments and wrappers like sudo or env, and unpacks `bash -c "..."` and eval.
function expand(words: string[]): string[][] {
  const argv: string[] = [];
  for (let j = 0; j < words.length; j++) {
    const w = words[j]!;
    if (/^\d*(<|>>?|&>>?|>&)$/.test(w)) j++; // operator alone: its target is the next word
    else if (!/^\d*(<|>>?|&>>?|>&)/.test(w)) argv.push(w);
  }
  let i = 0;
  while (i < argv.length) {
    const w = argv[i]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || KEYWORDS.has(w)) i++;
    else if (WRAPPERS.has(w)) {
      const wrapper = WRAPPERS.get(w)!;
      i++;
      while (i < argv.length && argv[i]!.startsWith('-')) {
        if (argv[i] === '--') {
          i++;
          break;
        }
        // env -S splits its value into a command line of its own.
        const split = /^(-S|--split-string)(=.*)?$/.exec(argv[i]!);
        if (w === 'env' && split) {
          const line = split[2] ? split[2].slice(1) : argv[i + 1];
          if (line !== undefined) return simpleCommands([line, ...argv.slice(i + (split[2] ? 1 : 2))].join(' ')) ?? [argv.slice(i)];
        }
        i += wrapper.value?.includes(argv[i]!) ? 2 : 1;
      }
      i += wrapper.positional ?? 0;
    } else break;
  }
  const rest = argv.slice(i);
  const [cmd, ...args] = rest;
  if (!cmd) return [];
  if (/^(ba|z|da|k)?sh$/.test(cmd)) {
    // -c may share a word with other flags (`bash -lc`, `sh -ec`); the command is the next operand.
    const c = args.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    const line = c < 0 ? undefined : args.slice(c + 1).find((a) => !/^[-+]/.test(a));
    if (line !== undefined) return simpleCommands(line) ?? [rest];
  }
  // find runs each -exec, -execdir, -ok and -okdir body as a command of its own, up to `;` or `+`.
  if (cmd === 'find') {
    const bodies: string[][] = [];
    for (let k = 0; k < args.length; k++) {
      if (!/^-(exec|execdir|ok|okdir)$/.test(args[k]!)) continue;
      const end = args.findIndex((a, n) => n > k && (a === ';' || a === '+'));
      bodies.push(args.slice(k + 1, end < 0 ? args.length : end));
      k = end < 0 ? args.length : end;
    }
    return [rest, ...bodies.flatMap((b) => expand(b))];
  }
  if (cmd === 'eval') return simpleCommands(args.join(' ')) ?? [rest];
  // PowerShell and cmd run a command line of their own: read it like one. Interpreters run code, so
  // besides the call itself, string literals handed to execution sinks are read as commands too
  // (`python3 -c "os.system('rm -rf /')"` shows an rm). `-EncodedCommand` is unreadable and stays as is.
  if (/^(powershell|pwsh)$/.test(cmd)) {
    const c = args.findIndex((a) => /^(-c|-Command)$/.test(a));
    const line = c < 0 ? undefined : args.slice(c + 1).find((a) => !/^-/.test(a));
    const inner = [...(line !== undefined ? (simpleCommands(line) ?? []) : []), ...sinkLiterals(args.join(' '))];
    if (inner.length) return [rest, ...inner];
  }
  if (cmd === 'cmd') {
    const c = args.findIndex((a) => /^\/(c|C)$/.test(a));
    if (c >= 0) {
      const inner = simpleCommands(args.slice(c + 1).join(' ')) ?? [];
      if (inner.length) return [rest, ...inner];
    }
  }
  if (/^(python3?|perl|ruby|node|php|deno)$/.test(cmd)) {
    const inner = sinkLiterals(args.join(' '));
    if (inner.length) return [rest, ...inner];
  }
  return [rest];
}

// String literals handed to execution sinks, read as commands: system("rm -rf /"), os.system('x').
const SINKS = /\b(?:os\.system|os\.popen|subprocess\.(?:call|run|Popen|check_output|check_call)|commands\.getoutput|system|popen|exec|eval|spawnl|spawnlp|spawnv|spawnvp|shell_exec)\s*\(\s*(['"])/g;
function sinkLiterals(text: string): string[][] {
  const out: string[][] = [];
  for (const m of text.matchAll(SINKS)) {
    const q = m[1]!;
    let s = '';
    let i = (m.index ?? 0) + m[0].length;
    let closed = false;
    for (; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\\' && i + 1 < text.length) {
        s += text[++i];
        continue;
      }
      if (ch === q) {
        closed = true;
        break;
      }
      s += ch;
    }
    if (closed && s) out.push(...(simpleCommands(s) ?? []));
  }
  return out;
}

// A command counts as read-only when every command in its pipeline, && chain or ; list is on this list (or is a
// `cd`) and nothing writes, substitutes or redirects. Read-only commands run in parallel and in read-only sessions;
// anything else is an `exec` call that the permission policy decides.

const READ_ONLY = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'find', 'pwd', 'echo', 'sort', 'uniq', 'cut', 'tr',
  'file', 'stat', 'du', 'which', 'date', 'uname', 'basename', 'dirname', 'realpath', 'tree', 'diff', 'sed', 'awk', 'jq', 'git', 'true',
  'nl', 'od',
]);
const GIT_READ = new Set(['status', 'log', 'diff', 'show', 'branch', 'rev-parse', 'ls-files', 'blame', 'remote', 'describe', 'shortlog', 'grep']);
// Flags that write a file or run another program (a preprocessor, a pager, a compressor, a diff driver).
const FORBIDDEN_FLAGS: Record<string, RegExp> = {
  find: /^-(exec|execdir|delete|ok|okdir|fprint|fprint0|fprintf|fls)$/,
  // Short flags may come bundled (`-ni`), so a letter anywhere in the bundle counts.
  sed: /^(-[A-Za-z]*[if]|--in-place|--file)/,
  awk: /^(-i|-f|-E|-l|--include|--file|--exec|--load)/,
  sort: /^(-[A-Za-z]*o|--output|--compress-program)/,
  rg: /^--pre(=|$)/,
  date: /^(-s|--set)/,
  tree: /^-[A-Za-z]*[oR]/,
  file: /^(-[A-Za-z]*C|--compile)/,
  git: /^(-c|--exec-path|--output|-O|--open-files-in-pager|--ext-diff|--textconv)/,
};

export type Verdict = { ok: true } | { ok: false; reason: string };

export function splitWords(segment: string): string[] | null {
  const words: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (quote) {
      // In double quotes a backslash escapes only $ ` " \ and a newline; elsewhere bash keeps it.
      if (ch === '\\' && quote === '"' && i + 1 < segment.length) cur += unescape(segment[++i]!, true);
      else if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '\\' && i + 1 < segment.length) {
      // Outside quotes it takes away the next character's meaning: `\-i` is -i, `\'` a plain quote.
      cur += unescape(segment[++i]!, false);
      has = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) words.push(cur);
      cur = '';
      has = false;
    } else cur += ch;
  }
  if (quote) return null;
  if (cur || has) words.push(cur);
  return words;
}

// Strips quoted text, escaped characters (an escaped quote opens no string) and the two harmless redirections
// (2>&1, 2>/dev/null), leaving the operators bash acts on. An unclosed quote is left as written.
function unquoted(command: string): string {
  let out = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (ch === '\\') {
      out += '_';
      i++;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== ch) j += ch === '"' && command[j] === '\\' ? 2 : 1;
      if (j >= command.length) return out + command.slice(i);
      out += '""';
      i = j;
    } else out += ch;
  }
  return out;
}
const bareOf = (command: string) =>
  unquoted(command)
    .replace(/(^|\s)\d?>&\d(?=[\s;|&]|$)/g, ' ')
    .replace(/(^|\s)2>\s*\/dev\/null(?=[\s;|&]|$)/g, ' ');

// True when the command writes a file through `>`, `>>` or `&>`, which the split argv no longer shows.
export const redirectsOutput = (command: string): boolean => />/.test(bareOf(command));

// The words of each command the read-only check judges, split as it splits them (test/shell-agree.test.ts holds
// it to simpleCommands on plain commands). Null when the quotes do not close.
export function readOnlyCommands(command: string): string[][] | null {
  const segments = splitTopLevel(command);
  if (!segments) return null;
  const out: string[][] = [];
  for (const seg of segments) {
    const words = splitWords(seg.trim());
    if (!words) return null;
    if (words.length) out.push(words);
  }
  return out;
}

export function checkReadOnly(command: string): Verdict {
  if (/`|\$\(|<\(|>\(/.test(command)) return { ok: false, reason: 'command substitution is not allowed' };
  // Look for operators outside quotes, so `grep "a>b"` is fine.
  const bare = bareOf(command);
  if (/[<>]/.test(bare) || bare.replace(/&&/g, '').includes('&')) return { ok: false, reason: 'redirection and background jobs are not allowed' };
  const original = splitTopLevel(command);
  if (!original) return { ok: false, reason: 'unbalanced quotes' };
  for (const seg of original) {
    const words = splitWords(seg.trim());
    if (!words?.length) return { ok: false, reason: 'empty command' };
    const [cmd, ...args] = words;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd!)) return { ok: false, reason: 'environment assignments are not allowed' };
    // `cd <dir> && cat x` only reads: models lead most commands with a cd to the working directory. The policy reads
    // the paths after it from the directory it names, so only a plain directory is taken.
    if (cmd === 'cd') {
      if (args.length > 1 || args.some((a) => a.startsWith('-') || a.includes('$'))) return { ok: false, reason: 'cd takes one plain directory here' };
      continue;
    }
    if (!READ_ONLY.has(cmd!)) return { ok: false, reason: `"${cmd}" is not on the read-only list` };
    const bad = FORBIDDEN_FLAGS[cmd!];
    if (bad && args.some((a) => bad.test(a))) return { ok: false, reason: `"${cmd}" with that flag can write` };
    if (cmd === 'git') {
      // `git -C <dir> status`: the word after -C is a directory, not the subcommand.
      let i = 0;
      while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' ? 2 : 1;
      const sub = args[i];
      if (!sub || !GIT_READ.has(sub)) return { ok: false, reason: `git ${sub ?? ''} is not read-only` };
      if (sub === 'branch' && args.some((a) => /^-(d|D|m|M|c|C|f)$|^--(delete|move|copy|force|set-upstream)/.test(a))) return { ok: false, reason: 'git branch with that flag writes' };
      if (sub === 'remote' && args.some((a) => /^(add|remove|rm|rename|set-url|prune|update)$/.test(a))) return { ok: false, reason: 'git remote with that subcommand writes' };
    }
    // Any pipe but `||` runs a command, whatever names it (`print | cmd`), and any `>` after a print may redirect it.
    if (cmd === 'awk' && args.some((a) => /system\s*\(|\bprintf?\b[^;{}]*>|(^|[^|])\|(?!\|)/.test(a))) return { ok: false, reason: 'awk program can write or run commands' };
    // uniq writes its output to a second file name.
    if (cmd === 'uniq' && args.filter((a) => !a.startsWith('-')).length > 1) return { ok: false, reason: 'uniq with an output file writes' };
    if (cmd === 'sed' && args.some((a) => /(^|;)\s*[0-9,$]*\s*[wWe]\b|\/[wW]\s/.test(a) || sedSubstituteRuns(a))) return { ok: false, reason: 'sed script can write or run commands' };
  }
  return { ok: true };
}

// An `s` command with the e flag runs its result as a command, and with w writes a file, whatever the delimiter
// (`s|a|b|gw out`).
const sedSubstituteRuns = (script: string) =>
  [...script.matchAll(/s([^\s\w\\])(?:\\.|(?!\1).)*\1(?:\\.|(?!\1).)*\1([A-Za-z0-9]*)/g)].some((m) => /[ewW]/.test(m[2]!));

// Splits on |, ||, &&, ; and newlines outside quotes. A ; or newline that ends the command, or follows another,
// leaves no empty command behind.
function splitTopLevel(command: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let soft = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote) {
      if (ch === '\\' && quote === '"') {
        cur += ch + (command[++i] ?? '');
        continue;
      }
      if (ch === quote) quote = null;
      cur += ch;
    } else if (ch === '\\') {
      cur += ch + (command[++i] ?? '');
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
    } else if ((ch === '|' || ch === '&') && (command[i + 1] === ch || ch === '|')) {
      out.push(cur);
      cur = '';
      soft = false;
      if (command[i + 1] === ch) i++;
    } else if (ch === ';' || ch === '\n') {
      if (cur.trim() || !soft) out.push(cur);
      cur = '';
      soft = true;
    } else {
      cur += ch;
      if (ch.trim()) soft = false;
    }
  }
  if (quote) return null;
  if (cur.trim() || !soft) out.push(cur);
  return out;
}
