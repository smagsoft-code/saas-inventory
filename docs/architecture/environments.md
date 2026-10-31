# Environments

Status: local development and testing are implemented (D-8E.24). Staging and production are **contemplated, not configured**.

| Environment | Database | Data lifetime | Who may delete it | Credentials | Status |
|---|---|---|---|---|---|
| **Development** (local) | Persistent embedded PostgreSQL, `saas_inventory_dev` | Persistent: survives restarts and tool runs | Only the developer, deliberately, after a backup | Local `.env` (git-ignored); QA admin password from `QA_ADMIN_PASSWORD` | Implemented |
| **Testing** (local and CI) | Disposable: embedded server (`saas_inventory_verify`) locally, a fresh `postgres:16.15` container per CI job | Rebuilt on every run | Every `verify` run; `test:db:reset` | Throwaway values generated or fixed inside the harness; none is a real credential | Implemented |
| **Staging** | A separate managed PostgreSQL | Persistent, restorable | Operators, by procedure | A secrets store; never `.env` files in Git | Not configured |
| **Production** | A separate managed PostgreSQL with backups and restore tests | Persistent, backed up | Nobody by script; changes through migrations | A secrets store; distinct from every other environment | Not configured (FASE 21) |

## Rules

1. **No script of the testing side may reach the development data.** The disposable target is checked, not assumed, before anything is created
   or deleted (`tools/pg-verify/env-guard.ts`): protected ports, database name pattern, directory name, overlap with the development
   directory and a `.persistent` marker.
2. **No script deletes the development data.** `dev-server.ts` creates the data directory only when it is missing or empty and removes nothing,
   including after a failed start. A half-initialised or unmarked directory is refused until `dev --finish-init` / `dev --adopt` verifies it
   (markers `<dir>.initializing` / `<dir>.initialized` live next to the directory, not inside it).
3. **Seeds are explicit and per environment.** The QA seed runs only when you run it, through the real API, and only logs in.
4. **Credentials are never in the repository.** The QA password is required from the environment; there is no default and it is never printed.
   Rotating an existing account needs a supported mechanism (an authenticated change-password endpoint, or a reviewed one-off administrative
   script); neither exists yet. Recreating the account would destroy its data.
5. **Migrations run through the integrity wrapper** ([migration-integrity.md](migration-integrity.md)) against the database of the environment
   being worked on, selected by `MIGRATOR_EXPECTED_DATABASE`.
6. **CI uses only temporary databases.** It never connects to a developer's database.
7. Staging and production will use their own databases, secrets and backups; they share nothing with development or testing, and the
   `MIGRATOR_*` identities are distinct per environment.

How to start, stop, rebuild and recover each local environment: [tools/pg-verify/README.md](../../tools/pg-verify/README.md).
