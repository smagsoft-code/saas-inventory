import { classifyHistory, type HistoryClassification } from './history-classifier';
import { validateAgainstHistoryManifest, validateClassifications, type HistoryManifest } from './history-manifest';
import { validateJournal } from './journal-validator';
import {
  findUndeclaredPrivileged,
  privilegedTags,
  validatePrivilegedManifest,
  type PrivilegedManifest,
} from './privileged-manifest';
import {
  diagnostic,
  type Diagnostic,
  type FileHashes,
  type JournalEntry,
  type RegistryHashCandidates,
  type RegistryState,
} from './types';

/**
 * The decision "may this run start?" (ADR-0041, decisions 1, 2, 3 and 5), taken BEFORE Drizzle is
 * invoked and from facts only. A refused run has executed nothing.
 *
 * Execution modes
 * - `bootstrap`: a superuser login, for a new database and for any pending privileged migration.
 * - `incremental`: a dedicated login that is not a superuser, has no BYPASSRLS and no CREATEROLE, is
 *   a member of `app_migrator` WITH SET, and runs everything as `app_migrator` after `SET ROLE`.
 */

export type ExecutionMode = 'bootstrap' | 'incremental';

export const APP_MIGRATOR_ROLE = 'app_migrator';

/** Facts about the connection, read-only, gathered by the caller once connected. */
export interface IdentityFacts {
  readonly database: string;
  /** `session_user`: who logged in. */
  readonly sessionUser: string;
  /** `current_user`: the effective role, after any `SET ROLE`. */
  readonly currentUser: string;
  readonly sessionIsSuperuser: boolean;
  readonly sessionBypassRls: boolean;
  readonly sessionCreateRole: boolean;
  readonly currentIsSuperuser: boolean;
  readonly currentBypassRls: boolean;
  readonly appMigratorRoleExists: boolean;
  /** `pg_auth_members.set_option` of the session user in `app_migrator`. */
  readonly sessionHasSetMembership: boolean;
  /** `has_database_privilege('app_migrator', current_database(), 'CREATE')`. */
  readonly appMigratorHasDatabaseCreate: boolean;
}

export interface ExecutionConfig {
  readonly requestedMode: ExecutionMode;
  readonly expectedDatabase: string;
  /** Login names as configured, when known; used to catch the two being the same account. */
  readonly bootstrapLogin?: string;
  readonly incrementalLogin?: string;
  /**
   * False for `--provision-only`, which applies nothing. Default true. When migrations will run and the batch does
   * not start with `0000`, Drizzle runs as `app_migrator` in BOTH modes and needs `CREATE` on the database.
   */
  readonly willRunMigrations?: boolean;
}

/**
 * Who `current_user` must be when the batch starts.
 * - `app_migrator` after `SET ROLE`, in both modes — except when migration 0 is still pending: `0000`
 *   creates the role, the extension and the grants itself, as the login, and issues its own
 *   `SET ROLE` afterwards, so a batch that includes it must start as the session user.
 * - Migrations that `RESET ROLE` (0019) return to the session user for a moment and set the role
 *   again; that is why the session user must be limited in incremental mode.
 */
export function expectedStartingRole(pending: readonly JournalEntry[]): 'session_user' | 'app_migrator' {
  return pending.some((e) => e.idx === 0) ? 'session_user' : 'app_migrator';
}

/** Shared by incremental mode and by bootstrap mode on an existing, never-provisioned database. */
const LACKS_DATABASE_CREATE_MESSAGE = '"app_migrator" lacks CREATE on the database, which Drizzle needs on every run (it executes CREATE SCHEMA IF NOT EXISTS and PostgreSQL checks that privilege first). Usual causes: this login was never provisioned on this database, or the database was created with CREATE DATABASE … TEMPLATE (database-level privileges are NOT copied from the template). To adopt it, with the bootstrap login and only if the history is consistent: run `db:migrate --mode bootstrap --provision-only` (needs MIGRATOR_INCREMENTAL_LOGIN and MIGRATOR_INCREMENTAL_PASSWORD), then `db:migrate --mode incremental`. Incremental mode never grants it by itself.';

export function evaluateIdentity(
  mode: ExecutionMode,
  facts: IdentityFacts,
  config: ExecutionConfig,
  pending: readonly JournalEntry[],
): Diagnostic[] {
  const out: Diagnostic[] = [];

  if (facts.database !== config.expectedDatabase) {
    out.push(
      diagnostic('CONFIG_DATABASE_MISMATCH', `Connected to database "${facts.database}" but "${config.expectedDatabase}" was expected.`, {
        details: { connected: facts.database, expected: config.expectedDatabase },
      }),
    );
  }
  if (config.bootstrapLogin !== undefined && config.incrementalLogin !== undefined && config.bootstrapLogin === config.incrementalLogin) {
    out.push(
      diagnostic('CONFIG_LOGINS_NOT_SEPARATED', 'The bootstrap login and the incremental login are the same account; they must be different.', {
        details: { login: config.bootstrapLogin },
      }),
    );
  }

  const expected = expectedStartingRole(pending);
  const expectedName = expected === 'session_user' ? facts.sessionUser : APP_MIGRATOR_ROLE;
  if (pending.length > 0 && facts.currentUser !== expectedName) {
    out.push(
      diagnostic('IDENTITY_CURRENT_USER_UNEXPECTED', `current_user is "${facts.currentUser}"; "${expectedName}" was expected when the run starts.`, {
        details: { currentUser: facts.currentUser, expected: expectedName, sessionUser: facts.sessionUser },
      }),
    );
  }

  if (mode === 'bootstrap') {
    if (!facts.sessionIsSuperuser) {
      out.push(
        diagnostic('IDENTITY_BOOTSTRAP_NOT_SUPERUSER', `Bootstrap mode needs a superuser login; "${facts.sessionUser}" is not one (creating the BYPASSRLS role in 0000 requires it).`, {
          details: { sessionUser: facts.sessionUser },
        }),
      );
    }
    // When the batch does not include 0000, the effective role is app_migrator even in bootstrap
    // mode, and it must still be a role subject to RLS (a drifted app_migrator with BYPASSRLS would
    // make every data migration silently unrestricted).
    if (expected === 'app_migrator' && pending.length > 0 && config.willRunMigrations !== false && facts.appMigratorRoleExists && !facts.appMigratorHasDatabaseCreate) {
      // Without this, Drizzle fails inside its own CREATE SCHEMA IF NOT EXISTS (rolled back, but opaque).
      out.push(diagnostic('IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE', LACKS_DATABASE_CREATE_MESSAGE));
    }
    if (expected === 'app_migrator' && (facts.currentIsSuperuser || facts.currentBypassRls)) {
      out.push(
        diagnostic('IDENTITY_CURRENT_USER_PRIVILEGED', `The effective role "${facts.currentUser}" is a superuser or has BYPASSRLS; migrations must run as a role subject to RLS.`, {
          details: { currentUser: facts.currentUser },
        }),
      );
    }
    return out;
  }

  // incremental
  if (facts.sessionIsSuperuser) {
    out.push(diagnostic('IDENTITY_SESSION_SUPERUSER', `The incremental login "${facts.sessionUser}" is a superuser; RESET ROLE would restore full privileges.`));
  }
  if (facts.sessionBypassRls) {
    out.push(diagnostic('IDENTITY_SESSION_BYPASSRLS', `The incremental login "${facts.sessionUser}" has BYPASSRLS.`));
  }
  if (facts.sessionCreateRole) {
    out.push(diagnostic('IDENTITY_SESSION_CREATEROLE', `The incremental login "${facts.sessionUser}" has CREATEROLE.`));
  }
  if (config.incrementalLogin !== undefined && facts.sessionUser !== config.incrementalLogin) {
    out.push(
      diagnostic('IDENTITY_SESSION_USER_MISMATCH', `Logged in as "${facts.sessionUser}" but the configured incremental login is "${config.incrementalLogin}".`, {
        details: { sessionUser: facts.sessionUser, configured: config.incrementalLogin },
      }),
    );
  }
  if (!facts.appMigratorRoleExists) {
    out.push(diagnostic('IDENTITY_APP_MIGRATOR_ROLE_MISSING', 'The role "app_migrator" does not exist; bootstrap the database first.'));
  } else {
    if (!facts.sessionHasSetMembership) {
      out.push(diagnostic('IDENTITY_NO_SET_MEMBERSHIP', `"${facts.sessionUser}" is not a member of "app_migrator" WITH SET, so SET ROLE would fail.`));
    }
    if (!facts.appMigratorHasDatabaseCreate) {
      out.push(
        diagnostic(
          'IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE',
          LACKS_DATABASE_CREATE_MESSAGE,
        ),
      );
    }
  }
  if (facts.currentIsSuperuser || facts.currentBypassRls) {
    out.push(
      diagnostic('IDENTITY_CURRENT_USER_PRIVILEGED', `The effective role "${facts.currentUser}" is a superuser or has BYPASSRLS; migrations must run as a role subject to RLS.`, {
        details: { currentUser: facts.currentUser },
      }),
    );
  }
  return out;
}

export interface ExecutionInput {
  readonly config: ExecutionConfig;
  readonly facts: IdentityFacts;
  readonly journal: readonly JournalEntry[];
  readonly fileHashes: FileHashes;
  readonly registryHashCandidates: RegistryHashCandidates;
  /** Text of each migration file, for the undeclared-privileged-statement safety net. */
  readonly sqlByTag: Readonly<Record<string, string | undefined>>;
  readonly registry: RegistryState;
  readonly publicTableCount: number;
  readonly historyManifest: HistoryManifest;
  readonly privilegedManifest: PrivilegedManifest;
}

export interface ExecutionAssessment {
  /** True only when `diagnostics` is empty. */
  readonly allowed: boolean;
  readonly requestedMode: ExecutionMode;
  /** The mode the state requires; `null` when nothing is pending or the state is inconsistent. */
  readonly requiredMode: ExecutionMode | null;
  readonly classification: HistoryClassification;
  readonly diagnostics: readonly Diagnostic[];
}

/** The pure decision. Never throws for bad input: bad input is a diagnostic. */
export function assessExecution(input: ExecutionInput): ExecutionAssessment {
  const { config, journal, fileHashes } = input;
  const diagnostics: Diagnostic[] = [];

  // 1. The references: journal, history manifest, privileged manifest.
  diagnostics.push(...validateJournal(journal, fileHashes));
  diagnostics.push(...validateAgainstHistoryManifest(journal, fileHashes, input.historyManifest));
  diagnostics.push(...validatePrivilegedManifest(input.privilegedManifest, journal, fileHashes));
  diagnostics.push(...validateClassifications(input.historyManifest, privilegedTags(input.privilegedManifest)));
  diagnostics.push(...findUndeclaredPrivileged(input.privilegedManifest, journal, input.sqlByTag));

  // 2. The database's history against the journal.
  const classification = classifyHistory({
    journal,
    fileHashes,
    registryHashCandidates: input.registryHashCandidates,
    registry: input.registry,
    publicTableCount: input.publicTableCount,
    privilegedTags: privilegedTags(input.privilegedManifest),
  });
  // validateJournal findings are already in `diagnostics`; keep each finding once.
  const journalCodes = new Set(diagnostics.map((d) => `${d.code}|${d.migration ?? ''}|${d.message}`));
  for (const d of classification.diagnostics) {
    if (!journalCodes.has(`${d.code}|${d.migration ?? ''}|${d.message}`)) diagnostics.push(d);
  }

  // 3. Is the requested mode the one the state requires?
  let requiredMode: ExecutionMode | null = null;
  if (classification.state !== 'INCONSISTENT') {
    const privileged = privilegedTags(input.privilegedManifest);
    const privilegedPending = classification.pending.filter((e) => privileged.has(e.tag));
    if (classification.pending.length > 0) {
      requiredMode = classification.state === 'NEW' || privilegedPending.length > 0 ? 'bootstrap' : 'incremental';
      if (config.requestedMode !== requiredMode) {
        if (requiredMode === 'bootstrap' && classification.state === 'NEW') {
          diagnostics.push(diagnostic('MODE_NEW_DATABASE_REQUIRES_BOOTSTRAP', 'The database is new; it must be bootstrapped with the privileged login, not migrated incrementally.'));
        } else if (requiredMode === 'bootstrap') {
          diagnostics.push(
            diagnostic(
              'PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE',
              `Privileged migration(s) pending (${privilegedPending.map((e) => e.tag).join(', ')}); incremental mode cannot run them. Run bootstrap mode.`,
              { details: { pending: privilegedPending.map((e) => e.tag).join(', ') } },
            ),
          );
        } else {
          diagnostics.push(
            diagnostic('MODE_BOOTSTRAP_NOT_REQUIRED', 'Only ordinary migrations are pending; they run in incremental mode, not with the superuser login. If the incremental login is not set up on this database yet, set MIGRATOR_INCREMENTAL_LOGIN and MIGRATOR_INCREMENTAL_PASSWORD, run `db:migrate --mode bootstrap --provision-only` once, then `db:migrate --mode incremental`. The deprecated MIGRATOR_DATABASE_URL is a bootstrap-only alias and cannot run these migrations.'),
          );
        }
      }
    }
  }

  // 4. Identity and configuration of the connection.
  diagnostics.push(...evaluateIdentity(config.requestedMode, input.facts, config, classification.pending));

  return { allowed: diagnostics.length === 0, requestedMode: config.requestedMode, requiredMode, classification, diagnostics };
}

/** One-line-per-finding text for logs and the CLI; contains no credentials or row data. */
export function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map((d) => `[${d.code}]${d.migration !== undefined ? ` (${d.migration})` : ''} ${d.message}`).join('\n');
}
