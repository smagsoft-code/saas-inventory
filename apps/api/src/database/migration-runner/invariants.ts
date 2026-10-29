import type { Sql } from 'postgres';
import {
  INVARIANT_EXPECTED_OWNER,
  type InvariantSnapshot,
  type ObjectKind,
  type OwnedObject,
  type RlsTable,
} from '../migration-integrity/invariants';
import { diagnostic, type Diagnostic } from '../migration-integrity/types';
import type { Queryable } from './rls-window';

/**
 * Catalogue reads for the owner / RLS invariants (ADR-0041, D-8B), and the hook that runs them INSIDE the
 * transaction in which Drizzle applies the batch, right before it commits.
 *
 * Read-only: every query is a SELECT on the system catalogues, which any role can read. The same queries serve
 * the snapshot taken before the batch, the one taken inside the transaction, and the one taken after the commit.
 */

const RELATIONS = `
  SELECT CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table' WHEN 'S' THEN 'sequence'
                        WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table' END AS kind,
         c.oid::text AS id, c.relname::text AS name, pg_get_userbyid(c.relowner)::text AS owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')`;

const FUNCTIONS = `
  SELECT 'function' AS kind, p.oid::text AS id, p.proname::text AS name, pg_get_userbyid(p.proowner)::text AS owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = $1
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`;

// enum and domain types, and standalone composite types (not the row type of a table, not array types)
const TYPES = `
  SELECT 'type' AS kind, t.oid::text AS id, t.typname::text AS name, pg_get_userbyid(t.typowner)::text AS owner
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname = $1
     AND (t.typtype IN ('e', 'd') OR (t.typtype = 'c' AND EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c')))
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')`;

const SCHEMA = `
  SELECT 'schema' AS kind, n.oid::text AS id, n.nspname::text AS name, pg_get_userbyid(n.nspowner)::text AS owner
    FROM pg_namespace n WHERE n.nspname = $1`;

const RLS_TABLES = `
  SELECT c.oid::text AS id, c.relname::text AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`;

async function ownedObjects(sql: Queryable, schema: string): Promise<OwnedObject[]> {
  const rows = await sql.unsafe<{ kind: ObjectKind; id: string; name: string; owner: string }[]>(
    `${RELATIONS} UNION ALL ${FUNCTIONS} UNION ALL ${TYPES} UNION ALL ${SCHEMA}`,
    [schema],
  );
  return rows.map((r) => ({ kind: r.kind, id: r.id, name: r.name, owner: r.owner }));
}

/** Everything the invariants look at, as of the transaction snapshot of `sql` (committed state or, inside a transaction, its own writes). */
export async function snapshotInvariants(sql: Queryable): Promise<InvariantSnapshot> {
  const [publicObjects, drizzleObjects, tableRows] = [
    await ownedObjects(sql, 'public'),
    await ownedObjects(sql, 'drizzle'),
    await sql.unsafe<{ id: string; name: string; enabled: boolean; forced: boolean }[]>(RLS_TABLES),
  ];
  const tables: RlsTable[] = tableRows.map((t) => ({ id: t.id, name: t.name, enabled: t.enabled, forced: t.forced }));
  return { publicObjects, drizzleObjects, tables };
}

export { INVARIANT_EXPECTED_OWNER };

/** Thrown from inside the batch transaction: it makes PostgreSQL roll the whole batch back. */
export class PreCommitInvariantError extends Error {
  readonly diagnostics: readonly Diagnostic[];
  constructor(diagnostics: readonly Diagnostic[]) {
    super('The batch violated an invariant before commit; it was rolled back.');
    this.name = 'PreCommitInvariantError';
    this.diagnostics = diagnostics;
  }
}

export function isPreCommitInvariantError(error: unknown): error is PreCommitInvariantError {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'PreCommitInvariantError';
}

export interface PreCommitGuard {
  /** The client to hand to Drizzle: identical to `sql`, except that `begin` runs `check` before the transaction commits. */
  readonly client: Sql;
  /** How many times the hook ran. Zero after a batch that applied migrations means the guard was bypassed. */
  readonly invocations: () => number;
}

/**
 * Drizzle's `migrate()` commits its batch transaction itself (`PostgresJsSession.transaction` → `client.begin(cb)`), so
 * the wrapper cannot add a step between "last migration" and "commit" by calling it. This decorates the one method
 * Drizzle calls: after Drizzle's callback has applied every migration and recorded it, and still inside the same
 * transaction, `check` runs; if it throws, postgres.js rolls everything back and the error propagates out of `migrate()`.
 *
 * It depends on drizzle-orm@0.45.2 calling `client.begin` once for the batch (verified; `pg-core/dialect.js` +
 * `postgres-js/session.js`). If a Drizzle upgrade changes that, `invocations()` stays at 0 and the wrapper reports
 * `INVARIANT_GUARD_NOT_INVOKED` — after the fact, since the commit would already have happened — and the harness fails.
 */
export function withPreCommitGuard(sql: Sql, check: (tx: Queryable) => Promise<void>): PreCommitGuard {
  let invocations = 0;
  const client = new Proxy(sql, {
    get(target, property, receiver) {
      if (property === 'begin') {
        return (callback: (tx: never) => Promise<unknown>) =>
          target.begin(async (tx) => {
            const result = await callback(tx as never);
            invocations += 1;
            await check(tx);
            return result;
          });
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
  return { client, invocations: () => invocations };
}

export function invariantCheckFailed(error: unknown): Diagnostic {
  const code = typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'error';
  return diagnostic('INVARIANT_CHECK_FAILED', `The invariant check could not run (${code}); treated as a violation and rolled back.`);
}
