import { checkSandboxMode, loadHandoff, loadMaxEffort, loadPlanOverlap, loadPlanWhen, loadQuotaWait, loadRoles, loadSpawn, MEDIA_MODEL, parseHandoffAt, settingsPath, userSettings, writeSettings, type Settings } from './config.ts';
import { loadOutputStyles } from './output-styles/styles.ts';
import { FALLBACKS, resolveModel } from './providers/catalog.ts';
import { GUARDS, type Guard } from './safety/policy.ts';
import { DEFAULT_DOMAINS, type SandboxSetting } from './safety/sandbox.ts';
import type { Effort, PrivacyLevel } from './types.ts';

// `cedia settings get|set|unset`: the settings a client's settings page edits, so cedia stays the only writer of
// the keys it reads, as `cedia mcp` is for mcpServers. Each value is checked by the same code a run uses to read it
// before the file is written. Keys a page cannot sensibly edit as one value (hooks, profiles, localModels, a custom
// lsp object, mcpServers) are not editable through this command.

export const EDITABLE_ROLES = ['code', 'plan', 'review', 'triage', 'advisor', 'classifier', 'swarm', 'workers', 'complete'] as const;
export type EditableRole = (typeof EDITABLE_ROLES)[number];
type OnOff = 'on' | 'off';

// The editable keys as the file holds them (a switch as on/off, a list as its entries), and what each takes
// while it is unset.
export type EditableSettings = {
  roles: { [K in EditableRole]?: string };
  // Model ref (or alias, as written) -> the model a session continues on when its quota runs out, or "none".
  fallback: Record<string, string>;
  media?: string;
  maxEffort?: Effort;
  subthreadEffort?: Effort;
  onQuota?: string;
  planWhen?: string;
  planOverlap?: string;
  privacy?: PrivacyLevel;
  // The user's standing context, its lines joined.
  context?: string;
  spawn?: 'on' | 'off' | 'worktree';
  // A token count, or "off".
  handoffAt?: string;
  handoff?: 'note' | 'compact';
  // "custom" when the file names its own servers, which this command leaves alone.
  lsp?: 'on' | 'off' | 'custom';
  jobs?: OnOff;
  promptSuggestions?: OnOff;
  outputStyle?: string;
  sandbox: { mode?: SandboxSetting; allowedDomains: string[] };
  permissions: { allow: string[]; deny: string[]; unlock: Guard[] };
  // What a picker may offer.
  choices: { outputStyles: string[]; guards: Guard[] };
  defaults: {
    code: string;
    swarm: string;
    media: string;
    // The built-in fallbacks, by the model's full ref.
    fallback: Record<string, string>;
    planWhen: 'auto';
    planOverlap: 'on';
    onQuota: 'fallback';
    privacy: 'no-training';
    spawn: 'on';
    handoff: 'compact';
    lsp: 'on';
    outputStyle: 'default';
    sandboxMode: 'auto';
    // Always allowed, besides allowedDomains.
    sandboxDomains: string[];
  };
};

// One editable key: where it lives in the file, how a page's text becomes the stored value, and the check a run
// would make. `check` throws why a run would refuse the value.
type Field = { path: [string] | [string, string]; store: (v: string) => unknown; check: (v: string) => void };

const onOff = (name: string) => (v: string) => {
  if (v !== 'on' && v !== 'off') throw new Error(`${name} must be on or off, not ${v}`);
};
const lines = (v: string) => v.split('\n').map((l) => l.trim()).filter(Boolean);
const RULE = /^([\w-]+)(?:\((.*)\))?$/;
const HOST = /^(\*\.)?[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;
const each = (what: string, ok: (l: string) => boolean, hint: string) => (v: string) => {
  const bad = lines(v).find((l) => !ok(l));
  if (bad !== undefined) throw new Error(`"${bad}" is not ${what} (${hint})`);
};
const plain = (key: string, check: (v: string) => void): Field => ({ path: [key], store: (v) => v, check });

const FIELDS: Record<string, Field> = {
  media: plain('media', (v) => {
    if (v !== 'none' && !resolveModel(v).caps.input.includes('image')) throw new Error(`${resolveModel(v).ref} reads text only`);
  }),
  maxEffort: plain('maxEffort', (v) => void loadMaxEffort({ CEDIA_MAX_EFFORT: v })),
  subthreadEffort: plain('subthreadEffort', (v) => void loadMaxEffort({ CEDIA_MAX_EFFORT: v })),
  onQuota: plain('onQuota', (v) => void loadQuotaWait(v)),
  planWhen: plain('planWhen', (v) => void loadPlanWhen(v)),
  planOverlap: plain('planOverlap', (v) => void loadPlanOverlap(v)),
  privacy: plain('privacy', (v) => {
    if (v !== 'no-training' && v !== 'zdr') throw new Error(`privacy must be no-training or zdr, not ${v}`);
  }),
  context: { path: ['context'], store: (v) => v, check: () => {} },
  spawn: { path: ['spawn'], store: (v) => (v === 'worktree' ? 'worktree' : v === 'on'), check: (v) => void loadSpawn(v) },
  handoffAt: {
    path: ['handoffAt'],
    store: (v) => (v === 'off' ? 'off' : Number(v)),
    check: (v) => {
      parseHandoffAt(v, 'handoffAt');
    },
  },
  handoff: plain('handoff', (v) => void loadHandoff(v)),
  lsp: {
    path: ['lsp'],
    store: (v) => v === 'on',
    check: (v) => {
      onOff('lsp')(v);
      if (lspCustom()) throw new Error('lsp names its own servers in settings.json; edit it there');
    },
  },
  jobs: { path: ['jobs'], store: (v) => v === 'on', check: onOff('jobs') },
  promptSuggestions: { path: ['promptSuggestions'], store: (v) => v === 'on', check: onOff('promptSuggestions') },
  outputStyle: plain('outputStyle', (v) => {
    const names = loadOutputStyles().map((s) => s.name);
    if (!names.includes(v)) throw new Error(`no output style ${v} (have ${names.join(', ')})`);
  }),
  'sandbox.mode': { path: ['sandbox', 'mode'], store: (v) => v, check: (v) => checkSandboxMode(v) },
  'sandbox.allowedDomains': { path: ['sandbox', 'allowedDomains'], store: lines, check: each('a host', (l) => HOST.test(l), 'one per line, like api.example.com or *.example.com') },
  'permissions.allow': { path: ['permissions', 'allow'], store: lines, check: each('a rule', (l) => RULE.test(l), 'one per line, like bash(git status*) or edit') },
  'permissions.deny': { path: ['permissions', 'deny'], store: lines, check: each('a rule', (l) => RULE.test(l), 'one per line, like bash(rm *) or web_fetch') },
  'permissions.unlock': { path: ['permissions', 'unlock'], store: lines, check: each('a guard', (l) => (GUARDS as string[]).includes(l), `one of ${GUARDS.join(', ')}`) },
};

const path = () => settingsPath();
const lspCustom = () => {
  const l = userSettings().lsp;
  return typeof l === 'object' && l !== null;
};
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const sw = (v: unknown): OnOff | undefined => (typeof v === 'boolean' ? (v ? 'on' : 'off') : undefined);
const drop = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export function getEditable(): EditableSettings {
  const s = userSettings();
  const roles = Object.fromEntries(EDITABLE_ROLES.flatMap((r) => (typeof s.roles?.[r] === 'string' ? [[r, s.roles[r]]] : []))) as EditableSettings['roles'];
  const fallback = Object.fromEntries(Object.entries(s.fallback ?? {}).filter(([, v]) => typeof v === 'string'));
  const context = Array.isArray(s.context) ? s.context.join('\n') : str(s.context);
  return {
    roles,
    fallback,
    ...drop({
      media: str(s.media),
      maxEffort: str(s.maxEffort) as Effort | undefined,
      subthreadEffort: str(s.subthreadEffort) as Effort | undefined,
      onQuota: str(s.onQuota),
      planWhen: str(s.planWhen),
      planOverlap: str(s.planOverlap),
      privacy: str(s.privacy) as PrivacyLevel | undefined,
      context,
      spawn: s.spawn === 'worktree' ? ('worktree' as const) : sw(s.spawn),
      handoffAt: s.handoffAt === undefined ? undefined : String(s.handoffAt),
      handoff: str(s.handoff) as 'note' | 'compact' | undefined,
      lsp: typeof s.lsp === 'object' && s.lsp !== null ? ('custom' as const) : sw(s.lsp),
      jobs: sw(s.jobs),
      promptSuggestions: sw(s.promptSuggestions),
      outputStyle: str(s.outputStyle),
    }),
    sandbox: drop({ mode: s.sandbox?.mode, allowedDomains: strs(s.sandbox?.allowedDomains) }),
    permissions: { allow: strs(s.permissions?.allow), deny: strs(s.permissions?.deny), unlock: strs(s.permissions?.unlock) as Guard[] },
    choices: { outputStyles: loadOutputStyles().map((st) => st.name), guards: [...GUARDS] },
    defaults: {
      code: resolveModel('haiku').ref,
      swarm: resolveModel('beam').ref,
      media: MEDIA_MODEL,
      fallback: { ...FALLBACKS },
      planWhen: 'auto',
      planOverlap: 'on',
      onQuota: 'fallback',
      privacy: 'no-training',
      spawn: 'on',
      handoff: 'compact',
      lsp: 'on',
      outputStyle: 'default',
      sandboxMode: 'auto',
      sandboxDomains: [...DEFAULT_DOMAINS],
    },
  };
}

// A key the command edits: roles.<role>, fallback.<model>, or one of FIELDS.
type Key = { kind: 'role'; role: EditableRole } | { kind: 'fallback'; model: string } | { kind: 'field'; field: Field };
function parseKey(key: string): Key {
  const [head, ...rest] = key.split('.');
  const tail = rest.join('.');
  if (head === 'roles' && (EDITABLE_ROLES as readonly string[]).includes(tail)) return { kind: 'role', role: tail as EditableRole };
  if (head === 'fallback' && tail) return { kind: 'fallback', model: tail };
  const field = Object.hasOwn(FIELDS, key) ? FIELDS[key] : undefined;
  if (field) return { kind: 'field', field };
  throw new Error(`"${key}" is not a setting this command edits (use roles.<${EDITABLE_ROLES.join('|')}>, fallback.<model>, ${Object.keys(FIELDS).join(', ')})`);
}

function checkRole(role: EditableRole, value: string): void {
  if (role === 'complete') {
    if (/^claude-code\b/.test(value)) throw new Error('tab completion runs in cedia; claude-code is for plan or review');
    resolveModel(value);
    return;
  }
  if ((role === 'triage' || role === 'swarm' || role === 'code') && value === 'none') throw new Error(`roles.${role} cannot be none; unset it for the default`);
  // The other roles at values that are always valid, so only this one is judged, and the file's own roles (which
  // a run would read under unset flags) are never consulted.
  const flags = { code: 'haiku', plan: 'none', review: 'none', advisor: 'none', classifier: 'none', workers: 'none', swarm: 'beam', triage: 'haiku' };
  loadRoles({ ...flags, [role]: value }, {});
}

// Sets `key` to `value`, or removes it when `value` is undefined, and returns the editable settings after. The
// file's other keys and their order stay as they were; an object left empty is removed. A list key takes one entry
// per line; a list left empty is removed.
export function setEditable(keyName: string, value: string | undefined): EditableSettings {
  const key = parseKey(keyName);
  if (value !== undefined) {
    const blank = key.kind === 'field' && key.field.store === lines ? !lines(value).length : !value.trim();
    if (blank) value = undefined;
  }
  if (value !== undefined) {
    try {
      if (key.kind === 'role') checkRole(key.role, value);
      else if (key.kind === 'fallback') {
        resolveModel(key.model);
        if (value !== 'none') resolveModel(value);
      } else key.field.check(value);
    } catch (e) {
      throw new Error(`${keyName}: ${(e as Error).message}`);
    }
  }
  const [top, inner, stored] =
    key.kind === 'role' ? ['roles', key.role, value] : key.kind === 'fallback' ? ['fallback', key.model, value] : [key.field.path[0], key.field.path[1], value === undefined ? undefined : key.field.store(value)];
  const s = userSettings() as Record<string, unknown>;
  if (inner === undefined) {
    if (stored === undefined) delete s[top];
    else s[top] = stored;
  } else {
    const obj = { ...((s[top] ?? {}) as Record<string, unknown>) };
    if (stored === undefined) delete obj[inner];
    else obj[inner] = stored;
    if (Object.keys(obj).length) s[top] = obj;
    else delete s[top];
  }
  writeSettings(s as Settings, path());
  return getEditable();
}
