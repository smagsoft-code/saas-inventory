# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
follows [Semantic Versioning](https://semver.org/) once a first version is released.

## [Unreleased]

### Added

- Migration integrity (ADR-0041, Proposed — delivery 2b, D-7.2): `db:migrate` runs through a wrapper (`apps/api/src/database/migration-runner/`) that
  validates configuration, files, PostgreSQL identity and the Drizzle registry before Drizzle runs and refuses inconsistent states without repairing
  them; bootstrap and incremental modes, `--provision-only`, a bootstrap procedure for the limited login with narrowed `drizzle` grants, a checked
  RLS-window helper for new data migrations; history manifest version 2 with an explicit `classification` and `reviewedIn` per migration;
  `.gitattributes` pinning `database/migrations/**` to LF; a harness on disposable PostgreSQL 16.15 clusters (`test:migration-harness`,
  `PG_VERIFY_PG_BIN`). Known residual risk: the SQL text scan is incomplete (`MIG-SQL-RLS-LINTER`).
- Migration integrity (ADR-0041, Proposed — delivery 2a): pure, unit-tested checks of the Drizzle journal, the registry-versus-journal
  state, the execution mode and the migrator identity (`apps/api/src/database/migration-integrity/`); reviewed manifests
  `database/migrations/history-manifest.json` (every migration) and `database/migrations/privileged-manifest.json` (`0000`, `0019`);
  a manifest check/append CLI; `docs/architecture/migration-integrity.md`. Not yet used by `db:migrate`.
- Migration integrity (D-7.1): `history-manifest.cli.ts --write` now refuses, before writing anything, a new migration whose privileged
  classification is unresolved (`planManifestAppend`); in bootstrap mode the effective `app_migrator` must still be subject to RLS when
  `0000` is not pending. Hash behaviour verified offline and documented.
- Drizzle snapshot `database/migrations/meta/0050_snapshot.json`, so `db:generate` no longer proposes a duplicate `approval_number`
  column.
- Project foundation: monorepo scaffolding (pnpm + Turborepo + TypeScript), shared packages,
  linting/formatting/testing infrastructure, governance docs (CLAUDE.md, SECURITY.md,
  CONTRIBUTING.md), Docker Compose scaffolding, and CI pipeline skeleton.

### Changed

- Migration CI (D-8E): `.github/workflows/ci.yml` gained `migration-harness` and `pg-verify` jobs on `postgres:16.15@sha256:...` (loopback-only container, per-run masked password, `server_version_num = 160015` verified on the running server, cleanup `if: always()`). The harness (`MIGRATION_HARNESS_SERVER_URL`) and `pg-verify` (`PG_VERIFY_SERVER_URL`) can attach to such a server, refusing anything not fresh, not loopback or on a protected port; `.exe` is no longer hard-coded. **Fix:** the wrapper validates the SQL-lint exceptions whenever any is loaded, so an obsolete exception is refused even with zero pending migrations or under `--provision-only`. Not yet observed on a real GitHub Actions runner.
- SQL/RLS linter, closing step (D-8D.1): `database/migrations/sql-lint-exceptions.json` (schema v1, **empty**) is loaded and strictly validated by the wrapper before Drizzle — an exception names one rule, migration, line and file hash, with a reason and a review; any defect, or an exception that
  matches nothing, refuses the run, and an accepted finding stays visible in the report; `LINT-PARSE-ERROR` and `TXN-CONTROL` cannot be excepted. A parser that cannot load refuses the run (`SQL_LINT_PARSER_UNAVAILABLE`) before Drizzle (now tested). PL/pgSQL the parser cannot read:
  ERROR in an ordinary migration, WARNING in a privileged one, reported as not confirmed by the syntax tree. `sql-lint.cli.ts` applies the exceptions (`--no-exceptions` shows everything).
- `db:migrate` now lints the SQL of the pending migrations before Drizzle runs (D-8D): a PostgreSQL 16 grammar parser (`libpg-query@16.8.1`, WebAssembly, new pinned dependency) feeds 45 rules for privileges, roles, ownership, RLS,
  triggers, SECURITY DEFINER, server access and transaction control. An ERROR (for example `GRANT … TO PUBLIC`, `DISABLE ROW LEVEL SECURITY`, an ownership change, PL/pgSQL it cannot read in an ordinary migration) refuses the whole batch
  with the file, line and rule, and applies nothing. The 51 existing migrations produce 0 errors (181 warnings, reported, never called safe). `sql-lint.cli.ts` runs it standalone (exit 0 / 1 / 2). Not covered: PL/pgSQL bodies, dynamic SQL,
  `drizzle-kit migrate`/`push`.
- `db:migrate` runs now exclude each other per database (D-8C): a session-level PostgreSQL advisory lock is held from the identity/history evaluation through the batch, the final checks and the provisioning step. A second run waits
  (`MIGRATOR_LOCK_TIMEOUT_SECONDS`, default 60, 0 = fail at once) and then evaluates the state left by the first, or stops with `LOCK_NOT_ACQUIRED` having changed nothing. It does not cover `drizzle-kit migrate`/`push`, a
  hand-written `migrate()` or the test globalSetup.
- `db:migrate` now checks owner and RLS invariants of the state each batch leaves (D-8B): inside Drizzle's own transaction, right before the commit — a violation rolls the whole batch back — and once more after it
  (reporting only; a committed change is not undone). Refused: an object of `public` not owned by `app_migrator`, a table with RLS enabled but not FORCEd, RLS that was enabled and is now disabled, the history owned by `app_migrator`,
  a registry that is not the journal. Only violations the run introduces block; pre-existing ones are warned about. A `DISABLE ROW LEVEL SECURITY` that used to pass is now refused; `GRANT` and the rest still pass until the linter exists.
- **Breaking for local setups:** `pnpm --filter @saas-inventory/api db:migrate` requires `MIGRATOR_EXPECTED_DATABASE`. Every migrator consumer (wrapper, `bootstrap-dev-roles`, seeds,
  `reset-demo`, `drizzle.config.ts`, `tools/pg-verify`) now reads `MIGRATOR_BOOTSTRAP_DATABASE_URL` through one rule (`@saas-inventory/config`); `.env.example` and
  `docker-compose.dev.yml` carry it. `MIGRATOR_DATABASE_URL` remains a deprecated **bootstrap-only** alias (with a warning): it works for a new database, `--provision-only`,
  and a privileged migration on an adopted database, but it can NOT apply ordinary migrations to an existing database — that needs the incremental login. Setting both is an error.
- `db:migrate` validates its arguments first: an unknown option or a typo (`--provision-onyl`) exits 1 before anything is read or connected; write options without `--`.
- `--provision-only` checks its preconditions explicitly (`PROVISION_PRECONDITION_FAILED`); the missing-`CREATE`-on-database diagnostic now explains `TEMPLATE` databases and the
  adoption path, and bootstrap mode on a never-provisioned existing database is refused up front instead of failing inside Drizzle.
- `history-manifest.cli.ts --write` needs `--classify <tag>=ordinary|privileged --reviewed-in <ref>` for every new migration and writes nothing on any refusal.
- `apps/api/src/database/schema/09-sales.ts`: the unique constraint `price_approvals_tenant_approval_number_key (tenant_id,
  approval_number)`, created by migration `0050`, is now modelled in the TypeScript schema (and in the snapshot). No SQL, journal or
  migration changed.
