/**
 * Shared types of the migration-integrity checks (ADR-0041, delivery 2a).
 *
 * Everything under `migration-integrity/` is pure logic over in-memory facts: nothing here opens a
 * database connection, runs SQL or invokes Drizzle. `migration-files.ts` is the only module that
 * touches the file system (read-only), and `history-manifest.cli.ts` the only one that can write
 * (the history manifest, nothing else).
 */

/** One entry of `database/migrations/meta/_journal.json`, the shape `drizzle-kit` writes. */
export interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  /** Epoch milliseconds; Drizzle stores it as `created_at` in its registry table. */
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

/**
 * CANONICAL SHA-256 of each migration file (line endings normalised to LF — see `hash.ts`), keyed by
 * journal tag. `null` means the file does not exist. This is the value the manifests hold.
 */
export type FileHashes = Readonly<Record<string, string | null>>;

/**
 * Hashes `drizzle-orm` could have registered for the CURRENT content of each file (raw, LF and CRLF
 * variants), keyed by journal tag. Used to compare the registry with the files without depending on
 * the line endings of whichever checkout applied the migration.
 */
export type RegistryHashCandidates = Readonly<Record<string, readonly string[]>>;

/** One row of `drizzle.__drizzle_migrations`, in insertion order (ascending `id`). */
export interface RegistryRow {
  readonly hash: string;
  /** `created_at`, which Drizzle fills with the journal entry's `when`. */
  readonly createdAt: number;
}

export type RegistryState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly rows: readonly RegistryRow[] };

/** Why a run is refused. Stable identifiers: tests, documentation and logs refer to them. */
export const DIAGNOSTIC_CODES = [
  // journal
  'JOURNAL_MALFORMED',
  'JOURNAL_EMPTY',
  'JOURNAL_IDX_NOT_CONTIGUOUS',
  'JOURNAL_IDX_DUPLICATE',
  'JOURNAL_TAG_DUPLICATE',
  'JOURNAL_TAG_INDEX_MISMATCH',
  'JOURNAL_WHEN_INVALID',
  'JOURNAL_WHEN_NOT_INCREASING',
  'SQL_FILE_MISSING',
  // history manifest
  'MANIFEST_MALFORMED',
  'MANIFEST_ENTRY_MISSING',
  'MANIFEST_ENTRY_EXTRA',
  'MANIFEST_FIELD_MISMATCH',
  'MANIFEST_HASH_MISMATCH',
  // privileged manifest
  'PRIVILEGED_MANIFEST_MALFORMED',
  'PRIVILEGED_MANIFEST_DUPLICATE',
  'PRIVILEGED_MANIFEST_REQUIRED_MISSING',
  'PRIVILEGED_MANIFEST_TAG_UNKNOWN',
  'PRIVILEGED_MANIFEST_HASH_MISMATCH',
  'PRIVILEGED_STATEMENT_UNDECLARED',
  // explicit classification and review evidence (history manifest v2)
  'CLASSIFICATION_MISSING',
  'CLASSIFICATION_MISMATCH',
  'REVIEW_EVIDENCE_MISSING',
  'REVIEW_EVIDENCE_INVALID',
  // registry vs journal
  'REGISTRY_MISSING_WITH_TABLES',
  'REGISTRY_EMPTY_WITH_TABLES',
  'REGISTRY_WITHOUT_TABLES',
  'REGISTRY_ROW_INVALID',
  'REGISTRY_ROW_WITHOUT_JOURNAL_ENTRY',
  'HISTORY_NOT_PREFIX',
  'HISTORY_MISSING_APPLIED_MIGRATION',
  'HISTORY_HASH_MISMATCH',
  'PENDING_WHEN_AT_OR_BELOW_MAX_APPLIED',
  'PRIVILEGED_MIGRATION_MISSING_FROM_HISTORY',
  // mode, configuration and identity
  'MODE_NEW_DATABASE_REQUIRES_BOOTSTRAP',
  'MODE_BOOTSTRAP_NOT_REQUIRED',
  'PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE',
  'CONFIG_DATABASE_MISMATCH',
  'CONFIG_LOGINS_NOT_SEPARATED',
  'CONFIG_MODE_INVALID',
  'CONFIG_MODE_AMBIGUOUS',
  'CONFIG_VARIABLE_MISSING',
  'CONFIG_VARIABLE_CONFLICT',
  'CONFIG_URL_INVALID',
  'CONFIG_DATABASE_URL_MISMATCH',
  'CONFIG_LOGIN_INVALID',
  'CONFIG_LOGIN_URL_MISMATCH',
  'CONFIG_PASSWORD_INVALID',
  // the command line, and the preconditions of --provision-only
  'CLI_ARGUMENT_INVALID',
  'PROVISION_PRECONDITION_FAILED',
  // SQL/RLS lint (D-8D)
  'SQL_LINT_ERROR',
  'SQL_LINT_PARSER_UNAVAILABLE',
  'LINT_EXCEPTION_INVALID',
  // mutual exclusion between runs (D-8C)
  'LOCK_NOT_ACQUIRED',
  'CONFIG_LOCK_TIMEOUT_INVALID',
  // owner / RLS invariants of the state a batch leaves behind (D-8B)
  'INVARIANT_OWNER_MISMATCH',
  'INVARIANT_RLS_NOT_FORCED',
  'INVARIANT_RLS_DISABLED',
  'INVARIANT_DRIZZLE_OWNER',
  'INVARIANT_REGISTRY_MISMATCH',
  'INVARIANT_IDENTITY_UNEXPECTED',
  'INVARIANT_GUARD_NOT_INVOKED',
  'INVARIANT_CHECK_FAILED',
  // facts that could not be read from PostgreSQL, and post-run checks
  'FACTS_UNAVAILABLE',
  'REGISTRY_UNREADABLE',
  'POSTCHECK_FAILED',
  'IDENTITY_BOOTSTRAP_NOT_SUPERUSER',
  'IDENTITY_SESSION_SUPERUSER',
  'IDENTITY_SESSION_BYPASSRLS',
  'IDENTITY_SESSION_CREATEROLE',
  'IDENTITY_SESSION_USER_MISMATCH',
  'IDENTITY_APP_MIGRATOR_ROLE_MISSING',
  'IDENTITY_NO_SET_MEMBERSHIP',
  'IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE',
  'IDENTITY_CURRENT_USER_UNEXPECTED',
  'IDENTITY_CURRENT_USER_PRIVILEGED',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];

export type DiagnosticDetails = Readonly<Record<string, string | number | boolean | null>>;

export interface Diagnostic {
  readonly code: DiagnosticCode;
  /** Human-readable; never contains a credential, a connection string or row data. */
  readonly message: string;
  /** Journal tag the finding is about, when there is one. */
  readonly migration?: string;
  readonly details?: DiagnosticDetails;
}

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  extra: { migration?: string; details?: DiagnosticDetails } = {},
): Diagnostic {
  return {
    code,
    message,
    ...(extra.migration !== undefined ? { migration: extra.migration } : {}),
    ...(extra.details !== undefined ? { details: extra.details } : {}),
  };
}
