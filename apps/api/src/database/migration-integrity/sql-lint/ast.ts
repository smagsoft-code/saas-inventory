import type { AstObject } from './sql-parser';

/** Small, typed readers over the parser's untyped JSON tree. Nothing here interprets SQL text. */

export const isObj = (value: unknown): value is AstObject => typeof value === 'object' && value !== null && !Array.isArray(value);
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** `{ Kind: { …fields } }` → `{ kind, body }`. */
export function node(value: unknown): { kind: string; body: AstObject } | undefined {
  if (!isObj(value)) return undefined;
  const kind = Object.keys(value)[0];
  if (kind === undefined) return undefined;
  const body = value[kind];
  return isObj(body) ? { kind, body } : undefined;
}

/** The string held by `{String:{sval}}`, `{A_Const:{sval:{sval}}}` or a bare string. */
export function stringOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  const n = node(value);
  if (n === undefined) return undefined;
  if (n.kind === 'String') return text(n.body['sval']);
  if (n.kind === 'A_Const') {
    const inner = n.body['sval'];
    return isObj(inner) ? text(inner['sval']) : undefined;
  }
  return undefined;
}

/** `{Boolean:{boolval:true}}` → true; false is serialised as an empty object. */
export function boolOf(value: unknown): boolean | undefined {
  const n = node(value);
  if (n?.kind === 'Boolean') return n.body['boolval'] === true;
  return undefined;
}

/** A list of `DefElem` nodes as `name → argument`. */
export function defElems(items: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const item of list(items)) {
    const n = node(item);
    if (n?.kind === 'DefElem') {
      const name = text(n.body['defname']);
      if (name !== undefined) out.set(name, n.body['arg']);
    }
  }
  return out;
}

export type RoleRef = { readonly kind: 'named'; readonly name: string } | { readonly kind: 'public' } | { readonly kind: 'special'; readonly which: string };

export function roleOf(value: unknown): RoleRef | undefined {
  const n = node(value);
  if (n?.kind !== 'RoleSpec') return undefined;
  const type = text(n.body['roletype']);
  if (type === 'ROLESPEC_CSTRING') {
    const name = text(n.body['rolename']);
    return name === undefined ? undefined : { kind: 'named', name };
  }
  if (type === 'ROLESPEC_PUBLIC') return { kind: 'public' };
  return { kind: 'special', which: type ?? 'unknown' };
}

export function describeRole(role: RoleRef): string {
  return role.kind === 'named' ? role.name : role.kind === 'public' ? 'PUBLIC' : role.which.replace('ROLESPEC_', '').toLowerCase();
}

/** `schema.relation` of a RangeVar body. */
export function relationName(value: unknown): string | undefined {
  if (!isObj(value)) return undefined;
  const rel = text(value['relname']);
  if (rel === undefined) return undefined;
  const schema = text(value['schemaname']);
  return schema === undefined ? rel : `${schema}.${rel}`;
}

/** Last name of a qualified name given as a list of String nodes. */
export function lastName(items: unknown): string | undefined {
  const names = list(items).map(stringOf).filter((s): s is string => s !== undefined);
  return names[names.length - 1];
}

/** Visits every `{ Kind: body }` node below `root`, depth first. */
export function walk(root: unknown, visit: (kind: string, body: AstObject) => void): void {
  if (Array.isArray(root)) {
    for (const item of root) walk(item, visit);
    return;
  }
  if (!isObj(root)) return;
  const keys = Object.keys(root);
  const first = keys[0];
  if (keys.length === 1 && first !== undefined && /^[A-Z]/.test(first) && isObj(root[first])) {
    visit(first, root[first] as AstObject);
    walk(root[first], visit);
    return;
  }
  for (const key of keys) walk(root[key], visit);
}
