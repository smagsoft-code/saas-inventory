import { MIGRATE_USAGE, parseMigrateArgs } from './migration-integrity/cli-args';
import { formatDiagnostics } from './migration-integrity/execution-guard';
import { runMigrations } from './migration-runner/run-migrations';

/**
 * Applies every pending migration in database/migrations/, in order, as the app_migrator role —
 * never as the application's own app_tenant connection (database.md#migration-strategy) — through the
 * integrity wrapper of ADR-0041 (`migration-runner/run-migrations.ts`): the arguments, the configuration,
 * the files (journal, history manifest with explicit classification, privileged manifest), the PostgreSQL
 * identity and the state of Drizzle's registry are all checked BEFORE Drizzle runs, and an inconsistent
 * state is refused, never repaired.
 *
 *   pnpm --filter @saas-inventory/api db:migrate                                   # mode inferred when exactly one login is configured
 *   pnpm --filter @saas-inventory/api db:migrate --mode bootstrap                  # privileged login: a new database, or a privileged migration pending
 *   pnpm --filter @saas-inventory/api db:migrate --mode incremental                # limited login: ordinary migrations only
 *   pnpm --filter @saas-inventory/api db:migrate --mode bootstrap --provision-only # existing database: create the incremental login, apply nothing
 *
 * Write the options WITHOUT a `--` separator. pnpm 9 forwards a literal `--` to the script; one leading `--`
 * is tolerated, but the documented form has none. An unknown option, a positional argument, a repeated or
 * valueless option, or `--provision-only` with `--mode incremental` is refused before the configuration is
 * read and before any connection is opened (a mistyped flag must never run a full migration).
 *
 * Environment (docs/architecture/migration-integrity.md §9): MIGRATOR_EXPECTED_DATABASE (always);
 * MIGRATOR_BOOTSTRAP_DATABASE_URL for bootstrap (the deprecated alias MIGRATOR_DATABASE_URL is bootstrap-only);
 * MIGRATOR_INCREMENTAL_DATABASE_URL + MIGRATOR_INCREMENTAL_LOGIN for incremental;
 * MIGRATOR_INCREMENTAL_LOGIN + MIGRATOR_INCREMENTAL_PASSWORD in bootstrap mode to create that login.
 *
 * One physical connection (`max: 1`) is deliberate: migration 0000 issues `SET ROLE app_migrator`
 * (session-scoped), and with a pool a later migration could be dispatched over a connection that
 * never ran it, silently reverting to the login's own ownership.
 */
const parsed = parseMigrateArgs(process.argv.slice(2));

if (parsed.args === null) {
  console.error(`Invalid arguments; nothing was read and nothing was connected.\n${formatDiagnostics(parsed.diagnostics)}\n${MIGRATE_USAGE}`);
  process.exitCode = 1;
} else {
  runMigrations({ env: process.env, requestedMode: parsed.args.mode, provisionOnly: parsed.args.provisionOnly })
    .then((result) => {
      process.exitCode = result.exitCode;
    })
    .catch((error: unknown) => {
      // Never print the error object itself: a driver error can carry connection details.
      console.error(`Migration failed unexpectedly (${error instanceof Error ? error.name : 'unknown error'}).`);
      process.exitCode = 1;
    });
}
