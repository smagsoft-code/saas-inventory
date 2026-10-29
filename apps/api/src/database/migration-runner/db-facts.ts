import type { Sql } from 'postgres';
import type { Queryable } from './rls-window';
import { APP_MIGRATOR_ROLE, type IdentityFacts } from '../migration-integrity/execution-guard';
import { parseCreatedAt } from '../migration-integrity/history-classifier';
import type { RegistryState } from '../migration-integrity/types';

/**
 * READ-ONLY facts the migration wrapper takes from PostgreSQL (ADR-0041). Every query here is a
 * `SELECT`; nothing writes, and nothing needs more than the privileges of the connecting login. The
 * decisions are made by the pure functions in `../migration-integrity/`; this module only gathers
 * what they need.
 *
 * Requires PostgreSQL 16+ (`pg_auth_members.set_option`). On an older server the identity query fails
 * and the wrapper refuses to run (`FACTS_UNAVAILABLE`).
 */

interface IdentityRow {
  database: string;
  session_user_name: string;
  current_user_name: string;
  session_is_superuser: boolean;
  session_bypass_rls: boolean;
  session_create_role: boolean;
  current_is_superuser: boolean;
  current_bypass_rls: boolean;
  migrator_exists: boolean;
  has_set: boolean;
  migrator_db_create: boolean;
}

export async function readIdentityFacts(sql: Queryable): Promise<IdentityFacts> {
  const rows = await sql.unsafe<IdentityRow[]>(
    `SELECT current_database()::text AS database,
            session_user::text AS session_user_name,
            current_user::text AS current_user_name,
            s.rolsuper AS session_is_superuser,
            s.rolbypassrls AS session_bypass_rls,
            s.rolcreaterole AS session_create_role,
            c.rolsuper AS current_is_superuser,
            c.rolbypassrls AS current_bypass_rls,
            EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_MIGRATOR_ROLE}') AS migrator_exists,
            EXISTS (SELECT 1 FROM pg_auth_members m
                      JOIN pg_roles r ON r.oid = m.roleid
                     WHERE r.rolname = '${APP_MIGRATOR_ROLE}' AND m.member = s.oid AND m.set_option) AS has_set,
            COALESCE((SELECT has_database_privilege('${APP_MIGRATOR_ROLE}', current_database(), 'CREATE')
                        FROM pg_roles WHERE rolname = '${APP_MIGRATOR_ROLE}'), false) AS migrator_db_create
       FROM pg_roles s, pg_roles c
      WHERE s.rolname = session_user AND c.rolname = current_user`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('The identity query returned no row.');
  return {
    database: row.database,
    sessionUser: row.session_user_name,
    currentUser: row.current_user_name,
    sessionIsSuperuser: row.session_is_superuser,
    sessionBypassRls: row.session_bypass_rls,
    sessionCreateRole: row.session_create_role,
    currentIsSuperuser: row.current_is_superuser,
    currentBypassRls: row.current_bypass_rls,
    appMigratorRoleExists: row.migrator_exists,
    sessionHasSetMembership: row.has_set,
    appMigratorHasDatabaseCreate: row.migrator_db_create,
  };
}

export interface DatabaseHistoryFacts {
  readonly registry: RegistryState;
  readonly publicTableCount: number;
}

/**
 * The Drizzle registry and the number of tables in `public`. The existence of the registry is read
 * from the catalogue (no privilege needed); its rows are read in insertion order (`id`). Throws if
 * the registry exists but cannot be read (for example, no SELECT on it): the caller turns that into
 * `REGISTRY_UNREADABLE` and does not guess.
 */
export async function readHistoryFacts(sql: Queryable): Promise<DatabaseHistoryFacts> {
  const tables = await sql.unsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
      WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p')`,
  );
  const publicTableCount = tables[0]?.n ?? 0;
  const exists = await sql.unsafe<{ present: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                     WHERE ns.nspname = 'drizzle' AND c.relname = '__drizzle_migrations' AND c.relkind = 'r') AS present`,
  );
  if (exists[0]?.present !== true) return { registry: { kind: 'absent' }, publicTableCount };
  const rows = await sql.unsafe<{ hash: string; created_at: string }[]>(
    'SELECT hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY id',
  );
  return {
    registry: {
      kind: 'present',
      // An unusable created_at becomes 0, which the classifier reports as REGISTRY_ROW_INVALID.
      rows: rows.map((r) => ({ hash: r.hash, createdAt: parseCreatedAt(r.created_at) ?? 0 })),
    },
    publicTableCount,
  };
}

/** `SET ROLE app_migrator` (session scope: the wrapper uses one connection). */
export async function setMigratorRole(sql: Sql): Promise<void> {
  await sql.unsafe(`SET ROLE ${APP_MIGRATOR_ROLE}`);
}
