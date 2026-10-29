import type { Sql } from 'postgres';
import { APP_MIGRATOR_ROLE } from '../migration-integrity/execution-guard';

/**
 * The bootstrap procedure for the incremental login (ADR-0041, S3). It runs ONLY in bootstrap mode,
 * with the privileged login, AFTER the migrations succeeded. It is idempotent and never runs in
 * incremental mode.
 *
 * What it does, in one transaction:
 *  1. creates or reconfigures the incremental login: LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
 *     NOBYPASSRLS, NOREPLICATION, NOINHERIT, with the given password. An existing role that is a
 *     superuser, or that is a member of any role other than `app_migrator`, is refused, never demoted;
 *  2. `GRANT app_migrator TO <login> WITH INHERIT FALSE, SET TRUE`: the login can `SET ROLE
 *     app_migrator` but holds none of its privileges until it does;
 *  3. `GRANT CONNECT` on the database to the login and `GRANT CREATE ON DATABASE` to `app_migrator`
 *     (Drizzle runs `CREATE SCHEMA IF NOT EXISTS drizzle` on every execution and PostgreSQL checks the
 *     CREATE privilege before it looks at whether the schema exists);
 *  4. narrows what `app_migrator` has on Drizzle's own objects: migration 0000 granted ALL on schema
 *     `drizzle`; it keeps USAGE+CREATE on the schema, SELECT+INSERT on the registry table and USAGE on
 *     its sequence — no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER. Applied SQL is not edited:
 *     the narrowing is done here, afterwards.
 *
 * Privileges alone cannot stop an INSERT of a forged row (for instance with a far-future
 * `created_at`, which makes Drizzle skip every later migration); the history validation of the
 * wrapper is what detects that.
 *
 * The password is spliced into DDL (PARAMETERS are not accepted there) as a literal that PostgreSQL
 * itself produced with `quote_literal`, with `log_statement` silenced for the transaction so the
 * server log does not record it. It is never printed.
 */

const LOGIN_PATTERN = /^[a-z_][a-z0-9_]{2,62}$/;

export interface ProvisionResult {
  readonly login: string;
  readonly loginCreated: boolean;
}

export async function provisionIncrementalLogin(sql: Sql, login: string, password: string): Promise<ProvisionResult> {
  if (!LOGIN_PATTERN.test(login)) throw new Error('The incremental login is not a valid identifier.');

  return sql.begin(async (tx): Promise<ProvisionResult> => {
    await tx.unsafe(`SET LOCAL log_statement = 'none'`);

    const [identity] = await tx.unsafe<{ is_super: boolean; db: string }[]>(
      `SELECT r.rolsuper AS is_super, current_database()::text AS db FROM pg_roles r WHERE r.rolname = session_user`,
    );
    if (identity?.is_super !== true) throw new Error('Provisioning needs the privileged (superuser) login.');

    const [migrator] = await tx.unsafe<{ ok: boolean }[]>(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_MIGRATOR_ROLE}') AS ok`);
    if (migrator?.ok !== true) throw new Error(`Role ${APP_MIGRATOR_ROLE} does not exist; the migrations did not create it.`);

    const [quoted] = await tx.unsafe<{ pw: string; ident: string; db: string }[]>(
      `SELECT quote_literal($1::text) AS pw, quote_ident($2::text) AS ident, quote_ident(current_database()) AS db`,
      [password, login],
    );
    if (quoted === undefined) throw new Error('quote_literal returned no row.');

    // 1. the login
    const [existing] = await tx.unsafe<{ is_super: boolean }[]>(`SELECT rolsuper AS is_super FROM pg_roles WHERE rolname = $1`, [login]);
    if (existing?.is_super === true) throw new Error('The incremental login already exists and is a superuser; refusing to reconfigure it.');
    if (existing !== undefined) {
      const others = await tx.unsafe<{ role: string }[]>(
        `SELECT r.rolname AS role FROM pg_auth_members m
           JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member
          WHERE u.rolname = $1 AND r.rolname <> '${APP_MIGRATOR_ROLE}'`,
        [login],
      );
      if (others.length > 0) throw new Error('The incremental login is a member of roles other than app_migrator; refusing to reconfigure it.');
    }
    const attributes = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT';
    await tx.unsafe(`${existing === undefined ? 'CREATE' : 'ALTER'} ROLE ${quoted.ident} WITH ${attributes} PASSWORD ${quoted.pw}`);

    // 2. membership: SET only, no inheritance
    await tx.unsafe(`GRANT ${APP_MIGRATOR_ROLE} TO ${quoted.ident} WITH INHERIT FALSE, SET TRUE`);

    // 3. database privileges
    await tx.unsafe(`GRANT CONNECT ON DATABASE ${quoted.db} TO ${quoted.ident}`);
    await tx.unsafe(`GRANT CREATE ON DATABASE ${quoted.db} TO ${APP_MIGRATOR_ROLE}`);

    // 4. Drizzle's own objects
    const [schema] = await tx.unsafe<{ ok: boolean }[]>(`SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') AS ok`);
    if (schema?.ok === true) {
      const owners = await tx.unsafe<{ owner: string }[]>(
        `SELECT pg_get_userbyid(c.relowner)::text AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'drizzle' AND c.relkind IN ('r', 'S')`,
      );
      if (owners.some((o) => o.owner === APP_MIGRATOR_ROLE)) {
        throw new Error('app_migrator owns Drizzle objects; the registry must stay under the bootstrap owner.');
      }
      await tx.unsafe(`REVOKE ALL ON SCHEMA drizzle FROM ${APP_MIGRATOR_ROLE}`);
      await tx.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM ${APP_MIGRATOR_ROLE}`);
      await tx.unsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA drizzle FROM ${APP_MIGRATOR_ROLE}`);
      await tx.unsafe(`GRANT USAGE, CREATE ON SCHEMA drizzle TO ${APP_MIGRATOR_ROLE}`);
      await tx.unsafe(`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA drizzle TO ${APP_MIGRATOR_ROLE}`);
      await tx.unsafe(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA drizzle TO ${APP_MIGRATOR_ROLE}`);
    }

    return { login, loginCreated: existing === undefined };
  });
}
