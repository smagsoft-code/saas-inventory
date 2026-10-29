import type { ExecutionMode } from './execution-guard';
import { diagnostic, type Diagnostic } from './types';

/**
 * Resolution of the migrator's configuration from environment variables (ADR-0041, D-7.2).
 * Pure: it receives the environment as a plain object and returns either a configuration or
 * diagnostics. Nothing is read from disk and nothing is connected.
 *
 * Secrets: the connection URLs and the password are carried in the result because the caller needs
 * them to connect, but they never appear in a diagnostic, a warning or an error message — those name
 * the variable only.
 *
 * Variables
 *   MIGRATOR_BOOTSTRAP_DATABASE_URL    privileged login (bootstrap mode)
 *   MIGRATOR_INCREMENTAL_DATABASE_URL  limited login (incremental mode)
 *   MIGRATOR_INCREMENTAL_LOGIN         expected session_user of the incremental login
 *   MIGRATOR_INCREMENTAL_PASSWORD      used only by the bootstrap procedure that creates/configures that login
 *   MIGRATOR_EXPECTED_DATABASE         must equal current_database() (both modes)
 *   MIGRATOR_LOCK_TIMEOUT_SECONDS      optional; how long to wait for another run's migration lock (0-3600, default 60)
 *   MIGRATOR_DATABASE_URL              DEPRECATED alias of MIGRATOR_BOOTSTRAP_DATABASE_URL
 */

export type MigratorEnv = Readonly<Record<string, string | undefined>>;

export interface MigratorConfig {
  readonly mode: ExecutionMode;
  readonly expectedDatabase: string;
  /** Secret. The URL of the login the chosen mode connects with. */
  readonly connectionUrl: string;
  /** Login name embedded in `connectionUrl`. */
  readonly connectionLogin: string;
  /** True when the bootstrap URL came from the deprecated `MIGRATOR_DATABASE_URL`. */
  readonly usesLegacyUrl: boolean;
  readonly bootstrapLogin: string | undefined;
  readonly incrementalLogin: string | undefined;
  /** Secret. Present only when the bootstrap procedure must create/configure the incremental login. */
  readonly incrementalPassword: string | undefined;
  /** Bootstrap mode will also create/configure the incremental login and narrow the grants. */
  readonly provisionIncrementalLogin: boolean;
  /** How long to wait for the migration lock held by another run (0 = fail at once). */
  readonly lockTimeoutSeconds: number;
}

export interface ConfigResolution {
  readonly config: MigratorConfig | null;
  readonly diagnostics: readonly Diagnostic[];
  /** Non-blocking notes (deprecated variable in use, ignored variable). Never contain secrets. */
  readonly warnings: readonly string[];
}

const DATABASE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,62}$/;
/** Lowercase identifier a plain `CREATE ROLE` accepts without quoting rules to remember. */
const LOGIN_NAME = /^[a-z_][a-z0-9_]{2,62}$/;
/** Names that belong to PostgreSQL or to the application's own roles; never an incremental login. */
const RESERVED_LOGIN = /^(?:pg_|app_|postgres$|public$)/;
export const DEFAULT_LOCK_TIMEOUT_SECONDS = 60;
export const MAX_LOCK_TIMEOUT_SECONDS = 3600;
export const PASSWORD_MIN_LENGTH = 16;
export const PASSWORD_MAX_LENGTH = 128;

function present(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

interface ParsedUrl {
  readonly login: string;
  readonly database: string;
}

/** Validates shape only. Returns null (and a diagnostic naming the variable) for anything unusable. */
function parseConnectionUrl(variable: string, value: string, out: Diagnostic[]): ParsedUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    out.push(diagnostic('CONFIG_URL_INVALID', `${variable} is not a valid URL.`, { details: { variable } }));
    return null;
  }
  if ((url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') || url.hostname === '') {
    out.push(diagnostic('CONFIG_URL_INVALID', `${variable} must be a postgres:// or postgresql:// URL with a host.`, { details: { variable } }));
    return null;
  }
  let login: string;
  let database: string;
  try {
    login = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    out.push(diagnostic('CONFIG_URL_INVALID', `${variable} has an undecodable user or database name.`, { details: { variable } }));
    return null;
  }
  if (login === '' || database === '') {
    out.push(diagnostic('CONFIG_URL_INVALID', `${variable} must include a user and a database name.`, { details: { variable } }));
    return null;
  }
  return { login, database };
}

export function resolveMigratorConfig(env: MigratorEnv, requestedMode?: string): ConfigResolution {
  const out: Diagnostic[] = [];
  const warnings: string[] = [];

  const legacy = env['MIGRATOR_DATABASE_URL'];
  const bootstrapOnly = env['MIGRATOR_BOOTSTRAP_DATABASE_URL'];
  const incrementalUrl = env['MIGRATOR_INCREMENTAL_DATABASE_URL'];
  const incrementalLogin = env['MIGRATOR_INCREMENTAL_LOGIN'];
  const incrementalPassword = env['MIGRATOR_INCREMENTAL_PASSWORD'];
  const expectedDatabase = env['MIGRATOR_EXPECTED_DATABASE'];
  const lockTimeoutText = env['MIGRATOR_LOCK_TIMEOUT_SECONDS'];

  // Expected database: mandatory in both modes.
  if (!present(expectedDatabase)) {
    out.push(diagnostic('CONFIG_VARIABLE_MISSING', 'MIGRATOR_EXPECTED_DATABASE is required in both modes.', { details: { variable: 'MIGRATOR_EXPECTED_DATABASE' } }));
  } else if (!DATABASE_NAME.test(expectedDatabase)) {
    out.push(diagnostic('CONFIG_VARIABLE_MISSING', 'MIGRATOR_EXPECTED_DATABASE is not a plain database name.', { details: { variable: 'MIGRATOR_EXPECTED_DATABASE' } }));
  }

  let lockTimeoutSeconds = DEFAULT_LOCK_TIMEOUT_SECONDS;
  if (present(lockTimeoutText)) {
    if (!/^[0-9]{1,4}$/.test(lockTimeoutText) || Number(lockTimeoutText) > MAX_LOCK_TIMEOUT_SECONDS) {
      out.push(
        diagnostic('CONFIG_LOCK_TIMEOUT_INVALID', `MIGRATOR_LOCK_TIMEOUT_SECONDS must be a whole number of seconds from 0 to ${MAX_LOCK_TIMEOUT_SECONDS}.`, {
          details: { variable: 'MIGRATOR_LOCK_TIMEOUT_SECONDS' },
        }),
      );
    } else {
      lockTimeoutSeconds = Number(lockTimeoutText);
    }
  }

  // The deprecated alias and its replacement together are ambiguous: which one wins would be a guess.
  if (present(legacy) && present(bootstrapOnly)) {
    out.push(
      diagnostic('CONFIG_VARIABLE_CONFLICT', 'MIGRATOR_DATABASE_URL (deprecated) and MIGRATOR_BOOTSTRAP_DATABASE_URL are both set; keep only MIGRATOR_BOOTSTRAP_DATABASE_URL.', {
        details: { variables: 'MIGRATOR_DATABASE_URL,MIGRATOR_BOOTSTRAP_DATABASE_URL' },
      }),
    );
  }
  const bootstrapUrl = present(bootstrapOnly) ? bootstrapOnly : legacy;
  const usesLegacyUrl = !present(bootstrapOnly) && present(legacy);

  // Mode: explicit, or inferred only when exactly one login is configured. Never guessed between two.
  let mode: ExecutionMode | null = null;
  if (requestedMode !== undefined) {
    if (requestedMode === 'bootstrap' || requestedMode === 'incremental') mode = requestedMode;
    else out.push(diagnostic('CONFIG_MODE_INVALID', 'The mode must be "bootstrap" or "incremental".'));
  } else if (present(bootstrapUrl) && present(incrementalUrl)) {
    out.push(diagnostic('CONFIG_MODE_AMBIGUOUS', 'Both a bootstrap and an incremental URL are configured; pass --mode bootstrap|incremental.'));
  } else if (present(bootstrapUrl)) {
    mode = 'bootstrap';
  } else if (present(incrementalUrl)) {
    mode = 'incremental';
  } else {
    out.push(diagnostic('CONFIG_VARIABLE_MISSING', 'No migrator URL is configured (MIGRATOR_BOOTSTRAP_DATABASE_URL or MIGRATOR_INCREMENTAL_DATABASE_URL).'));
  }

  // The login name, when given, must be a legitimate incremental login.
  if (present(incrementalLogin) && (!LOGIN_NAME.test(incrementalLogin) || RESERVED_LOGIN.test(incrementalLogin))) {
    out.push(
      diagnostic('CONFIG_LOGIN_INVALID', 'MIGRATOR_INCREMENTAL_LOGIN must be a lowercase identifier (3-63 chars) not starting with pg_ or app_ and not postgres.', {
        details: { variable: 'MIGRATOR_INCREMENTAL_LOGIN' },
      }),
    );
  }

  let connectionUrl: string | undefined;
  let connectionLogin: string | undefined;
  let bootstrapLogin: string | undefined;

  if (mode !== null) {
    const urlVariable = mode === 'bootstrap' ? (usesLegacyUrl ? 'MIGRATOR_DATABASE_URL' : 'MIGRATOR_BOOTSTRAP_DATABASE_URL') : 'MIGRATOR_INCREMENTAL_DATABASE_URL';
    const url = mode === 'bootstrap' ? bootstrapUrl : incrementalUrl;
    if (!present(url)) {
      // No fallback: an incremental run never borrows the bootstrap URL, nor the reverse.
      out.push(diagnostic('CONFIG_VARIABLE_MISSING', `${urlVariable} is required in ${mode} mode.`, { details: { variable: urlVariable } }));
    } else {
      const parsed = parseConnectionUrl(urlVariable, url, out);
      if (parsed !== null) {
        connectionUrl = url;
        connectionLogin = parsed.login;
        if (present(expectedDatabase) && parsed.database !== expectedDatabase) {
          out.push(
            diagnostic('CONFIG_DATABASE_URL_MISMATCH', `The database named in ${urlVariable} is not the one in MIGRATOR_EXPECTED_DATABASE.`, {
              details: { variable: urlVariable },
            }),
          );
        }
      }
    }
    if (usesLegacyUrl) {
      warnings.push('MIGRATOR_DATABASE_URL is deprecated: it is being used as MIGRATOR_BOOTSTRAP_DATABASE_URL (bootstrap mode only). That mode creates a NEW database, runs --provision-only, or runs a pending privileged migration on a database already adopted with --provision-only; ordinary migrations on an existing database need incremental mode. Set MIGRATOR_BOOTSTRAP_DATABASE_URL instead.');
    }
  }

  // Login separation, from the URLs when both are known.
  if (present(bootstrapUrl)) {
    const parsedBootstrap = parseConnectionUrl('MIGRATOR_BOOTSTRAP_DATABASE_URL', bootstrapUrl, mode === 'bootstrap' ? [] : out);
    bootstrapLogin = parsedBootstrap?.login;
  }

  if (mode === 'incremental') {
    if (!present(incrementalLogin)) {
      out.push(diagnostic('CONFIG_VARIABLE_MISSING', 'MIGRATOR_INCREMENTAL_LOGIN is required in incremental mode.', { details: { variable: 'MIGRATOR_INCREMENTAL_LOGIN' } }));
    } else if (connectionLogin !== undefined && connectionLogin !== incrementalLogin) {
      out.push(
        diagnostic('CONFIG_LOGIN_URL_MISMATCH', 'The user in MIGRATOR_INCREMENTAL_DATABASE_URL is not MIGRATOR_INCREMENTAL_LOGIN.', {
          details: { variable: 'MIGRATOR_INCREMENTAL_DATABASE_URL' },
        }),
      );
    }
    if (present(incrementalPassword)) {
      warnings.push('MIGRATOR_INCREMENTAL_PASSWORD is only used by the bootstrap procedure; it is ignored in incremental mode.');
    }
  }

  let provision = false;
  if (mode === 'bootstrap') {
    if (present(incrementalLogin) || present(incrementalPassword) || present(incrementalUrl)) {
      if (!present(incrementalLogin)) {
        out.push(diagnostic('CONFIG_VARIABLE_CONFLICT', 'An incremental password or URL is set without MIGRATOR_INCREMENTAL_LOGIN.', { details: { variable: 'MIGRATOR_INCREMENTAL_LOGIN' } }));
      } else if (!present(incrementalPassword)) {
        out.push(diagnostic('CONFIG_VARIABLE_MISSING', 'MIGRATOR_INCREMENTAL_PASSWORD is required to create or configure the incremental login in bootstrap mode.', { details: { variable: 'MIGRATOR_INCREMENTAL_PASSWORD' } }));
      } else {
        provision = true;
      }
    }
    if (present(incrementalLogin) && bootstrapLogin !== undefined && incrementalLogin === bootstrapLogin) {
      out.push(diagnostic('CONFIG_LOGINS_NOT_SEPARATED', 'MIGRATOR_INCREMENTAL_LOGIN is the same account as the bootstrap login; they must be different.'));
    }
    if (present(incrementalUrl)) {
      const parsedIncremental = parseConnectionUrl('MIGRATOR_INCREMENTAL_DATABASE_URL', incrementalUrl, out);
      if (parsedIncremental !== null && present(incrementalLogin) && parsedIncremental.login !== incrementalLogin) {
        out.push(
          diagnostic('CONFIG_LOGIN_URL_MISMATCH', 'The user in MIGRATOR_INCREMENTAL_DATABASE_URL is not MIGRATOR_INCREMENTAL_LOGIN.', {
            details: { variable: 'MIGRATOR_INCREMENTAL_DATABASE_URL' },
          }),
        );
      }
    }
    if (present(incrementalPassword)) {
      const bad =
        incrementalPassword.length < PASSWORD_MIN_LENGTH ||
        incrementalPassword.length > PASSWORD_MAX_LENGTH ||
        incrementalPassword !== incrementalPassword.trim() ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f]/.test(incrementalPassword);
      if (bad) {
        out.push(
          diagnostic('CONFIG_PASSWORD_INVALID', `MIGRATOR_INCREMENTAL_PASSWORD must be ${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters, without control characters or surrounding spaces.`, {
            details: { variable: 'MIGRATOR_INCREMENTAL_PASSWORD' },
          }),
        );
      }
    }
  }

  // Two different modes' logins can only be compared when both are known.
  if (mode === 'incremental' && bootstrapLogin !== undefined && connectionLogin !== undefined && bootstrapLogin === connectionLogin) {
    out.push(diagnostic('CONFIG_LOGINS_NOT_SEPARATED', 'The bootstrap and incremental URLs use the same login; they must be different accounts.'));
  }

  if (out.length > 0 || mode === null || connectionUrl === undefined || connectionLogin === undefined || !present(expectedDatabase)) {
    return { config: null, diagnostics: out, warnings };
  }
  return {
    config: {
      mode,
      expectedDatabase,
      connectionUrl,
      connectionLogin,
      usesLegacyUrl,
      bootstrapLogin,
      incrementalLogin: present(incrementalLogin) ? incrementalLogin : undefined,
      incrementalPassword: mode === 'bootstrap' && provision ? incrementalPassword : undefined,
      provisionIncrementalLogin: provision,
      lockTimeoutSeconds,
    },
    diagnostics: [],
    warnings,
  };
}
