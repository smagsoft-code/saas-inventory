/**
 * The environment `dev-server.ts` hands to each process it starts (B4.11.5.7 withheld one variable; B4.11.5.8 made it an allow-list per process; B4.11.5.10 extends the
 * same model to the PostgreSQL server that the `embedded-postgres` library starts on its own).
 *
 * PRINCIPLE: a child receives ONLY the variables that process needs. Nothing is inherited: neither `process.env` nor the parsed `.env` is ever passed whole; both are merged
 * only to look names up, and every name that is not on that child's list is dropped, known or unknown. A variable added to `.env` or to the shell reaches no child until it is
 * added HERE, to the list of the process that reads it, together with a test.
 *
 * WHERE THE LISTS COME FROM (static review, no `.env` opened, no process started): every `getRequiredEnvVar` / `getOptionalEnvVar` / `process.env` read reachable from each
 * process's entry point (apps/api/src, packages/config, the migration wrapper, bootstrap-dev-roles.ts, apps/web/next.config.ts and src/lib/api, the dev S3 shim). The evidence per
 * variable is in docs/security/secret-scanning.md. Variables the code never reads (REDIS_URL, PLATFORM_ADMIN_*) are on no list.
 *
 * `QA_ADMIN_PASSWORD` is on no list and a module-load check refuses a list that contains it: it is used by `dev-server.ts` itself to register the QA administrator.
 *
 * THE EMBEDDED POSTGRES SERVER is not started by us: `embedded-postgres` runs `initdb` and `postgres` with `{ ...process.env, LC_MESSAGES }` and offers no option to change that.
 * `withChildProcessEnv` therefore puts the 'postgres' profile (operating-system essentials only) in `process.env` for exactly the time those processes are launched, and puts the
 * original back afterwards. No file of the library is touched. `scrubParentOnlyVariables` additionally removes the parent-only variables from `process.env` once the parent has
 * read them, so nothing the parent starts later (for instance the library's `taskkill` on shutdown) can inherit them.
 *
 * Errors name variables, never values.
 */

/** The processes `dev-server.ts` starts itself, each through `childEnv('<name>')`. */
export type ChildProcessName = 'migrate' | 'bootstrap-roles' | 's3-shim' | 'api' | 'web';
export const CHILD_PROCESS_NAMES: readonly ChildProcessName[] = ['migrate', 'bootstrap-roles', 's3-shim', 'api', 'web'];
/** Environment profiles: the five above plus the PostgreSQL processes started by the `embedded-postgres` library (`initdb`, `postgres`). */
export type EnvProfile = ChildProcessName | 'postgres';

/** Variables that exist only for `dev-server.ts` (or other tools) and must never reach a child. Enforced when this module loads. */
export const PARENT_ONLY_VARIABLES: readonly string[] = ['QA_ADMIN_PASSWORD'];

interface ChildEnvSpec {
  /** Each must be present and non-empty, or building the environment fails naming the variable. */
  readonly required: readonly string[];
  /** Groups of which at least one name must be present (the deprecated alias of the migrator URL). */
  readonly requiredAnyOf: readonly (readonly string[])[];
  /** Passed when present; absence is not an error (the process has a default, or needs it only for a feature). */
  readonly optional: readonly string[];
  /** Which essentials every process of this profile needs just to start. */
  readonly baseline: readonly string[];
}

/**
 * Operating-system essentials: names without any application setting or credential. Windows: the shell and system locations (`COMSPEC`, `SYSTEMROOT`, `WINDIR`, …), the user
 * profile and temporary directories, processor facts. POSIX: `HOME`, `USER`, `TMPDIR`, locale and terminal. Not provable complete by reading code (an unusual machine may need
 * another one — add it here and say why). Deliberately absent: PG* (the `postgres` driver would let a stray PGPASSWORD/PGSSLMODE override a URL), npm/registry tokens, proxies, AWS_*.
 */
export const OS_BASELINE: readonly string[] = [
  // PATH and the shell
  'PATH', 'PATHEXT', 'COMSPEC', 'SHELL',
  // Windows core
  'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'OS', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_IDENTIFIER', 'PROCESSOR_LEVEL', 'PROCESSOR_REVISION', 'NUMBER_OF_PROCESSORS',
  'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'COMMONPROGRAMFILES', 'COMMONPROGRAMFILES(X86)', 'COMMONPROGRAMW6432', 'ALLUSERSPROFILE', 'PUBLIC',
  'USERNAME', 'USERDOMAIN', 'COMPUTERNAME',
  // home, temp, user profile
  'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'LOGNAME',
  // locale and terminal
  'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM', 'COLORTERM',
];
/** What the Node/pnpm-based children additionally need (location settings and colour switches; not credentials). The PostgreSQL profile does not get these. */
export const TOOLCHAIN_BASELINE: readonly string[] = ['FORCE_COLOR', 'NO_COLOR', 'NODE_OPTIONS', 'NODE_PATH', 'PNPM_HOME', 'COREPACK_HOME'];
export const SYSTEM_BASELINE: readonly string[] = [...OS_BASELINE, ...TOOLCHAIN_BASELINE];

const DB_BOOTSTRAP_URL = ['MIGRATOR_BOOTSTRAP_DATABASE_URL', 'MIGRATOR_DATABASE_URL'] as const;

export const CHILD_ENV_SPECS: Readonly<Record<ChildProcessName, ChildEnvSpec>> = {
  // `pnpm --filter @saas-inventory/api run db:migrate` -> src/database/migrate.ts -> migration-runner (config.ts reads exactly these seven names)
  migrate: {
    required: ['MIGRATOR_EXPECTED_DATABASE'],
    requiredAnyOf: [DB_BOOTSTRAP_URL],
    optional: ['MIGRATOR_INCREMENTAL_DATABASE_URL', 'MIGRATOR_INCREMENTAL_LOGIN', 'MIGRATOR_INCREMENTAL_PASSWORD', 'MIGRATOR_LOCK_TIMEOUT_SECONDS'],
    baseline: SYSTEM_BASELINE,
  },
  // `... run db:bootstrap-dev-roles` -> bootstrap-dev-roles.ts (the bootstrap URL + one password per role; the last two roles are optional in the script)
  'bootstrap-roles': {
    required: ['APP_TENANT_PASSWORD', 'APP_PLATFORM_PASSWORD', 'APP_PUBLIC_RESOLVER_PASSWORD'],
    requiredAnyOf: [DB_BOOTSTRAP_URL],
    optional: ['APP_EVENT_PROCESSOR_PASSWORD', 'APP_IMPORT_WORKER_PASSWORD'],
    baseline: SYSTEM_BASELINE,
  },
  // scratchpad/dev-s3-shim.mjs (local file, git-ignored): its single read is S3_ENDPOINT, only to take the port
  's3-shim': { required: [], requiredAnyOf: [], optional: ['S3_ENDPOINT'], baseline: SYSTEM_BASELINE },
  // `... api dev` -> nest start --watch -> src/main.ts + AppModule. NOT given: MIGRATOR_* (the superuser URL), APP_*_PASSWORD, the import-worker / event-processor
  // database URLs and their *_POLL/*_CLAIM/*_RETRY settings (those loops run in separate deployables, never inside this process), PLATFORM_ADMIN_*, QA_*, REDIS_URL.
  api: {
    // read when DatabaseModule / AuthModule build their providers at boot
    required: ['DATABASE_URL', 'APP_PLATFORM_DATABASE_URL', 'APP_PUBLIC_RESOLVER_DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'],
    requiredAnyOf: [],
    optional: [
      // object storage: read lazily on first use (uploads, imports, product images), so absence does not stop the boot
      'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY',
      // main.ts and auth
      'PORT', 'CORS_ORIGINS', 'NODE_ENV', 'COOKIE_DOMAIN', 'APP_URL',
      'ACCESS_TOKEN_TTL_SECONDS', 'REFRESH_TOKEN_TTL_SECONDS', 'SELECTION_TOKEN_TTL_SECONDS', 'INVITATION_TOKEN_TTL_SECONDS', 'SUPPORT_SESSION_TTL_SECONDS',
      'ARGON2_MEMORY_COST_KIB', 'ARGON2_TIME_COST', 'ARGON2_PARALLELISM', 'AUTH_RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_TTL_SECONDS',
      // QR public resolver and import (synchronous path)
      'QR_PUBLIC_RATE_LIMIT_MAX', 'QR_PUBLIC_RATE_LIMIT_TTL_SECONDS', 'IMPORT_BATCH_SIZE', 'IMPORT_MAX_FILE_SIZE_BYTES', 'IMPORT_MAX_ROWS', 'IMPORT_SYNC_ROW_THRESHOLD',
      // event delivery handlers are bound when EventProcessorModule is built (n8n-delivery.config.ts)
      'N8N_EVENTS_ENABLED', 'N8N_EVENTS_WEBHOOK_URL', 'N8N_EVENTS_AUTH_TOKEN', 'N8N_EVENTS_TIMEOUT_MS',
    ],
    baseline: SYSTEM_BASELINE,
  },
  // `... web dev` -> next dev: next.config.ts and src/lib/api read API_URL and NEXT_PUBLIC_API_URL only. NOT given: PORT (the API's), any secret.
  web: { required: [], requiredAnyOf: [], optional: ['API_URL', 'NEXT_PUBLIC_API_URL', 'NODE_ENV', 'NEXT_TELEMETRY_DISABLED'], baseline: SYSTEM_BASELINE },
};

/**
 * `initdb` and `postgres` as started by `embedded-postgres`. PostgreSQL reads no application setting from the environment here: every parameter (data directory, port, user,
 * authentication, the password file) is passed as an argument or a file, and the library adds `LC_MESSAGES` itself. So the profile is the operating-system essentials and nothing
 * else — in particular no PG* variable (initdb and the server would honour a stray PGPASSWORD / PGDATA / PGOPTIONS), no JWT/S3/database secret and no `QA_ADMIN_PASSWORD`.
 */
export const POSTGRES_PROFILE: ChildEnvSpec = { required: [], requiredAnyOf: [], optional: [], baseline: OS_BASELINE };

const specOf = (profile: EnvProfile): ChildEnvSpec => (profile === 'postgres' ? POSTGRES_PROFILE : CHILD_ENV_SPECS[profile]);
const upper = (name: string): string => name.toUpperCase();

// A list may never contain a parent-only variable, a wildcard, or a lower-case/empty name: checked once, when the module loads.
for (const [child, spec] of [...Object.entries(CHILD_ENV_SPECS), ['postgres', POSTGRES_PROFILE] as const]) {
  const names = [...spec.required, ...spec.requiredAnyOf.flat(), ...spec.optional];
  for (const name of names) {
    if (PARENT_ONLY_VARIABLES.some((p) => upper(p) === upper(name))) throw new Error(`child-env: "${child}" lists a parent-only variable (${name}).`);
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`child-env: "${child}" lists an invalid variable name (${name}).`);
  }
  for (const name of spec.baseline) {
    if (PARENT_ONLY_VARIABLES.some((p) => upper(p) === upper(name))) throw new Error(`child-env: the baseline of "${child}" lists a parent-only variable.`);
  }
}

export class ChildEnvError extends Error {
  readonly child: EnvProfile;
  readonly missing: readonly string[];
  constructor(child: EnvProfile, missing: readonly string[]) {
    super(`The "${child}" process needs ${missing.length === 1 ? 'a variable' : 'variables'} that ${missing.length === 1 ? 'is' : 'are'} not set: ${missing.join(', ')}.`);
    this.name = 'ChildEnvError';
    this.child = child;
    this.missing = missing;
  }
}

/** Every name this profile may receive (its baseline included), as listed — for documentation and tests. */
export function allowedNames(child: EnvProfile): readonly string[] {
  const spec = specOf(child);
  return [...new Set([...spec.baseline, ...spec.required, ...spec.requiredAnyOf.flat(), ...spec.optional])];
}

/**
 * Builds the environment of ONE child process.
 *
 * @param child     which profile (its list is the only source of allowed names)
 * @param available the merged environment to look names up in (`{ ...process.env, ...fileEnv }`); it is never passed on, only read
 * @param overrides values the caller sets explicitly; each name must be on the profile's list (an override cannot smuggle a variable in)
 * @returns a NEW object holding only allowed, present variables, with their values unchanged and their original letter case in the name
 * @throws ChildEnvError naming the missing required variables (never any value)
 */
export function buildChildEnv(child: EnvProfile, available: Readonly<Record<string, string | undefined>>, overrides: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const spec = specOf(child);
  const allowed = new Set(allowedNames(child).map(upper));
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(available)) {
    if (value === undefined || !allowed.has(upper(name))) continue;
    env[name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!allowed.has(upper(name))) throw new Error(`child-env: "${name}" is not on the "${child}" list; add it there explicitly.`);
    for (const existing of Object.keys(env)) if (upper(existing) === upper(name)) delete env[existing];
    env[name] = value;
  }
  const present = (name: string): boolean => Object.entries(env).some(([k, v]) => upper(k) === upper(name) && v !== undefined && v !== '');
  const missing = [...spec.required.filter((n) => !present(n))];
  for (const group of spec.requiredAnyOf) if (!group.some(present)) missing.push(group.length === 1 ? (group[0] as string) : `one of ${group.join(' / ')}`);
  if (missing.length > 0) throw new ChildEnvError(child, missing);
  return env;
}

/** The object whose `env` property the Node `child_process` module reads when a caller does not pass one (`process` itself; a stand-in in tests). */
export interface EnvHolder {
  env: NodeJS.ProcessEnv;
}

/**
 * Runs `work` while `holder.env` (by default `process.env`) is the environment built for `child`, then puts the ORIGINAL object back — also when `work` throws.
 * Needed because `embedded-postgres` starts `initdb` and `postgres` with `{ ...process.env }` and has no option for an environment. Anything launched, or any `process.env`
 * read, while `work` runs sees only the allowed variables. Do not run unrelated work inside it.
 */
export async function withChildProcessEnv<T>(child: EnvProfile, available: Readonly<Record<string, string | undefined>>, work: () => Promise<T>, holder: EnvHolder = process): Promise<T> {
  const original = holder.env;
  holder.env = buildChildEnv(child, available);
  try {
    return await work();
  } finally {
    holder.env = original;
  }
}

/** Removes every parent-only variable from `holder.env` (any letter case) and returns the NAMES that were removed. Call it once the parent has read what it needs. */
export function scrubParentOnlyVariables(holder: EnvHolder = process): string[] {
  const removed: string[] = [];
  const parentOnly = new Set(PARENT_ONLY_VARIABLES.map(upper));
  for (const name of Object.keys(holder.env)) {
    if (parentOnly.has(upper(name))) {
      delete holder.env[name];
      removed.push(name);
    }
  }
  return removed;
}
