import { join } from 'node:path';
import { cediaHome, loadMaxEffort, loadPlanOverlap, loadPlanWhen, loadQuotaWait, loadRoles, MEDIA_MODEL, readSettings, writeSettings, type Settings } from './config.ts';
import { FALLBACKS, resolveModel } from './providers/catalog.ts';
import type { Effort } from './types.ts';

// `cedia settings get|set|unset`: the model settings a client's settings page edits (roles, fallback, media,
// efforts, quota and planning), so cedia stays the only writer of the keys it reads, as `cedia mcp` is for
// mcpServers. Each value is checked by the same code a run uses to read it before the file is written. Only these
// keys: the rest of the file (permissions, hooks, MCP servers) is not editable through this command.

export const EDITABLE_ROLES = ['code', 'plan', 'review', 'triage', 'advisor', 'classifier', 'swarm', 'workers', 'complete'] as const;
export type EditableRole = (typeof EDITABLE_ROLES)[number];

// The editable keys as the file holds them, and what each takes while it is unset.
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
  defaults: {
    code: string;
    swarm: string;
    media: string;
    // The built-in fallbacks, by the model's full ref.
    fallback: Record<string, string>;
    planWhen: 'auto';
    planOverlap: 'on';
    onQuota: 'fallback';
  };
};

const TOP_KEYS = ['media', 'maxEffort', 'subthreadEffort', 'onQuota', 'planWhen', 'planOverlap'] as const;
type TopKey = (typeof TOP_KEYS)[number];

const path = () => join(cediaHome(), 'settings.json');

export function getEditable(): EditableSettings {
  const s = readSettings(path());
  const roles = Object.fromEntries(EDITABLE_ROLES.flatMap((r) => (typeof s.roles?.[r] === 'string' ? [[r, s.roles[r]]] : []))) as EditableSettings['roles'];
  const fallback = Object.fromEntries(Object.entries(s.fallback ?? {}).filter(([, v]) => typeof v === 'string'));
  const top = Object.fromEntries(TOP_KEYS.flatMap((k) => (typeof s[k] === 'string' ? [[k, s[k]]] : [])));
  return {
    roles,
    fallback,
    ...top,
    defaults: { code: resolveModel('haiku').ref, swarm: resolveModel('beam').ref, media: MEDIA_MODEL, fallback: { ...FALLBACKS }, planWhen: 'auto', planOverlap: 'on', onQuota: 'fallback' },
  };
}

// A key the command edits: roles.<role>, fallback.<model>, or one of TOP_KEYS.
type Key = { kind: 'role'; role: EditableRole } | { kind: 'fallback'; model: string } | { kind: 'top'; key: TopKey };
function parseKey(key: string): Key {
  const [head, ...rest] = key.split('.');
  const tail = rest.join('.');
  if (head === 'roles' && (EDITABLE_ROLES as readonly string[]).includes(tail)) return { kind: 'role', role: tail as EditableRole };
  if (head === 'fallback' && tail) return { kind: 'fallback', model: tail };
  if (!rest.length && (TOP_KEYS as readonly string[]).includes(key)) return { kind: 'top', key: key as TopKey };
  throw new Error(`"${key}" is not a setting this command edits (use roles.<${EDITABLE_ROLES.join('|')}>, fallback.<model>, ${TOP_KEYS.join(', ')})`);
}

// Throws why a run would refuse `value` for `key`.
function check(key: Key, value: string): void {
  if (key.kind === 'role') {
    // The other roles at values that are always valid, so only this one is judged, and the file's own roles
    // (which a run would read under unset flags) are never consulted.
    const flags = { code: 'haiku', plan: 'none', review: 'none', advisor: 'none', classifier: 'none', workers: 'none', swarm: 'beam', triage: 'haiku' };
    if (key.role === 'complete') {
      if (/^claude-code\b/.test(value)) throw new Error('tab completion runs in cedia; claude-code is for plan or review');
      resolveModel(value);
      return;
    }
    if (key.role === 'triage' || key.role === 'swarm' || key.role === 'code') {
      if (value === 'none') throw new Error(`roles.${key.role} cannot be none; unset it for the default`);
    }
    loadRoles({ ...flags, [key.role]: value }, {});
    return;
  }
  if (key.kind === 'fallback') {
    resolveModel(key.model);
    if (value !== 'none') resolveModel(value);
    return;
  }
  switch (key.key) {
    case 'media':
      if (value !== 'none' && !resolveModel(value).caps.input.includes('image')) throw new Error(`media: ${resolveModel(value).ref} reads text only`);
      return;
    case 'maxEffort':
    case 'subthreadEffort':
      loadMaxEffort({ CEDIA_MAX_EFFORT: value });
      return;
    case 'onQuota':
      loadQuotaWait(value);
      return;
    case 'planWhen':
      loadPlanWhen(value);
      return;
    case 'planOverlap':
      loadPlanOverlap(value);
      return;
  }
}

// Sets `key` to `value`, or removes it when `value` is undefined, and returns the editable settings after. The
// file's other keys and their order stay as they were; an object left empty is removed.
export function setEditable(keyName: string, value: string | undefined): EditableSettings {
  const key = parseKey(keyName);
  if (value !== undefined) {
    if (!value.trim()) throw new Error(`${keyName}: empty value (unset it instead)`);
    try {
      check(key, value);
    } catch (e) {
      throw new Error(`${keyName}: ${(e as Error).message}`);
    }
  }
  const s = { ...readSettings(path()) } as Record<string, unknown>;
  const inner = (name: 'roles' | 'fallback', field: string) => {
    const obj = { ...((s[name] ?? {}) as Record<string, unknown>) };
    if (value === undefined) delete obj[field];
    else obj[field] = value;
    if (Object.keys(obj).length) s[name] = obj;
    else delete s[name];
  };
  if (key.kind === 'role') inner('roles', key.role);
  else if (key.kind === 'fallback') inner('fallback', key.model);
  else if (value === undefined) delete s[key.key];
  else s[key.key] = value;
  writeSettings(s as Settings, path());
  return getEditable();
}
