/**
 * The catalogue of SQL/RLS lint rules (ADR-0041, D-8D). Stable identifiers, an explicit severity per migration context,
 * and what a finding means. The evaluation lives in `lint-migration.ts`; this file is the contract that tests, reports,
 * exceptions and documentation refer to.
 *
 * Severity depends on the migration's classification in the history manifest:
 *  - `ordinary`  — the migration runs in incremental mode, as `app_migrator`, and must not touch roles, ownership, the
 *                  database or the session identity. An unclassified migration is treated as ordinary (the stricter reading).
 *  - `privileged` — declared in the privileged manifest (0000, 0019): it runs in bootstrap mode, where role and extension
 *                  statements are expected. Being declared privileged does NOT make everything allowed: file access, `ALTER
 *                  SYSTEM`, database-level DDL and the like stay errors, and dangerous role attributes are still flagged.
 *
 * ERROR blocks the run (the wrapper refuses it before Drizzle starts); WARNING needs a human look and never means "safe";
 * INFO documents a relevant statement that does not break the contract by itself.
 */

export type LintSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type MigrationContext = 'ordinary' | 'privileged';
export type LintCategory =
  | 'privilege'
  | 'ownership'
  | 'role'
  | 'session'
  | 'administrative'
  | 'rls'
  | 'trigger'
  | 'function'
  | 'dynamic-sql'
  | 'transaction'
  | 'data'
  | 'parse';

export interface RuleInfo {
  readonly id: string;
  readonly category: LintCategory;
  readonly title: string;
  readonly ordinary: LintSeverity;
  readonly privileged: LintSeverity;
  /** May an approved, exact exception accept it? Never for something that makes the file unanalysable. */
  readonly exceptable: boolean;
  /** True when the statement belongs to the bootstrap flow (roles, extensions, session identity). */
  readonly bootstrap: boolean;
}

const rule = (
  id: string,
  category: LintCategory,
  title: string,
  ordinary: LintSeverity,
  privileged: LintSeverity,
  options: { exceptable?: boolean; bootstrap?: boolean } = {},
): RuleInfo => ({ id, category, title, ordinary, privileged, exceptable: options.exceptable ?? true, bootstrap: options.bootstrap ?? false });

const LIST: readonly RuleInfo[] = [
  // --- privileges, roles, ownership
  rule('PRIV-GRANT', 'privilege', 'GRANT to a named application role', 'WARNING', 'WARNING'),
  rule('PRIV-GRANT-BROAD', 'privilege', 'GRANT ALL / GRANT on ALL objects in a schema', 'ERROR', 'WARNING'),
  rule('PRIV-GRANT-PUBLIC', 'privilege', 'GRANT to PUBLIC, WITH GRANT OPTION, or to a role that is not a project role', 'ERROR', 'ERROR'),
  rule('PRIV-REVOKE', 'privilege', 'REVOKE', 'WARNING', 'WARNING'),
  rule('PRIV-ROLE-MEMBERSHIP', 'role', 'GRANT/REVOKE of a role membership', 'ERROR', 'INFO', { bootstrap: true }),
  rule('PRIV-OWNER-CHANGE', 'ownership', 'Change of owner (ALTER … OWNER TO, CREATE SCHEMA AUTHORIZATION)', 'ERROR', 'INFO', { bootstrap: true }),
  rule('PRIV-REASSIGN', 'ownership', 'REASSIGN OWNED / DROP OWNED', 'ERROR', 'ERROR'),
  rule('PRIV-DEFAULT-PRIVILEGES', 'privilege', 'ALTER DEFAULT PRIVILEGES', 'ERROR', 'WARNING'),
  rule('ROLE-DDL', 'role', 'CREATE / ALTER / DROP ROLE (also ALTER ROLE … SET)', 'ERROR', 'INFO', { bootstrap: true }),
  rule('ROLE-ATTRIBUTES', 'role', 'A role given SUPERUSER, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS', 'ERROR', 'WARNING', { bootstrap: true }),
  rule('SESSION-IDENTITY', 'session', 'SET / RESET ROLE, SET SESSION AUTHORIZATION', 'ERROR', 'INFO', { bootstrap: true }),
  rule('ADMIN-DATABASE', 'administrative', 'CREATE / ALTER / DROP DATABASE, ALTER SYSTEM, tablespaces, LOAD', 'ERROR', 'ERROR'),
  rule('ADMIN-EXTENSION', 'administrative', 'CREATE / ALTER / DROP EXTENSION', 'ERROR', 'INFO', { bootstrap: true }),
  rule('ADMIN-REMOTE', 'administrative', 'Foreign data, event triggers, publications, subscriptions', 'ERROR', 'ERROR'),
  rule('ADMIN-FILE-ACCESS', 'administrative', 'COPY from/to a server file or a program', 'ERROR', 'ERROR'),
  rule('FUNC-SERVER-ACCESS', 'administrative', 'A function that reads/writes server files, runs remote SQL or controls the server', 'ERROR', 'ERROR'),
  rule('TXN-CONTROL', 'transaction', 'BEGIN / COMMIT / ROLLBACK / PREPARE TRANSACTION', 'ERROR', 'ERROR', { exceptable: false }),
  rule('TXN-SAVEPOINT', 'transaction', 'SAVEPOINT / RELEASE / ROLLBACK TO', 'WARNING', 'WARNING'),
  // --- RLS and tenant isolation
  rule('RLS-DISABLE', 'rls', 'DISABLE ROW LEVEL SECURITY', 'ERROR', 'ERROR'),
  rule('RLS-WINDOW', 'rls', 'NO FORCE ROW LEVEL SECURITY restored by FORCE in the same file', 'WARNING', 'WARNING'),
  rule('RLS-WINDOW-UNRESTORED', 'rls', 'NO FORCE ROW LEVEL SECURITY never restored by FORCE in the same file', 'ERROR', 'ERROR'),
  rule('RLS-WINDOW-UNGUARDED', 'rls', 'A NO FORCE window with no verification (row_security_active / relforcerowsecurity) the parser can see', 'WARNING', 'WARNING'),
  rule('RLS-ENABLE-WITHOUT-FORCE', 'rls', 'ENABLE ROW LEVEL SECURITY with no FORCE in the same file', 'ERROR', 'ERROR'),
  rule('RLS-ENABLE', 'rls', 'ENABLE ROW LEVEL SECURITY', 'INFO', 'INFO'),
  rule('RLS-FORCE', 'rls', 'FORCE ROW LEVEL SECURITY', 'INFO', 'INFO'),
  rule('RLS-POLICY-CREATE', 'rls', 'CREATE POLICY', 'INFO', 'INFO'),
  rule('RLS-POLICY-PUBLIC', 'rls', 'A policy that applies to PUBLIC (no TO clause, or TO PUBLIC)', 'ERROR', 'ERROR'),
  rule('RLS-POLICY-ALWAYS-TRUE', 'rls', 'A policy whose USING / WITH CHECK is the constant true', 'WARNING', 'WARNING'),
  rule('RLS-POLICY-CHANGE', 'rls', 'ALTER POLICY / DROP POLICY', 'WARNING', 'WARNING'),
  rule('RLS-SETTING', 'rls', 'Changing row_security or session_replication_role', 'ERROR', 'ERROR'),
  rule('TRIGGER-DISABLE-WINDOW', 'trigger', 'DISABLE TRIGGER re-enabled in the same file', 'WARNING', 'WARNING'),
  rule('TRIGGER-DISABLED-UNRESTORED', 'trigger', 'DISABLE TRIGGER never re-enabled in the same file', 'ERROR', 'ERROR'),
  rule('TRIGGER-PROTECTED', 'trigger', 'Disabling or dropping a tenant-isolation trigger', 'ERROR', 'ERROR'),
  rule('TRIGGER-DROP', 'trigger', 'DROP TRIGGER', 'WARNING', 'WARNING'),
  rule('TENANT-COLUMN', 'rls', 'Dropping, renaming, retyping or making nullable the tenant_id column', 'ERROR', 'ERROR'),
  // --- functions and dynamic SQL
  rule('FUNC-SECURITY-DEFINER', 'function', 'SECURITY DEFINER', 'ERROR', 'ERROR'),
  rule('FUNC-UNTRUSTED-LANGUAGE', 'function', 'A function or DO block in a language other than sql / plpgsql', 'ERROR', 'ERROR'),
  rule('PLPGSQL-UNANALYZED', 'dynamic-sql', 'PL/pgSQL (DO block or function body) the parser cannot analyse', 'ERROR', 'WARNING', { bootstrap: true }),
  rule('DYN-EXECUTE', 'dynamic-sql', 'EXECUTE of a prepared statement, PREPARE or CALL', 'WARNING', 'WARNING'),
  rule('ADVISORY-LOCK', 'function', 'pg_advisory_* call (can interfere with the migration lock)', 'WARNING', 'WARNING'),
  // --- data
  rule('DATA-TRUNCATE', 'data', 'TRUNCATE', 'WARNING', 'WARNING'),
  rule('DATA-DROP', 'data', 'DROP TABLE / DROP SCHEMA', 'WARNING', 'WARNING'),
  // --- the file itself
  rule('LINT-PARSE-ERROR', 'parse', 'The SQL could not be parsed: nothing can be said about it', 'ERROR', 'ERROR', { exceptable: false }),
  rule('LINT-EMPTY', 'parse', 'A migration file with no statement', 'WARNING', 'WARNING'),
  rule('LINT-INTERNAL', 'parse', 'The linter could not interpret the parser output', 'ERROR', 'ERROR', { exceptable: false }),
];

export const RULES: Readonly<Record<string, RuleInfo>> = Object.freeze(Object.fromEntries(LIST.map((r) => [r.id, r])));
export const RULE_IDS: readonly string[] = LIST.map((r) => r.id);

export function severityOf(ruleId: string, context: MigrationContext): LintSeverity {
  const info = RULES[ruleId];
  if (info === undefined) throw new Error(`Unknown lint rule "${ruleId}".`);
  return context === 'privileged' ? info.privileged : info.ordinary;
}

/** The roles the project defines (migration 0000 and 0019); a GRANT to anything else is not "a project role". */
export const PROJECT_ROLES: ReadonlySet<string> = new Set([
  'app_migrator',
  'app_tenant',
  'app_platform',
  'app_event_processor',
  'app_public_resolver',
  'app_import_worker',
]);

/** Triggers that enforce tenant isolation (database.md): disabling or dropping one is never routine. */
export const PROTECTED_TRIGGER_PATTERN = 'tenant';

/** Functions a migration has no business calling. */
export const SERVER_ACCESS_FUNCTIONS: ReadonlySet<string> = new Set([
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_ls_logdir',
  'pg_ls_waldir',
  'pg_stat_file',
  'lo_import',
  'lo_export',
  'dblink',
  'dblink_exec',
  'dblink_connect',
  'dblink_connect_u',
  'pg_reload_conf',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_rotate_logfile',
  'pg_switch_wal',
  'pg_promote',
]);

export const SENSITIVE_SETTINGS: ReadonlySet<string> = new Set(['row_security', 'session_replication_role']);
