/**
 * Generic environment-variable access shared by every app.
 * Concrete env schemas (which vars an app requires) are defined per-app,
 * not here — this only provides the safe read primitive.
 */

export class MissingEnvVarError extends Error {
  constructor(name: string) {
    super(`Missing required environment variable: ${name}`);
    this.name = 'MissingEnvVarError';
  }
}

export function getRequiredEnvVar(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new MissingEnvVarError(name);
  }
  return value;
}

export function getOptionalEnvVar(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

/**
 * The privileged ("bootstrap") migrator connection, for every consumer that is not the migration
 * wrapper itself: `bootstrap-dev-roles`, the seeds, `reset-demo`, `drizzle.config.ts`, the dev tools.
 * One contract for all of them (ADR-0041, D-8A):
 *
 * - `MIGRATOR_BOOTSTRAP_DATABASE_URL` is the name to use.
 * - `MIGRATOR_DATABASE_URL` is a DEPRECATED alias, accepted only when the new name is absent. Setting
 *   both is an error (the same rule the wrapper applies), never a silent choice.
 * - Neither set is an error that names the new variable.
 *
 * Values are never included in a message.
 */
export class MigratorUrlConflictError extends Error {
  constructor() {
    super('MIGRATOR_DATABASE_URL (deprecated) and MIGRATOR_BOOTSTRAP_DATABASE_URL are both set; keep only MIGRATOR_BOOTSTRAP_DATABASE_URL.');
    this.name = 'MigratorUrlConflictError';
  }
}

export interface BootstrapUrlResolution {
  readonly url: string | undefined;
  /** True when the value came from the deprecated `MIGRATOR_DATABASE_URL`. */
  readonly viaDeprecatedAlias: boolean;
}

export function resolveBootstrapDatabaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): BootstrapUrlResolution {
  const current = env['MIGRATOR_BOOTSTRAP_DATABASE_URL'];
  const legacy = env['MIGRATOR_DATABASE_URL'];
  const hasCurrent = current !== undefined && current !== '';
  const hasLegacy = legacy !== undefined && legacy !== '';
  if (hasCurrent && hasLegacy) throw new MigratorUrlConflictError();
  if (hasCurrent) return { url: current, viaDeprecatedAlias: false };
  if (hasLegacy) return { url: legacy, viaDeprecatedAlias: true };
  return { url: undefined, viaDeprecatedAlias: false };
}

/** Required form of {@link resolveBootstrapDatabaseUrl}; warns once on stderr when the alias is used. */
let aliasWarned = false;
export function getBootstrapDatabaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const { url, viaDeprecatedAlias } = resolveBootstrapDatabaseUrl(env);
  if (url === undefined) throw new MissingEnvVarError('MIGRATOR_BOOTSTRAP_DATABASE_URL');
  if (viaDeprecatedAlias && !aliasWarned) {
    aliasWarned = true;
    console.warn('WARNING: MIGRATOR_DATABASE_URL is deprecated; set MIGRATOR_BOOTSTRAP_DATABASE_URL instead.');
  }
  return url;
}

/** Test hook: lets a spec observe the once-only warning more than once. */
export function resetBootstrapAliasWarning(): void {
  aliasWarned = false;
}
