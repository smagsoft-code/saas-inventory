import type { Sql } from 'postgres';
import { APP_MIGRATOR_ROLE } from '../migration-integrity/execution-guard';

/**
 * A controlled `NO FORCE` / `FORCE ROW LEVEL SECURITY` window for DATA migrations that must see rows
 * the policies would hide from the migration role (ADR-0041, RLS contract).
 *
 * Why it exists: `app_migrator` owns the tables and is subject to FORCE RLS, but the policies are
 * `TO app_tenant`; run as `app_migrator`, an `UPDATE`/`INSERT … SELECT` over invisible rows succeeds
 * and affects ZERO rows, with no error. Twelve applied migrations open such a window by hand, with
 * no guard. This helper is the checked form of that pattern for new data migrations. It is a tool for
 * a migration that needs it; nothing here is applied to existing migrations, and a migration that
 * does not need a window must not open one.
 *
 * Inside ONE transaction, in this order, aborting (and so rolling back, DDL included) on the first
 * failure:
 *  1. identity: `current_user` is `app_migrator` and neither superuser nor BYPASSRLS;
 *  2. initial state of every table: RLS enabled AND forced, owned by `current_user`;
 *  3. `ALTER TABLE … NO FORCE ROW LEVEL SECURITY` for exactly the tables named;
 *  4. `relforcerowsecurity = false` and `row_security_active(table) = false` (the window is open);
 *  5. the caller's DML (`run`);
 *  6. a postcondition that does not depend on the number of rows affected (`postcondition`);
 *  7. `ALTER TABLE … FORCE ROW LEVEL SECURITY`;
 *  8. `relforcerowsecurity = true` and `row_security_active(table) = true`.
 *
 * `DISABLE ROW LEVEL SECURITY` is never used. Tables are plain names in schema `public`.
 */

/** What a window needs from its transaction: raw SQL. Both a connection and a transaction provide it. */
export type Queryable = Pick<Sql, 'unsafe'>;

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

export class RlsWindowError extends Error {
  constructor(
    readonly step: 'identity' | 'initial-state' | 'window-open' | 'postcondition' | 'window-closed' | 'arguments',
    message: string,
  ) {
    super(message);
    this.name = 'RlsWindowError';
  }
}

export interface RlsWindowSpec {
  /** Tables (schema `public`) whose FORCE must be lifted; each one expressly justified by the migration. */
  readonly tables: readonly string[];
  /** The data change. It runs inside the open window, on the window's own transaction. */
  readonly run: (tx: Queryable) => Promise<void>;
  /** Must resolve `true`; checks the intended end state, not how many rows were touched. */
  readonly postcondition: (tx: Queryable) => Promise<boolean>;
}

interface TableState {
  force: boolean;
  enabled: boolean;
  owner_ok: boolean;
  active: boolean;
}

async function tableState(tx: Queryable, table: string): Promise<TableState> {
  const rows = await tx.unsafe<TableState[]>(
    `SELECT c.relforcerowsecurity AS force, c.relrowsecurity AS enabled,
            (pg_get_userbyid(c.relowner)::text = current_user::text) AS owner_ok,
            row_security_active(c.oid) AS active
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1 AND c.relkind IN ('r', 'p')`,
    [table],
  );
  const state = rows[0];
  if (state === undefined) throw new RlsWindowError('initial-state', `Table public.${table} does not exist.`);
  return state;
}

export async function runWithRlsWindow(sql: Sql, spec: RlsWindowSpec): Promise<void> {
  if (spec.tables.length === 0 || spec.tables.some((t) => !TABLE_NAME.test(t))) {
    throw new RlsWindowError('arguments', 'An RLS window needs at least one plain table name in schema public.');
  }
  await sql.begin(async (tx) => {
    const [who] = await tx.unsafe<{ current_user_name: string; is_super: boolean; bypass: boolean }[]>(
      `SELECT current_user::text AS current_user_name, r.rolsuper AS is_super, r.rolbypassrls AS bypass
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    if (who === undefined || who.current_user_name !== APP_MIGRATOR_ROLE || who.is_super || who.bypass) {
      throw new RlsWindowError('identity', `An RLS window must run as ${APP_MIGRATOR_ROLE}, not a superuser and without BYPASSRLS.`);
    }

    for (const table of spec.tables) {
      const state = await tableState(tx, table);
      if (!state.enabled || !state.force) {
        throw new RlsWindowError('initial-state', `public.${table} must start with RLS enabled and FORCE on.`);
      }
      if (!state.owner_ok) throw new RlsWindowError('initial-state', `public.${table} is not owned by ${APP_MIGRATOR_ROLE}.`);
    }

    for (const table of spec.tables) {
      await tx.unsafe(`ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY`);
      const open = await tableState(tx, table);
      if (open.force || open.active) {
        throw new RlsWindowError('window-open', `public.${table}: the window did not open (force=${String(open.force)}, row_security_active=${String(open.active)}).`);
      }
    }

    await spec.run(tx);

    if ((await spec.postcondition(tx)) !== true) {
      throw new RlsWindowError('postcondition', 'The postcondition of the data migration did not hold; rolling back.');
    }

    for (const table of spec.tables) {
      await tx.unsafe(`ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY`);
      const closed = await tableState(tx, table);
      if (!closed.force || !closed.active) {
        throw new RlsWindowError('window-closed', `public.${table}: FORCE was not restored (force=${String(closed.force)}, row_security_active=${String(closed.active)}).`);
      }
    }
  });
}
