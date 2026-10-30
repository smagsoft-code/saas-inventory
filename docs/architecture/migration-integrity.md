# Migration integrity — contracts, manifests and abort conditions

> **Status: deliveries 2a and 2b of [ADR-0041](../decisions/0041-migration-identity-and-history-integrity.md) (still Proposed).**
> The pure checks (2a) and the wrapper that uses them (2b, D-7.2) exist: `db:migrate` now runs through
> `apps/api/src/database/migration-runner/run-migrations.ts`, which validates configuration, files, PostgreSQL identity and the
> Drizzle registry **before** Drizzle runs. It has been exercised **only** on disposable PostgreSQL 16.15 clusters created for the
> tests (§10); no existing database was touched and no production database exists. Not delivered: the SQL/RLS linter
> (§12), a CI path with a pinned Docker image, and any validation against a historical database (E1-B1 stays inconclusive).

## 1. Purpose

`drizzle-orm`'s `migrate()` trusts the journal and reads one registry row (the highest `created_at`). It never compares the hash of an
applied migration, never checks that the registry is a prefix of the journal, and silently skips a journal entry whose `when` is at
or below that value (verified against `drizzle-orm@0.45.2`, `pg-core/dialect.js`; observed on PostgreSQL 16.15 in synthetic runs).
`migration-integrity/` adds what Drizzle does not provide, **before Drizzle is invoked**, and only ever aborts — it never repairs or
rewrites a journal, a registry row, a file or a manifest.

## 2. What exists (deliveries 2a and 2b)

| Path | Role | Touches |
| --- | --- | --- |
| `apps/api/src/database/migration-integrity/types.ts` | Facts, `Diagnostic`, the closed list of diagnostic codes | nothing |
| `…/hash.ts` | Raw hash (what Drizzle registers), canonical hash (manifests), registry hash candidates | nothing |
| `…/journal-validator.ts` | `parseJournal`, `validateJournal` | nothing |
| `…/history-manifest.ts` | Parse / build / validate / append the history manifest | nothing |
| `…/privileged-manifest.ts` | Parse / validate the privileged manifest; undeclared-privileged-statement safety net | nothing |
| `…/history-classifier.ts` | `classifyHistory`: registry vs journal → `NEW` / `CONSISTENT` / `INCONSISTENT` | nothing |
| `…/execution-guard.ts` | `evaluateIdentity`, `assessExecution`: the go/no-go decision | nothing |
| `…/migration-files.ts` | Reads `database/migrations/` (journal, `.sql`, manifests) | files, read-only |
| `…/history-manifest.cli.ts` | `--check` (default) and `--write` for the history manifest | files; `--write` appends to one JSON |
| `…/config.ts` | `resolveMigratorConfig`: mode and environment variables → configuration or diagnostics, secrets never echoed | nothing |
| `…/manifest-update.ts` | `planManifestAppend`, `parseDecisionArgs`: everything the generator may write, planned and validated first | nothing |
| `apps/api/src/database/migration-runner/db-facts.ts` | Read-only queries: identity facts, registry, table count; `SET ROLE app_migrator` | PostgreSQL (SELECT, SET ROLE) |
| `…/migration-runner/provision.ts` | Bootstrap procedure for the incremental login and the narrowed Drizzle grants | PostgreSQL (DDL), bootstrap mode only |
| `…/migration-runner/rls-window.ts` | Checked `NO FORCE` / `FORCE` window for NEW data migrations (not applied to existing ones) | PostgreSQL |
| `…/migration-integrity/sql-lint/` (+ `sql-lint.cli.ts`) | The SQL/RLS linter over the PostgreSQL 16 grammar: parser adapter, rules, engine, exceptions and their file, report (§6e) | files only |
| `database/migrations/sql-lint-exceptions.json` | Reviewed lint exceptions; schema version 1; **empty** | data |
| `…/migration-runner/run-migrations.ts` | The wrapper (§6b) | PostgreSQL |
| `apps/api/src/database/migrate.ts` | Thin entry point (`--mode`, `--provision-only`) | — |
| `apps/api/test/migration-harness/`, `vitest.migration-harness.config.ts` | Disposable-cluster harness (§10) | its own cluster only |
| `…/fixtures.ts`, `*.spec.ts` | Synthetic data and unit specs (9 files, 188 tests in `migration-integrity/`) | nothing |
| `database/migrations/history-manifest.json` | Version 2: one entry per migration with `idx`, `tag`, `when`, `sha256`, `classification`, `reviewedIn` (51 entries) | data |
| `.gitattributes` | `database/migrations/** text eol=lf` | git |
| `database/migrations/privileged-manifest.json` | Privileged migrations (`0000`, `0019`) with hash and reason | data |

No SQL file, journal or snapshot was edited or regenerated to match a manifest; the manifests describe the real files. Adding
`.gitattributes` changed no existing file: all 100 tracked files under `database/migrations/` were already LF in the index and in the
working tree (`git ls-files --eol`). Git history is not rewritten.

## 3. Hashes and line endings

- **`hashMigrationSql`** — SHA-256 (hex) of the file text exactly as read: what Drizzle stores in `drizzle.__drizzle_migrations.hash`.
  It depends on the line endings.
- **`canonicalMigrationHash`** — the same over the text with CRLF turned into LF. The manifests hold this value.
- **`registryHashCandidates`** — raw, LF and CRLF hashes of the current content. The registry is compared against this set.

Why: until D-7.2 the repository had **no `.gitattributes`**, and a clone with `core.autocrlf=true` (the Windows default) writes CRLF files, which
changes the raw hash without changing the migration. With canonical manifest hashes and candidate matching, a file that differs only in
line endings still matches; any change of content does not. A residual effect that candidate matching does *not* neutralise: a CRLF checkout feeds
Drizzle different text (for example newlines inside a dollar-quoted function body). D-7.2 therefore adds `database/migrations/** text eol=lf`
to `.gitattributes` (owner decision): new checkouts on any OS are byte-identical. It rewrites no history and changed no existing file here. It
does not make the canonical hash or the candidate set unnecessary: a database may have been migrated from a checkout made before it, and files
can still be copied around outside git. Not yet verified on a Linux checkout (only the Windows working tree and the index were inspected).

**What was verified (D-7.1, offline, against `drizzle-orm@0.45.2` only; re-verify on any Drizzle upgrade).** Drizzle's
`readMigrationFiles` does `fs.readFileSync(file).toString()` and hashes that *decoded string* (UTF-8) with SHA-256. Run against copies
of the 51 real files (all LF, no BOM, no CR, no U+FFFD; 23 have no final newline):

| Variant of the files | `canonical == Drizzle hash` | Drizzle hash ∈ candidates | canonical hash changes |
|---|---|---|---|
| as in the repository (LF) | 51 / 51 | 51 / 51 | no |
| every file CRLF | 1 / 51 (only `0030_…`, a one-line file without line break) | 51 / 51 | no |
| BOM added to one file | 51 / 51 | 51 / 51 | **yes** (detected) |
| final newline removed or added | 51 / 51 | 51 / 51 | **yes** (detected) |
| trailing space added | 51 / 51 | 51 / 51 | **yes** (detected) |
| a lone `\r` | 51 / 51 | 51 / 51 | **yes** (detected) |
| one file with mixed `\r\n` / `\n` | 50 / 51 | 51 / 51 | no (accepted as a line-ending-only change) |

Consequences: (1) the *manifest* hash equals what Drizzle registers **only for LF files**; for CRLF files it does not, which is why the
registry is compared against the candidate set and not against the manifest value. (2) BOM, final newline and whitespace changes are
content changes and are detected. (3) A line-ending-only change is accepted by design, including a mixed one; if the file was registered
mixed and is later checked out all-CRLF, no candidate matches and the run aborts (fails closed). (4) **Not injective on invalid UTF-8:**
Drizzle hashes the decoded string, so two files that differ only in bytes that are not valid UTF-8 (both decode to U+FFFD) get the same
hash — shown with two synthetic buffers; none of the 51 real files has one. Neither the manifest nor the registry can see such a change.
(5) Normalising CRLF→LF can also hide a change *inside* a multi-line string literal, which is semantic; it is not distinguishable by
hash. Pending evidence: no migration is known to depend on that today (not audited statement by statement).
`.gitattributes` with `eol=lf` (now added) makes a checkout byte-identical on every machine (removing (5) for new checkouts and the
CRLF-vs-registry mismatch), but it would not protect against edits, non-UTF-8 bytes, already-applied history, or anything outside git.

## 4. The manifests

### `history-manifest.json`

```json
{ "manifestVersion": 2, "hashAlgorithm": "sha256", "hashInput": "…", "entries": [ { "idx": 0, "tag": "0000_…", "when": 1788…, "sha256": "…64 hex…", "classification": "privileged", "reviewedIn": "retroactive-review:D-7.2:2026-10-28" } ] }
```

- It is the reviewed, version-controlled reference for **every** migration. Comparing the registry only to the files catches a file edited
  after it was applied, but not a coordinated rewrite of file and registry; this manifest is the third, independent record.
- **Explicit classification (D-7.2, decision H2).** Every entry carries `classification` (`ordinary` | `privileged`) and `reviewedIn`.
  Missing or invalid → `CLASSIFICATION_MISSING`; `reviewedIn` absent or blank → `REVIEW_EVIDENCE_MISSING`; not one of `commit:<sha>`,
  `pr:<n>`, `review:<id>:<YYYY-MM-DD>`, `retroactive-review:<id>:<YYYY-MM-DD>` → `REVIEW_EVIDENCE_INVALID`; `privileged` without a
  declaration in the privileged manifest, or a declaration on an `ordinary` entry → `CLASSIFICATION_MISMATCH`. Only the **format** of
  `reviewedIn` is checked: that the commit or PR exists, and says what it should, is for the reviewer. The 51 existing entries carry
  `retroactive-review:D-7.2:2026-10-28`: the classification was made in that phase by reading the SQL, and **no historic approval is
  claimed**. Version 1 manifests are rejected. The privileged manifest remains the declaration that drives the mode; the classification
  must agree with it, never replace it.
- A journal entry the manifest does not list **aborts** the run (`MANIFEST_ENTRY_MISSING`): a new migration must be recorded and reviewed.
  A manifest entry the journal lacks, or any difference in `idx`, `when` or hash, also aborts.
- **Updating it when a migration is added**
  1. Create the migration (`pnpm --filter @saas-inventory/api db:generate`, or `--custom`) — journal and `.sql` appear.
  2. Classify it **first**: if it needs the privileged bootstrap, declare it in `privileged-manifest.json` by hand (see the lifecycle below).
  3. `pnpm --filter @saas-inventory/api exec tsx src/database/migration-integrity/history-manifest.cli.ts --write --classify <tag>=ordinary|privileged --reviewed-in <ref>`
     appends the new entries with the decision you give (never a default). It **only appends**: if an already-recorded migration differs from its file or the journal it refuses
     (exit 1, nothing written), because that is an applied migration changing and must be investigated, not regenerated. It also refuses
     (exit 1, nothing written) a new migration without a decision, with a malformed reference, a decision for an already-recorded
     migration, a classification that disagrees with the privileged manifest, or an `ordinary` migration containing a privileged
     statement. The whole manifest that would be written is validated before the file is touched.
  4. Review the diff of `history-manifest.json` in the same commit as the migration.
  5. `… history-manifest.cli.ts` (no flag) or `--check` re-validates everything and exits 1 on any finding; the repository spec
     `migration-files.repo.spec.ts` runs the same checks in the unit suite.
- Before D-7.1, `--write` appended the entry and only then reported `PRIVILEGED_STATEMENT_UNDECLARED`, leaving the manifest changed after
  an error. It now decides first (`planManifestAppend`, `manifest-update.ts`) and writes nothing when the classification is unresolved.

**Lifecycle of a new migration — recording a hash is not approving it**

| Stage | Where it is visible | Who decides |
|---|---|---|
| 1. Detected | journal entry with no history-manifest entry (`MANIFEST_ENTRY_MISSING`, run aborts) | — |
| 2. Hash computed | `--write` calculates it; nothing is written yet | tool |
| 3. Privileged classification | `findUndeclaredPrivileged` over the text; a hit blocks stage 4 until the author declares it by hand | author, then reviewer |
| 4. Recorded | entry appended with its `classification` and `reviewedIn` | tool, from the author's decision |
| 5. Authorised to run | the review that `reviewedIn` points at (existence not machine-checked), both manifests and (later) the linter | reviewer / owner |

Stage 5 is now represented (an entry without a valid classification and reference blocks the run), but it records **who decided what**, not that
the SQL is safe. See §12 for what the text scan does not see.

### `privileged-manifest.json`

- Migrations that need more than the incremental login can do. **`0000_extensions_and_roles` and `0019_import_worker_role` are always
  listed** (`PRIVILEGED_MANIFEST_REQUIRED_MISSING` otherwise). Each entry has `tag`, `sha256` and a mandatory `reason`.
- Edited **by hand** and reviewed; the generator never writes it.
- Safety net: any migration whose SQL (comments stripped) contains `CREATE ROLE`, `ALTER ROLE`, `DROP ROLE`, `CREATE EXTENSION`,
  `RESET ROLE`, `SET [LOCAL|SESSION] ROLE` or `SET SESSION AUTHORIZATION` but is not listed is reported
  (`PRIVILEGED_STATEMENT_UNDECLARED`). It is a text heuristic, not a parser (a match inside a string literal is a false positive that a
  human resolves). The migration linter of a later delivery supersedes it.

## 5. Contract of the checks

All functions are pure over in-memory facts and return `Diagnostic[]` (`{ code, message, migration?, details? }`); messages never contain
credentials, connection strings or row data. `assessExecution` returns `{ allowed, requestedMode, requiredMode, classification,
diagnostics }`; `allowed` is true **only** when `diagnostics` is empty. Bad input is a diagnostic, never an exception.

Inputs the wrapper gathers read-only (`db-facts.ts`): the journal and files (via `readMigrationsFolder`), the registry rows in insertion order
(`id` ascending; `created_at` through `parseCreatedAt`, because the column is a bigint and `postgres.js` returns a string), the number
of tables in schema `public`, and the identity facts of §7.

### Abort conditions (diagnostic codes)

| Code | Aborts when |
| --- | --- |
| `JOURNAL_MALFORMED`, `JOURNAL_EMPTY` | the journal is not parseable / has no entries |
| `JOURNAL_IDX_NOT_CONTIGUOUS`, `JOURNAL_IDX_DUPLICATE` | `idx` is not `0..n-1` in order / repeated |
| `JOURNAL_TAG_DUPLICATE`, `JOURNAL_TAG_INDEX_MISMATCH` | a tag repeats / its `NNNN_` prefix is not its index |
| `JOURNAL_WHEN_INVALID`, `JOURNAL_WHEN_NOT_INCREASING` | `when` unusable / not strictly greater than the previous entry's (Drizzle would skip it) |
| `SQL_FILE_MISSING` | an entry has no `.sql` file |
| `MANIFEST_MALFORMED`, `MANIFEST_ENTRY_MISSING`, `MANIFEST_ENTRY_EXTRA`, `MANIFEST_FIELD_MISMATCH`, `MANIFEST_HASH_MISMATCH` | the history manifest is invalid / lacks a journal entry / lists one the journal lacks / `idx` or `when` differ / the file's canonical hash differs |
| `PRIVILEGED_MANIFEST_MALFORMED`, `…_DUPLICATE`, `…_REQUIRED_MISSING`, `…_TAG_UNKNOWN`, `…_HASH_MISMATCH` | the privileged manifest is invalid / repeats a tag / omits `0000` or `0019` / lists an unknown tag / disagrees with the file |
| `PRIVILEGED_STATEMENT_UNDECLARED` | a migration has a privileged statement but is not declared |
| `CLASSIFICATION_MISSING`, `CLASSIFICATION_MISMATCH`, `REVIEW_EVIDENCE_MISSING`, `REVIEW_EVIDENCE_INVALID` | see the history manifest above |
| `REGISTRY_MISSING_WITH_TABLES`, `REGISTRY_EMPTY_WITH_TABLES`, `REGISTRY_WITHOUT_TABLES` | the registry is absent/empty but tables exist, or has rows but `public` has no tables |
| `REGISTRY_ROW_INVALID`, `REGISTRY_ROW_WITHOUT_JOURNAL_ENTRY` | a row has an unusable `created_at` / the registry is longer than the journal |
| `HISTORY_NOT_PREFIX`, `HISTORY_MISSING_APPLIED_MIGRATION`, `HISTORY_HASH_MISMATCH` | row `i` is not journal entry `i` / a migration that should be recorded is absent while later ones are / the recorded hash matches no variant of the current file |
| `PENDING_WHEN_AT_OR_BELOW_MAX_APPLIED` | a pending entry has `when` ≤ the highest applied `created_at` (silently skipped by Drizzle; also how a forged high `created_at` shows) |
| `PRIVILEGED_MIGRATION_MISSING_FROM_HISTORY` | a privileged migration is unrecorded although later ones are applied |
| `MODE_NEW_DATABASE_REQUIRES_BOOTSTRAP`, `MODE_BOOTSTRAP_NOT_REQUIRED`, `PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE` | requested mode ≠ the mode the state requires |
| `CONFIG_DATABASE_MISMATCH`, `CONFIG_LOGINS_NOT_SEPARATED` | connected database ≠ expected / bootstrap and incremental logins are the same account |
| `SQL_LINT_ERROR`, `SQL_LINT_PARSER_UNAVAILABLE`, `LINT_EXCEPTION_INVALID` | a pending migration has an open lint ERROR (the diagnostic names file, line and rule) / the SQL parser could not be loaded or crashed / the exceptions file is malformed, or an exception is stale, not exceptable or matches no finding (§6e) |
| `LOCK_NOT_ACQUIRED`, `CONFIG_LOCK_TIMEOUT_INVALID` | another run holds the migration lock of this database and the wait expired / `MIGRATOR_LOCK_TIMEOUT_SECONDS` is not a whole number from 0 to 3600 (§6d) |
| `INVARIANT_OWNER_MISMATCH`, `INVARIANT_RLS_NOT_FORCED`, `INVARIANT_RLS_DISABLED`, `INVARIANT_DRIZZLE_OWNER` | the batch left an object of `public` with another owner / a table with RLS enabled but not FORCEd / RLS that was enabled and is now disabled / the history owned by `app_migrator` (§6c) |
| `INVARIANT_REGISTRY_MISMATCH`, `INVARIANT_IDENTITY_UNEXPECTED` | at the end of the batch the registry is not the journal, or `current_user` is not `app_migrator` |
| `INVARIANT_GUARD_NOT_INVOKED`, `INVARIANT_CHECK_FAILED` | the pre-commit hook never ran (reported after the commit) / the check itself could not run (treated as a violation) |
| `CLI_ARGUMENT_INVALID` | an unknown option, a positional argument, a repeated or valueless option, or `--provision-only` with `--mode incremental`; raised **before the configuration is read** |
| `PROVISION_PRECONDITION_FAILED` | `--provision-only` on a database that is not eligible (state `NEW`, or no `app_migrator`); nothing is granted |
| `CONFIG_MODE_INVALID`, `CONFIG_MODE_AMBIGUOUS`, `CONFIG_VARIABLE_MISSING`, `CONFIG_VARIABLE_CONFLICT`, `CONFIG_URL_INVALID`, `CONFIG_DATABASE_URL_MISMATCH`, `CONFIG_LOGIN_INVALID`, `CONFIG_LOGIN_URL_MISMATCH`, `CONFIG_PASSWORD_INVALID` | the environment is unusable or ambiguous (§9); raised **before connecting** |
| `FACTS_UNAVAILABLE`, `REGISTRY_UNREADABLE`, `POSTCHECK_FAILED` | the identity or registry could not be read (also PostgreSQL < 16) / the run failed, or the final state is not the journal |
| `IDENTITY_*` | see §7 |

The registry must be an **exact prefix** of the journal: row `i` has the `when` of entry `i` and a hash that matches the entry's file.
Classification never relies on the number of rows.

## 6. Mode decision

| State | Pending | Required mode |
| --- | --- | --- |
| `NEW` (no registry rows, no tables) | everything | bootstrap |
| `CONSISTENT` | at least one privileged migration | bootstrap |
| `CONSISTENT` | only ordinary migrations | incremental |
| `CONSISTENT` | nothing | none (the mode check is skipped; identity is still checked) |
| `INCONSISTENT` | — | none: abort |

## 6b. The wrapper (`migration-runner/run-migrations.ts`)

Order. Drizzle runs at step 7 and only if every earlier step passed; a refusal at any step has executed nothing and repaired nothing.

1. **Configuration** (`config.ts`): mode and variables resolved without connecting; ambiguity is an error (§9). (The migration lock of §6d is taken after step 4 and held to the end.)
2. **Files**: journal, history manifest (hashes, classification, review evidence), privileged manifest, undeclared privileged statements.
   Done **before connecting** (the D-7.2 brief listed identity first; a broken reference needs no database to be refused, and this way a refusal
   cannot even open a connection).
3. **Connect** with the one login of the chosen mode, a single physical connection (`SET ROLE` is per session).
4. **Identity facts**: database, `session_user`, `current_user`, role attributes, `SET` membership, `CREATE` on the database. A wrong database
   stops here, before anything else is read.
5. **Role**: incremental → `SET ROLE app_migrator` when the membership allows it; bootstrap → the same, but only when migration `0000` is not
   pending (`0000` creates the role and issues its own `SET ROLE`). `current_user` is read again.
6. **History**: registry and table count, then `assessExecution` (registry an exact prefix of the journal, mode required by what is pending, identity).
7. **Apply** with Drizzle's own `migrate()`: the whole pending batch — privileged migrations included — in **one transaction** on that connection.
8. **Verify**: the registry equals the journal; after any applied migration `current_user` is `app_migrator`. Bootstrap with the incremental login
   configured then runs `provision.ts` in a **second** transaction (it needs the objects the migrations created and a different role).

Transactions. A failing migration rolls the whole batch back, registry row included (tested: two new migrations, the second fails, neither
table exists and the registry is unchanged, twice in a row). Provisioning cannot share that transaction; if it fails, the migrations stay applied
and the run exits 1 saying so. `--provision-only` (bootstrap mode, history consistent) lets an **existing** database adopt the incremental login
without applying anything, because bootstrap refuses ordinary-only work (`MODE_BOOTSTRAP_NOT_REQUIRED`) and incremental cannot start before the
login exists.

`RESET ROLE`. The wrapper never relies on it as a way up. Migration `0019` contains one; it is only reachable in bootstrap mode, whose session user
is a verified superuser, and the wrapper checks that `current_user` is `app_migrator` again afterwards. Before provisioning it issues an explicit
`RESET ROLE`, again only after the superuser check. In incremental mode a pending `0019` is refused before anything runs. The
`ALTER ROLE … SET role` experiment of §11 has **not** been run and nothing depends on it.

Output contains the mode, the database name, `session_user`, `current_user`, counts and diagnostic codes — never a URL or a password; the
harness asserts that no captured output contains either.

### Arguments, `--provision-only` and what bootstrap mode needs on an existing database (D-8A)

- **Arguments** (`cli-args.ts`, parsed by `migrate.ts` first of all). Accepted: `--mode <bootstrap|incremental>` / `--mode=<…>` and `--provision-only`, each
  at most once. Anything else — a mistyped flag such as `--provision-onyl`, a positional argument, a valueless or repeated option,
  `--provision-only` with `--mode incremental` — exits 1 **before the configuration is read and before any connection is opened**, so a typo can no
  longer run a full migration. Messages never echo an argument that is not shaped like a plain flag (it could be a connection string).
  **How pnpm 9.15 delivers them** (measured with a probe script and with the real process, `migrate-cli.harness.test.ts`): `pnpm run db:migrate --mode x` and
  `pnpm --filter @saas-inventory/api db:migrate --mode x` reach the script as `--mode x`; with a `--` separator the script receives a literal leading
  `--`. Exactly one leading `--` is tolerated; the documented form has none.
- **`--provision-only` preconditions** are checked explicitly before anything is granted: the history must be a consistent prefix (the usual checks),
  the state must not be `NEW`, and `app_migrator` must exist; otherwise `PROVISION_PRECONDITION_FAILED` names the unmet condition. (A new database used to be
  refused only incidentally, by the final registry check.)
- **Bootstrap mode on an existing database also needs `CREATE` on the database for `app_migrator`** whenever it will run migrations and the batch does not
  start with `0000`: the wrapper sets the role to `app_migrator` first, and Drizzle's `CREATE SCHEMA IF NOT EXISTS` needs that privilege. Found by the D-8A
  harness: without the check, a never-provisioned database with `0019` pending failed inside Drizzle (rolled back, registry unchanged, but opaque). It is now
  refused up front as `IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE` with the remedy. `--provision-only` is exempt (it runs no migration and is how the privilege arrives).
- **Databases created `TEMPLATE` another** do not inherit that privilege (it lives in `pg_database`). The diagnostic says so and gives the authorised path: with
  the bootstrap login and a consistent history, `db:migrate --mode bootstrap --provision-only`, then `db:migrate --mode incremental`. Incremental mode never grants
  it, and no run changes the roles of an existing database by itself.

## 6c. Owner and RLS invariants — what is checked, when, and what is never undone (D-8B)

**Audited objects, and only these.** In schema `public`: tables, partitioned tables, sequences, views, materialized views, foreign tables, functions, enum / domain /
standalone composite types, and the schema itself — each must be owned by `app_migrator`. Excluded on purpose: objects that belong to an extension (pgcrypto's functions are
owned by the installer), array and table-row types, and anything with no owner of its own (indexes, constraints, triggers, policies, columns: they follow their table).
In schema `drizzle`: nothing may be owned by `app_migrator` (the history stays under the bootstrap owner). RLS: every table of `public` with RLS enabled must have
`FORCE ROW LEVEL SECURITY`, and RLS that was enabled before the batch must still be enabled after it. Nothing else is claimed: no privileges (`GRANT`/`REVOKE`), no
policies, no column or function-body content — that is the linter (§12).

**Baseline rule.** A snapshot of the catalogues is taken before the batch; only violations the batch **introduces** are blocking. A deviation that was already there is
reported as a WARNING (`pre-existing deviations, not blocking`, on every run — also when nothing is pending) so that a database with mixed owners (`MIG-OWNERSHIP-AUDIT`) is
not locked out of every future migration. A table that was already unforced and stays unforced is pre-existing, not new. A brand-new database is exempt from the warning (its
`public` schema starts with another owner until `0000` hands it over).

**Before the commit — rolled back.** Drizzle's `migrate()` commits its own batch transaction, so the wrapper cannot insert a step between "last migration" and "commit" by
calling it, and `drizzle(tx)` does not accept an open transaction (it needs `client.options`). The wrapper therefore hands Drizzle a client whose `begin` is decorated
(`withPreCommitGuard`, `migration-runner/invariants.ts`): after Drizzle's callback has applied every pending migration and inserted every registry row, **still inside the same
transaction**, the hook checks (1) `current_user` is `app_migrator`, (2) the registry is a complete, consistent prefix of the journal — which also catches the files Drizzle read
differing from the validated ones (audit finding H7) — and (3) the owner / RLS invariants against the baseline. If it throws, postgres.js rolls the whole batch back and the error comes out
of `migrate()`. Measured on 16.15 (experiment, then the harness): inside the transaction the hook sees all 54 tables, the 51 registry rows and `current_user = app_migrator`; after the
rollback there are 0 tables, no `app_*` role created by `0000`/`0019` remains, and the session role is back to the login.

**What stays committed even when the guard rolls back.** Only what Drizzle does **before** its transaction: `CREATE SCHEMA IF NOT EXISTS drizzle` and
`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations` — on a brand-new database, an empty registry and its schema (verified: 0 migrations, 0 public tables, registry 0 rows).

**After the commit — NOT rolled back.** Three things can only be known afterwards, and none of them can be undone by the wrapper, which never repairs:
1. If the hook did not run (a Drizzle upgrade that no longer calls `client.begin` once for the batch — the decorator is pinned to `drizzle-orm@0.45.2`), the batch is committed
   before anyone checked; the post-commit audit reports `INVARIANT_GUARD_NOT_INVOKED` plus any violation. The harness fails in that case.
2. Provisioning of the incremental login is a second transaction (§6b); if it fails the migrations stay applied.
3. The post-commit audit re-checks the registry and the invariants on committed state. With the guard working it finds nothing new.

When a violation is found after the commit, the run exits 1 with `These changes are ALREADY COMMITTED`, the migrations stay applied, and the database remains as it is. The next run does
**not** refuse it again: that violation is now part of the baseline and is only warned about. Fixing it is a **new corrective migration** (never an edit of an applied one), reviewed like any other.
A post-commit check is a detector, not a rollback.

Mapping of the audit's question "which checks can be inside the transaction": owner, RLS and registry invariants and `current_user` — yes (catalogue reads see the transaction's own writes).
Not inside: Drizzle's pre-transaction DDL, the provisioning step, and anything about a second connection or concurrent session.

## 6e. The SQL/RLS linter (D-8D)

**What it is.** A static analysis of the SQL of each migration, by rules with stable identifiers and an explicit severity, run by the wrapper on the **pending** migrations
before Drizzle can execute anything, and available as a CLI over any folder or file. It **complements** the dynamic checks of §6c; it does not replace them: the linter looks
at the statements about to run, §6c looks at the state they leave.

**Parser.** `libpg-query@16.8.1` (npm dist-tag `pg16`), pinned exactly, MIT: the PostgreSQL **16** grammar itself (the server's `gram.y`) compiled to WebAssembly. No native build (so
it installs on Windows without a toolchain), no runtime dependency (`@pgsql/types` is types only); it added two packages to the lockfile. Target server: 16.15. Alternatives
looked at: `libpg-query@17`/`@libpg-query/parser@17` (PostgreSQL 17 grammar — would accept PG17-only syntax a 16 server rejects); `pgsql-ast-parser` (pure JS, a partial grammar, no
guarantee on the constructs the project uses); regular expressions (rejected: they cannot tell a statement from a comment, a string or a quoted identifier). Because it is the real lexer and
grammar, comments, string and dollar-quoted literals and quoted identifiers are never mistaken for statements (tested), and the only text handling left is the split on Drizzle's
own `--> statement-breakpoint` marker — exactly how Drizzle splits what it executes — and display-only snippets.

**What the parser does NOT do (verified on this build, and decisive).** It exports `parse`/`parseSync` only: **no PL/pgSQL parser and no tokenizer**. The body of a `DO` block or of a
`LANGUAGE plpgsql` function reaches the linter as an opaque string. Dynamic SQL (`EXECUTE format(…)`) lives only in PL/pgSQL, so it cannot be analysed either. No other build of the same
family (`libpg-query` 16/17, `@libpg-query/parser`) exports one. **Policy: fail safe.** Such a body is reported as `PLPGSQL-UNANALYZED` with certainty `low` — an **ERROR** in an ordinary
migration (it blocks), a **WARNING** in one declared privileged — together with a *lexical hint* (the body text contains EXECUTE, GRANT, … : not a parse, a comment can trigger it) to help a
human triage. A statement inside a DO block is never reported as clean or as anything else: it is invisible, and the report says so. A SQL-language function body *is* parsed. A chunk that does not parse is
`LINT-PARSE-ERROR` (ERROR, not exceptable); a file with no statement is `LINT-EMPTY` (WARNING).

**Severity depends on the migration's classification** (history manifest): `ordinary` — the migration runs in incremental mode and must not touch roles, ownership, the database or the session
identity (an unclassified one is read as ordinary); `privileged` — declared in the privileged manifest, where role and extension statements are expected. Being privileged is **not** a licence: PUBLIC
grants, REASSIGN OWNED, database-level DDL, file access and RLS disabling stay errors. ERROR blocks; WARNING means "a human must look", never "safe"; INFO documents.

| Rule | What it finds | Ordinary | Privileged | Exceptable |
| --- | --- | --- | --- | --- |
| `PRIV-GRANT` | GRANT to a named application role | WARNING | WARNING | yes |
| `PRIV-GRANT-BROAD` | GRANT ALL / GRANT on ALL objects in a schema | ERROR | WARNING | yes |
| `PRIV-GRANT-PUBLIC` | GRANT to PUBLIC, WITH GRANT OPTION, or to a role that is not a project role | ERROR | ERROR | yes |
| `PRIV-REVOKE` | REVOKE | WARNING | WARNING | yes |
| `PRIV-ROLE-MEMBERSHIP` | GRANT/REVOKE of a role membership | ERROR | INFO | yes |
| `PRIV-OWNER-CHANGE` | Change of owner (ALTER … OWNER TO, CREATE SCHEMA AUTHORIZATION) | ERROR | INFO | yes |
| `PRIV-REASSIGN` | REASSIGN OWNED / DROP OWNED | ERROR | ERROR | yes |
| `PRIV-DEFAULT-PRIVILEGES` | ALTER DEFAULT PRIVILEGES | ERROR | WARNING | yes |
| `ROLE-DDL` | CREATE / ALTER / DROP ROLE (also ALTER ROLE … SET) | ERROR | INFO | yes |
| `ROLE-ATTRIBUTES` | A role given SUPERUSER, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS | ERROR | WARNING | yes |
| `SESSION-IDENTITY` | SET / RESET ROLE, SET SESSION AUTHORIZATION | ERROR | INFO | yes |
| `ADMIN-DATABASE` | CREATE / ALTER / DROP DATABASE, ALTER SYSTEM, tablespaces, LOAD | ERROR | ERROR | yes |
| `ADMIN-EXTENSION` | CREATE / ALTER / DROP EXTENSION | ERROR | INFO | yes |
| `ADMIN-REMOTE` | Foreign data, event triggers, publications, subscriptions | ERROR | ERROR | yes |
| `ADMIN-FILE-ACCESS` | COPY from/to a server file or a program | ERROR | ERROR | yes |
| `FUNC-SERVER-ACCESS` | A function that reads/writes server files, runs remote SQL or controls the server | ERROR | ERROR | yes |
| `TXN-CONTROL` | BEGIN / COMMIT / ROLLBACK / PREPARE TRANSACTION | ERROR | ERROR | **no** |
| `TXN-SAVEPOINT` | SAVEPOINT / RELEASE / ROLLBACK TO | WARNING | WARNING | yes |
| `RLS-DISABLE` | DISABLE ROW LEVEL SECURITY | ERROR | ERROR | yes |
| `RLS-WINDOW` | NO FORCE ROW LEVEL SECURITY restored by FORCE in the same file | WARNING | WARNING | yes |
| `RLS-WINDOW-UNRESTORED` | NO FORCE ROW LEVEL SECURITY never restored by FORCE in the same file | ERROR | ERROR | yes |
| `RLS-WINDOW-UNGUARDED` | A NO FORCE window with no verification (row_security_active / relforcerowsecurity) the parser can see | WARNING | WARNING | yes |
| `RLS-ENABLE-WITHOUT-FORCE` | ENABLE ROW LEVEL SECURITY with no FORCE in the same file | ERROR | ERROR | yes |
| `RLS-ENABLE` | ENABLE ROW LEVEL SECURITY | INFO | INFO | yes |
| `RLS-FORCE` | FORCE ROW LEVEL SECURITY | INFO | INFO | yes |
| `RLS-POLICY-CREATE` | CREATE POLICY | INFO | INFO | yes |
| `RLS-POLICY-PUBLIC` | A policy that applies to PUBLIC (no TO clause, or TO PUBLIC) | ERROR | ERROR | yes |
| `RLS-POLICY-ALWAYS-TRUE` | A policy whose USING / WITH CHECK is the constant true | WARNING | WARNING | yes |
| `RLS-POLICY-CHANGE` | ALTER POLICY / DROP POLICY | WARNING | WARNING | yes |
| `RLS-SETTING` | Changing row_security or session_replication_role | ERROR | ERROR | yes |
| `TRIGGER-DISABLE-WINDOW` | DISABLE TRIGGER re-enabled in the same file | WARNING | WARNING | yes |
| `TRIGGER-DISABLED-UNRESTORED` | DISABLE TRIGGER never re-enabled in the same file | ERROR | ERROR | yes |
| `TRIGGER-PROTECTED` | Disabling or dropping a tenant-isolation trigger | ERROR | ERROR | yes |
| `TRIGGER-DROP` | DROP TRIGGER | WARNING | WARNING | yes |
| `TENANT-COLUMN` | Dropping, renaming, retyping or making nullable the tenant_id column | ERROR | ERROR | yes |
| `FUNC-SECURITY-DEFINER` | SECURITY DEFINER | ERROR | ERROR | yes |
| `FUNC-UNTRUSTED-LANGUAGE` | A function or DO block in a language other than sql / plpgsql | ERROR | ERROR | yes |
| `PLPGSQL-UNANALYZED` | PL/pgSQL (DO block or function body) the parser cannot analyse | ERROR | WARNING | yes |
| `DYN-EXECUTE` | EXECUTE of a prepared statement, PREPARE or CALL | WARNING | WARNING | yes |
| `ADVISORY-LOCK` | pg_advisory_* call (can interfere with the migration lock) | WARNING | WARNING | yes |
| `DATA-TRUNCATE` | TRUNCATE | WARNING | WARNING | yes |
| `DATA-DROP` | DROP TABLE / DROP SCHEMA | WARNING | WARNING | yes |
| `LINT-PARSE-ERROR` | The SQL could not be parsed: nothing can be said about it | ERROR | ERROR | **no** |
| `LINT-EMPTY` | A migration file with no statement | WARNING | WARNING | yes |
| `LINT-INTERNAL` | The linter could not interpret the parser output | ERROR | ERROR | **no** |

**Contract for a NO FORCE window** (the twelve historical ones, which are not edited): FORCE restored on the same table later in the same file (checked: otherwise `RLS-WINDOW-UNRESTORED`, ERROR);
an identity guard and a set-based postcondition (not provable statically — the linter only reports whether a `row_security_active()` / `relforcerowsecurity` check is visible, else
`RLS-WINDOW-UNGUARDED`); and, dynamically, §6c refuses a batch that leaves FORCE off. All twelve restore FORCE; none shows a visible verification.

**PL/pgSQL policy (D-8D.1, fixed).** The parser cannot read inside `DO` blocks or `LANGUAGE plpgsql` functions, so: an **ordinary** migration containing either → `PLPGSQL-UNANALYZED` **ERROR** (the batch is refused,
Drizzle never starts); a migration **declared privileged** → **WARNING**, which is *not* an approval: it is the prompt for the explicit review that being privileged implies. In both cases the finding has certainty
`low` — it is **not confirmed by the syntax tree**, and the report, the summary line and the wrapper log count such findings apart from AST-confirmed ones. The message states that dynamic SQL, privileged statements and RLS
changes inside the body are **not checked**; a role, a grant or a `DISABLE ROW LEVEL SECURITY` hidden in a body produces no finding of its own (tested). Being privileged excuses nothing else: PUBLIC grants, `REASSIGN OWNED`,
database-level DDL, file access, `SECURITY DEFINER`, RLS disabling, transaction control and unparseable SQL stay ERRORs in the same file (tested, next to a DO block that only warns). The *lexical hint* attached to an unanalysed body
(`Lexical hint only (not parsed; …)`: the text contains EXECUTE, GRANT, …) is a substring check on the opaque string and **can be triggered by a comment or a string inside the body**; telling them apart reliably would need a
PL/pgSQL lexer — a second parser, which is exactly what this phase does not add — so the limitation is documented and pinned by a test rather than papered over. SQL-language function bodies, in contrast, ARE parsed (certainty `high`).

**Parser unavailable (D-8D.1).** If the parser cannot be loaded (WebAssembly initialisation) or crashes while linting, the run is refused: exit 1, stage `lint`, `SQL_LINT_PARSER_UNAVAILABLE` ("the migrations cannot be linted,
so none is applied"), before the baseline and before Drizzle; the underlying error text is not echoed. Nothing is read as clean — a parser that reports every chunk unparseable gives `LINT-PARSE-ERROR` errors, not silence. Proven
on a fresh database (no `drizzle` schema, no table afterwards), on an existing one (registry and tables untouched), with the advisory lock released and the next run acquiring it at once and succeeding once the cause is gone. The
wrapper takes the parser through an injectable loader (`RunOptions.sqlParserLoader`) that `migrate.ts` never sets; injecting one cannot skip the lint — a failing one refuses the run. Nothing is needed from the parser when nothing is pending or
for `--provision-only`.

**Exceptions — `database/migrations/sql-lint-exceptions.json` (D-8D.1).** Format: `{ "schemaVersion": 1, "exceptions": [ { "ruleId", "tag", "sha256", "line", "reason", "reviewedIn" } ] }`. It sits with the other manifests (the migration
tooling ignores it) and **ships empty: there is no exception for any of the 51 historical migrations**. Validation is strict and in two layers.
1. *Shape* (`exceptions-file.ts`), when the folder is read — before the wrapper connects: exactly those keys and nothing else, no wildcard, no empty field, `line` an integer ≥ 1, `sha256` 64 lowercase hex, `reason` ≥ 30 characters, `reviewedIn` one of
   `commit:<sha>`, `pr:<n>`, `review:<id>:<date>`, `retroactive-review:<id>:<date>`, no duplicate (rule, migration, line). One bad entry invalidates the whole file; nothing is applied partially.
2. *Meaning* (`applyExceptions`), at lint time, against the findings of **every** journal migration (an exception may concern one already applied): the rule must exist and be exceptable, the migration must be in the journal, the **sha256 must equal the file's current
   canonical hash**, and the rule, migration and line must match exactly one finding. Otherwise `LINT_EXCEPTION_INVALID` — and the run is refused before Drizzle, with nothing applied.
An **absent** file means "no exceptions", by definition: exceptions can only relax the linter, so losing the file can only make it stricter (accepted findings reappear as open ones). A **present but invalid** file stops the run at the files step, even if nothing is pending.

**Review and expiry.** An exception is bound to one statement of one version of one file. Editing the migration changes its hash, so the exception goes stale (and the manifest check catches the edit anyway); moving the statement changes the line; fixing the SQL leaves the
exception matching nothing. In every case the wrapper refuses until a human removes or re-reviews it — there is no time-based expiry; staleness is structural. `reviewedIn` points at the review that approved it (its format is checked, whether the commit/PR exists and says that is the
reviewer's job). Adding one is a reviewed change to this file, in the same commit as the migration.

**Not exceptable:** `LINT-PARSE-ERROR` and `LINT-INTERNAL` (nothing can be said about the file) and `TXN-CONTROL` (a COMMIT/BEGIN would end or fork the batch transaction that the pre-commit check controls). An entry naming any of them is invalid.

**Accepted is not the same as absent.** An accepted finding stays in every report — the CLI table (`status = accepted`), the JSON, and the wrapper log (`ACCEPTED <severity> <rule> <file>:<line> by <reviewedIn> — <reason>`, plus "N accepted by exception" in the summary) — and only stops counting
toward the exit code and the blocking decision. A finding that was never produced (the statement does not exist) leaves no trace at all; the two are distinguishable in every output. `--no-exceptions` on the CLI shows everything as open.

**Integration.** Step 6b of the wrapper (§6b), after the history and identity assessment and under the migration lock (§6d), before the invariant baseline and Drizzle: it lints the pending
migrations from the same read whose canonical hashes were just validated against the manifest, so what is analysed is what is executed (Drizzle re-reads the files; a difference is caught by the
registry check inside the transaction, §6c). Any open ERROR → exit 1, stage `lint`, one `SQL_LINT_ERROR` per finding naming `file:line` and rule, **nothing applied** — verified on a fresh database (no `drizzle`
schema exists afterwards) and on an existing one (a clean migration in the same batch is not applied either). WARNINGs are summarised by rule; INFO appears only in the CLI. If the parser cannot be loaded the run is refused
(`SQL_LINT_PARSER_UNAVAILABLE`, tested). `--provision-only` applies nothing and lints nothing; a run with nothing pending lints nothing, and an applied migration is never re-linted.

**CLI.** `pnpm --filter @saas-inventory/api exec tsx src/database/migration-integrity/sql-lint.cli.ts [--dir <folder>] [--file <one.sql> [--classification ordinary|privileged]] [--format table|json] [--strict] [--quiet-info] [--no-exceptions]`.
Exit **0** = no ERROR (and, with `--strict`, no WARNING); **1** = an ERROR, or a WARNING under `--strict`; **2** = unusable input, including an invalid exceptions file or an exception that matches no finding. Files only; it modifies nothing.

**Result on the 51 existing migrations (diagnostic mode, no exceptions): 0 ERROR, 181 WARNING, 168 INFO; every file parses.** Frozen as an expectation in `sql-lint.repo.spec.ts` (a rule that starts or stops
firing on them fails the suite). The WARNINGs: 79 `PRIV-GRANT` (column/table grants to project roles), 41 `RLS-POLICY-CHANGE` (`ALTER POLICY`), 21 `RLS-WINDOW` + 21 `RLS-WINDOW-UNGUARDED` (the twelve windows), 9
`PLPGSQL-UNANALYZED` (all in `0000` and `0019`), 6 `RLS-POLICY-ALWAYS-TRUE` (the event-processor and import-worker policies, scoped to those roles), 3 `PRIV-GRANT-BROAD` (`GRANT ALL` on the `drizzle` objects in `0000`), 1
`TRIGGER-DISABLE-WINDOW`. Because there is no ERROR, a fresh database applies all 51 with no exception.

**Known false negatives (stated, not hidden).** Anything inside PL/pgSQL: `0000` creates roles and grants membership inside `DO` blocks, and the linter reports only that the bodies are unanalysed — it does not
see a `CREATE ROLE` there. SQL built at run time. A privilege granted to a *project* role is only a WARNING: the linter does not know whether the privilege is the right one. Names are matched as written (a schema-qualified and an
unqualified name for the same table are two names). `tenant_id` and the protected-trigger pattern (`tenant`) are conventions of this project, not facts the parser knows.
**Known false positives.** `RLS-POLICY-ALWAYS-TRUE` also fires for a deliberately permissive policy scoped to a service role; the lexical hints on unparsed PL/pgSQL can be triggered by a comment.

**Still not covered by the wrapper or the linter**: `drizzle-kit migrate`/`push`, a hand-written `migrate()`, the test `globalSetup`, `psql` — none goes through the wrapper, so none is linted, locked or guarded.

## 6d. Mutual exclusion between runs (D-8C, audit finding H6)

**Problem.** Two wrapper runs on the same database could both pass the history check and the invariant baseline and then both reach Drizzle, which does not serialise itself.
The second would also evaluate a baseline that the first is about to change.

**Mechanism.** A **session-level advisory lock**, `pg_try_advisory_lock(0x53494d47, 1)` ("SIMG", 1), polled every 250 ms until `MIGRATOR_LOCK_TIMEOUT_SECONDS` (default 60) and released with
`pg_advisory_unlock` in a `finally` before the connection closes (`migration-runner/lock.ts`).

Why session-level and not transaction-level. One run spans several transactions on its single connection: the reads, Drizzle's batch transaction and the provisioning transaction.
A transaction-level lock would end at the first commit or rollback and leave the rest unprotected, and one outer transaction around everything is impossible (`drizzle(tx)` is not
accepted, §6c). A session lock is untouched by commit and rollback (proven: a rolled-back batch does not release it) and PostgreSQL drops it when the session ends for any reason.
Why polling `pg_try_advisory_lock` and not a blocking call: an explicit, reportable timeout and a diagnostic that names the holder, with no session-wide `lock_timeout` setting.

**Identity and scope.** Advisory locks are per database: the lock is `(current database, classid 0x53494d47, objid 1, objsubid 2)`, observed in `pg_locks`. Two runs on the same database always
exclude each other, whatever their mode and including `--provision-only`; a run on another database is never blocked (tested: B finished while A was held). The two-integer form is a different
key space from the one-bigint form that the application's own `pg_advisory_xact_lock(hashtext(…))` calls use, so they cannot collide.

**What is under the lock.** Taken right after the connection is made and the database name is confirmed, and held through: a second reading of the identity facts (what was read while waiting
may be stale), the role switch, the history and baseline evaluation, the batch with its pre-commit check, the final verification, the post-commit audit, **and the provisioning transaction** (it
shares the lock so that no run can start, or evaluate, in the window between the batch and the provisioning). It is released after all of that. Errors in configuration, files or arguments are
refused before connecting and never take it.

**Outcomes.** Acquired immediately — no message. Waiting — one line, `Waiting for the migration lock of database "x" (held by backend pid N, …); giving up after Ns`, then
`Migration lock acquired after waiting …; the state is evaluated now, not before`. Timeout — exit 1, stage `lock`, `LOCK_NOT_ACQUIRED` with the time waited and the holder, "Nothing was
evaluated, changed or repaired"; the holder is not disturbed. The holder shown is limited by what the connecting role may see in `pg_stat_activity`.

**Evidence** (harness, PostgreSQL 16.15, two independent OS processes running `runMigrations`, the first held inside a `pg_sleep(6)` batch): the second reports waiting, then evaluates after
the first — `pending=0`, applies nothing, registry has one row per migration, and `second.acquiredAt ≥ first.releasedAt`; a 2 s timeout gives `LOCK_NOT_ACQUIRED` after ≈2 s while the holder
finishes normally; `0` fails at once; `--provision-only` waits for an incremental run and then sees its result; the lock is released after success, a failing batch and a pre-commit invariant
rollback, each time explicitly; and when the holder process is killed (SIGKILL) mid-batch the lock disappears from `pg_locks`, the interrupted batch is **not** committed (registry unchanged, table absent), and the next run
starts without waiting.

**Limits.**
- It protects only runs that go through this wrapper. **`drizzle-kit migrate`, `drizzle-kit push`, a hand-written `migrate()`, the test `globalSetup` (which drops and re-migrates with Drizzle directly) and any
  manual `psql` session do not take it**; they can run beside a wrapper run, with none of the wrapper's checks. `drizzle.config.ts` says not to use them; nothing technical stops it.
- A connection pooler in transaction mode (PgBouncer) would break session locks; the wrapper connects directly and this has not been tested through one.
- If the client dies while the server is executing a statement, the server keeps the session — and the lock — until that statement ends and it notices the closed socket (observed: the lock was
  released when the `pg_sleep` ended, about 6 s after the kill, and the batch rolled back). A very long migration statement therefore delays the next run for as long as it takes to finish.
- The lock does not stop anyone from changing the database by other means while a run holds it; it only serialises wrapper runs.
- Not a distributed lock across databases or clusters, and not a queue: waiters poll, so the order in which several waiters proceed is not guaranteed.

## 7. Identity (enforced by the wrapper)

`session_user` is who logged in; `current_user` is the effective role. After `SET ROLE app_migrator`, `current_user = app_migrator`
while `session_user` stays the login; `RESET ROLE` returns `current_user` to the login. That is why the incremental login must be the
privilege ceiling.

| Mode | `session_user` must be | `current_user` must be at the start |
| --- | --- | --- |
| bootstrap | a superuser | the login itself if migration `0000` is pending (it creates the role, the extension and the grants itself and issues its own `SET ROLE`); otherwise `app_migrator` |
| incremental | not superuser, no `BYPASSRLS`, no `CREATEROLE`; member of `app_migrator` `WITH SET`; equals the configured incremental login | `app_migrator`, which is neither superuser nor `BYPASSRLS` |

Also required in incremental mode: `app_migrator` exists and has `CREATE` on the database (§8). Findings: `IDENTITY_BOOTSTRAP_NOT_SUPERUSER`,
`IDENTITY_SESSION_SUPERUSER`, `…_BYPASSRLS`, `…_CREATEROLE`, `IDENTITY_SESSION_USER_MISMATCH`, `IDENTITY_APP_MIGRATOR_ROLE_MISSING`,
`IDENTITY_NO_SET_MEMBERSHIP`, `IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE`, `IDENTITY_CURRENT_USER_UNEXPECTED`,
`IDENTITY_CURRENT_USER_PRIVILEGED`.

## 8. Permissions the wrapper depends on — scope, risk and what was observed

Applied **only** by `provision.ts` (bootstrap mode, after the migrations), in the disposable clusters of the harness. Nothing was applied to any
existing database.

- **`GRANT CREATE ON DATABASE <db> TO app_migrator`.** Needed because Drizzle runs `CREATE SCHEMA IF NOT EXISTS drizzle` on every execution and
  PostgreSQL checks `CREATE` before it looks at `IF NOT EXISTS` (an incremental run without it is refused with
  `IDENTITY_APP_MIGRATOR_LACKS_DATABASE_CREATE`; tested). It lets that one role create schemas in that one database; it grants no `CREATEROLE`,
  `CREATEDB`, superuser, `BYPASSRLS` or access elsewhere. **Risk:** a compromised incremental login could add schemas and objects there; it could
  already own objects in `public`, so the added surface is small but real. The grant is a property of the database, not of its objects: a
  database copied with `CREATE DATABASE … TEMPLATE` does **not** keep it (the harness hit this and re-adopts each copy).
- **The login.** `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT`, member of `app_migrator` `WITH INHERIT FALSE, SET TRUE`
  and of nothing else (an existing role that is a superuser or belongs to other roles is refused, never demoted). Observed: without `SET ROLE` it
  cannot read a single application table, cannot `SET ROLE` to `postgres` or `app_platform`, and after `RESET ROLE` is back to holding nothing.
- **Drizzle's objects** stay owned by the bootstrap owner. `0000` granted ALL on them (applied SQL is not edited); `provision.ts` narrows
  `app_migrator` to `USAGE`+`CREATE` on schema `drizzle`, `SELECT`+`INSERT` on `__drizzle_migrations` and `USAGE` on its sequence. Observed as
  `app_migrator`: `UPDATE`, `DELETE`, `TRUNCATE`, `DROP` and `ALTER` on the registry fail with `42501`; `CREATE ROLE` fails with `42501`.
- **Not prevented by privileges, observed:** (1) `INSERT` of a forged registry row (for instance `created_at` far in the future) succeeds. Plain
  Drizzle then skips every pending migration **without an error**; the wrapper refuses it (`HISTORY_NOT_PREFIX`, both runs tested side by side).
  (2) `CREATE TABLE drizzle.<anything>` succeeds, because `CREATE` on that schema is what Drizzle's `CREATE TABLE IF NOT EXISTS` check needs.
  (3) As owner of every application table `app_migrator` can `GRANT`, `DISABLE ROW LEVEL SECURITY` or `NO FORCE` — see §12.
- **Rejected alternative.** A temporary grant around each run needs the privileged identity on every run, which defeats incremental mode.

## 9. Configuration contract (D-8A: one contract for every consumer)

Decision: **every consumer moves to `MIGRATOR_BOOTSTRAP_DATABASE_URL`**; the old `MIGRATOR_DATABASE_URL` stays only as a deprecated alias with an exact, narrow scope. Both
the wrapper and the other consumers read the pair through one rule (`resolveBootstrapDatabaseUrl` in `@saas-inventory/config`, mirrored by `config.ts`):
the new name wins when it is the only one set, the alias is accepted when the new name is absent, **both set is an error** (never a silent choice), neither set is
an error that names the new variable. Values never appear in messages.

| Variable | Function | Rules |
| --- | --- | --- |
| `MIGRATOR_EXPECTED_DATABASE` | the database the run must be connected to | **required in both modes** (no safe alternative exists: a wrong URL is the failure it prevents); plain name; must equal the database in the URL (`CONFIG_DATABASE_URL_MISMATCH`, before connecting) and `current_database()` (after). Valid example: `saas_inventory` |
| `MIGRATOR_BOOTSTRAP_DATABASE_URL` | privileged login (superuser) | the name every consumer reads: the wrapper, `bootstrap-dev-roles`, the seeds, `reset-demo`, `drizzle.config.ts`, `tools/pg-verify`, the dev tools |
| `MIGRATOR_INCREMENTAL_DATABASE_URL` | limited login | required in incremental mode; **never** falls back to the bootstrap URL; its user must equal `MIGRATOR_INCREMENTAL_LOGIN` |
| `MIGRATOR_INCREMENTAL_LOGIN` | expected `session_user` | lowercase identifier, 3–63 chars, not `pg_*`, `app_*`, `postgres` (so `app_migrator_login` is invalid; the example uses `saas_migrator_login`) |
| `MIGRATOR_INCREMENTAL_PASSWORD` | used **only** by the bootstrap procedure | 16–128 chars, no control characters or surrounding spaces; ignored (with a warning) in incremental mode |
| `MIGRATOR_LOCK_TIMEOUT_SECONDS` | optional: how long to wait for another run on the same database (§6d) | whole seconds, 0–3600, default 60; `0` fails at once; invalid → `CONFIG_LOCK_TIMEOUT_INVALID` before connecting |
| `MIGRATOR_DATABASE_URL` | **deprecated alias**, bootstrap only | exact scope below |

**What the alias can and cannot do.** Used alone it is bootstrap mode, always, and warns. It **can**: create a NEW database, run `--provision-only`, find nothing to
do, and run a pending privileged migration (`0019`-type) on a database that was already adopted with `--provision-only`. It **cannot** apply ordinary migrations to an
existing database — the wrapper refuses them (`MODE_BOOTSTRAP_NOT_REQUIRED`) — and it cannot stand in for the incremental URL. So it is **not** full compatibility: an
existing database configured only with the alias works until the first new ordinary migration, then needs the incremental login (set `MIGRATOR_INCREMENTAL_LOGIN` and
`MIGRATOR_INCREMENTAL_PASSWORD`, run `--mode bootstrap --provision-only` once, then `--mode incremental`). Setting the alias together with the new name is
`CONFIG_VARIABLE_CONFLICT` in the wrapper and an error in the helper.

Mode: `--mode bootstrap|incremental`, or inferred when exactly one of the two URLs exists; both without `--mode` is `CONFIG_MODE_AMBIGUOUS`. In bootstrap mode,
`MIGRATOR_INCREMENTAL_LOGIN` + `MIGRATOR_INCREMENTAL_PASSWORD` switch provisioning on (one without the other is an error), and the two logins must differ.

`.env.example` is a valid starting point as it is: it sets `MIGRATOR_EXPECTED_DATABASE` and `MIGRATOR_BOOTSTRAP_DATABASE_URL`, offers the alias and the incremental block only as comments,
and `env-contract.spec.ts` checks that copying it configures the wrapper and every consumer, that uncommenting each optional block yields a valid configuration, and that copying the
alias next to the new name is refused. `docker-compose.dev.yml` sets the same two. `tools/pg-verify/dev-server.ts` creates the database named in the URL itself, so it defaults
`MIGRATOR_EXPECTED_DATABASE` to that name when `.env` omits it (an explicit value still wins). `TEST_MIGRATOR_DATABASE_URL` (the integration suite's `globalSetup`) is a separate,
unchanged variable. The password is spliced into DDL (parameters are not accepted there) as a `quote_literal` result with `log_statement` silenced for that transaction; it is not
printed anywhere.

Breaking change for existing setups: `MIGRATOR_EXPECTED_DATABASE` is now required, so `db:migrate` on an old `.env` stops with `CONFIG_VARIABLE_MISSING` until that one line is added.

## 10. Test harness on PostgreSQL 16.15 (built; results of the D-7.2 run)

Two separate tools, both disposable, neither ever pointed at a server they did not start:

1. **`apps/api/test/migration-harness/`** (`pnpm --filter @saas-inventory/api test:migration-harness`, skipped unless
   `MIGRATION_HARNESS_PG_BIN` names a PostgreSQL `bin` directory). It creates a cluster with `initdb`/`pg_ctl` in a **new** temp directory, on a random
   free port of 55461–55499 (never 5432, 55432, 55433 or 55440), scram authentication, random superuser password in memory, and stops and deletes
   only that directory at the end (the last test asserts both). It builds fixtures with the wrapper or with Drizzle's own `migrate` (the legacy
   flow) over copies of the real migrations; tampering is always done on copies in temp folders.
2. **`tools/pg-verify`** keeps its role (migrations, roles, RLS catalogue, seeds, the whole integration suite) and now runs the wrapper: bootstrap
   from empty, bootstrap again, then an incremental run as the limited login. `PG_VERIFY_PG_BIN` + `PG_VERIFY_PORT` make it use a 16.15 server
   built the same way instead of the embedded 18.x beta.

D-7.2 result of tool 1 (PostgreSQL 16.15, Windows): **37 tests, all passed, exit code 0**, cluster stopped and removed. It covers: bootstrap from an empty
cluster (51 migrations, hashes equal to what Drizzle computes, 54 tables all owned by `app_migrator`, `FORCE` restored on every RLS table,
`app_import_worker` created by `0019`); idempotent second run in both modes with an unchanged registry and ACL fingerprint; adoption of a
legacy-migrated database by `--provision-only` and an incremental run of the 11 remaining migrations as the limited login; refusal of a superuser, a
`BYPASSRLS` and a `CREATEROLE` login, of a login without `SET` membership and of an `app_migrator` without `CREATE`; refusal, before connecting, of a
wrong database, an unexpected login, equal logins, a short password and a missing URL; refusal, with the empty database left without even the
`drizzle` schema, of a journal gap or duplicate, a missing/incomplete/divergent manifest, an unclassified or unreviewed migration, a mismatched
classification and an undeclared privileged file; a pending `0019` refused in incremental mode and applied in bootstrap mode with `app_migrator`
effective afterwards; a missing, altered, extra, absent or emptied registry refused with the database unchanged; the forged-future-row case against
plain Drizzle; rollback of a failing batch; the RLS window (zero-effect trap, success, rollback on failed postcondition or DML, wrong identity,
unforced start); real-process exit codes (`0`/`1`), the deprecation warning without the URL, the generator refusing a new privileged migration with
the manifest byte-identical; and a scan of all captured output for passwords and connection strings.

Findings of the run: `pg_ctl start` with piped stdio never returns on Windows (the server inherits the pipes) — fixed by logging to a file; a database
created `TEMPLATE` another loses the database-level `CREATE` grant (§8) — the wrapper correctly refused the copies; the "wrong database" and
"unexpected `session_user`" cases that need a *runtime* mismatch (URL and expected name agree, `current_database()` differs) cannot be produced by a
real connection and are covered by unit tests of `evaluateIdentity` and, before connecting, by the configuration checks.

The CI path pinned to 16.15 is described in 10b (D-8E); the 16.15 executables are not
Authenticode-signed (byte-identical to those installed by the signed, hash-verified EDB installer).

## 10b. Continuous integration on PostgreSQL 16.15 (D-8E)

**What exists.** `.github/workflows/ci.yml` keeps its original `ci` job (lint, typecheck, `pnpm test`, build) and adds two jobs, each with **its own** disposable PostgreSQL container:

| Job | Order of steps (stops at the first failure) |
|---|---|
| `migration-harness` | frozen install, tool versions (node, pnpm, `libpg-query`), start the container, **server version check**, API typecheck, API lint, API unit tests (migration integrity, SQL/RLS linter, wrapper units, `ci-workflow.spec.ts`), the linter CLI on the real 51 migrations (proves the real parser loads; if it cannot, the CLI exits 2), the **full wrapper harness**, `git diff --check HEAD~1 HEAD` |
| `pg-verify` | frozen install, start the container, server version check, `tools/pg-verify`: wrapper bootstrap, bootstrap again, incremental as the limited login, role/RLS catalogue checks, seeds, the integration suites |

**Pinning.** `postgres:16.15@sha256:1beaa308...c61c` is the digest of the OCI **index** of the tag `16.15`, checked independently against the registry (its linux/amd64 manifest is `sha256:b95b87e9...8b1b`, whose config records `PG_VERSION=16.15-1.pgdg13+2`). A digest pins content, but the claim "the server is 16.15" is **also** proved from the run itself: each job runs `SHOW server_version_num` on the running container and fails unless it is exactly `160015`; the harness and `pg-verify` repeat the check from inside their own connection (`MIGRATION_HARNESS_EXPECTED_SERVER_VERSION_NUM`, `PG_VERIFY_EXPECTED_SERVER_VERSION_NUM`). Never `latest`, never a tag without a digest (`ci-workflow.spec.ts` enforces both). To bump, change `POSTGRES_IMAGE` in both jobs together.

**Credentials and network.** The password is generated per run (`openssl rand`), masked with `::add-mask::` before any use, and travels only through `GITHUB_ENV` as a connection URL that is also masked; it never appears in an artifact or a log. The container is published as `-p 127.0.0.1::5432` (loopback, ephemeral host port) and the job refuses 5432/55432/55433/55440. The passwords of the application roles that `pg-verify` creates *inside* the throwaway database are fixed test strings (they protect nothing outside that container).

**How the tools attach.** `MIGRATION_HARNESS_SERVER_URL` (harness) and `PG_VERIFY_SERVER_URL` (pg-verify) point at a server somebody else started. Both accept it only if the host is loopback, the port is not protected, the login is a superuser **and the server is fresh** (no database besides `postgres`/templates, no table, no role besides the login and `pg_*`). A server that ever held anything is refused, so these destructive tools cannot be aimed at a real one. They never start, stop or delete an attached server; the job removes its own container (`if: always()`, `docker rm -f <that name>` only; no prune). Setting both `MIGRATION_HARNESS_PG_BIN` and `MIGRATION_HARNESS_SERVER_URL` is an error. `.exe` is only appended on Windows.

**Which tests exercise the wrapper, and which do not.**

| Tests | Through the wrapper (`runMigrations` / `db:migrate`)? |
|---|---|
| `wrapper.harness.test.ts`, `migrate-cli.harness.test.ts` | **Yes**: the real wrapper and CLI (a separate OS process for the lock tests) |
| `sql-lint-cli.harness.test.ts` | The linter CLI only (files, no database) |
| `tools/pg-verify` steps 2-4 | **Yes**: three real `db:migrate` runs (bootstrap, bootstrap again, incremental) |
| `pg-verify` seeds, `bootstrap-dev-roles`, `reset-demo` | They use the bootstrap URL but not the migration flow |
| Integration suites run by `pg-verify` (`globalSetup`) | **No**: `global-setup.ts` re-migrates with Drizzle directly. These tests prove schema/RLS/behaviour on 16.15, not the wrapper |
| API unit specs | Pieces of the wrapper (config, files, history, hashes, linter, guards) with no database |

CI is therefore **not** a second migration path: nothing in the workflow applies migrations except the wrapper (and the legacy Drizzle call in the integration `globalSetup`, which already existed and is listed as a bypass path in `MIG-IDENTITY-HISTORY`).

**Obsolete exceptions with nothing pending (found and fixed in D-8E).** Before D-8E the exceptions were validated only when at least one migration was pending, so an exception made obsolete by an edit was ignored by a normal run with zero pending migrations (and by `--provision-only`). Now the exceptions are validated against the current files whenever any is loaded: a well-formed exception that matches no finding, a stale hash, a wrong line or a non-exceptable rule is refused at stage `lint` before Drizzle; the parser is required in that case (a failing parser gives `SQL_LINT_PARSER_UNAVAILABLE`); with the empty shipped file and nothing pending the parser is not needed and the run is unchanged. The CLI's `--no-exceptions` ignores the *meaning* of the file but never its structure (a malformed file is still exit 2). Eight harness tests (the `D-8E` block) and one CLI test pin this; six of the eight failed before the fix.

**Artifacts.** On failure only: the last 300 lines of the container log and its image/state (no environment, no URL). Retention 7 days.

**First real runner execution (2026-10-29, run finished 2026-10-30 00:06 UTC).** Run `40975871156` (commit `9a53cc5`, event `push` on `develop`) is the **first completely green run** of this workflow on GitHub Actions (Linux runner, Node 20, `postgres:16.15@sha256:…` container): `ci` PASS (lint, typecheck, `Test`, and — for the first time in CI — `Build`), `migration-harness` PASS (about 3 min), `pg-verify` PASS (about 16 min). That validates the container steps, the version check, the harness and `pg-verify` on a real runner. It is **one** green run: it does not show that the intermittent items below are stable. Only job and step statuses were read; the job logs were not available (HTTP 403), so no log line is quoted here.

**Incidents found by the first runs** (the earlier runs of `2734363`, `1eec094` and `5d3ca26` were red, hung or cancelled):
- *TypeScript TS2345 in the three PDF export services* (`doc.on('data'|'end'|'error')` accepted only `'limit'`). The failure pre-dates D-8E (the run of `2734363` failed at the same `Typecheck`). Reproduced locally by pointing pnpm's hoisted `node_modules/.pnpm/node_modules/@types/node` at 20.17.6 (0 errors with 22.20.1 or 26.2.0); `@fastify/busboy` declares the only `'limit'` overload on `stream.Readable`. `apps/api` declared no `@types/node` and got Node's types by accident. Fix (D-8E.11, commit `5d3ca26`): declare `@types/node@^22.10.0` in `apps/api` (lockfile resolves 22.20.1; the typecheck then loads a single copy and passes even with the 20.17.6 link). **The hoisting actually chosen on the original runner was not observed**; the mechanism is reproduced, the runner state is inferred.
- *Two intermittent `apps/web` tests* (`product-cart-modal.test.tsx`, `kardex-explorer.test.tsx`), which failed in different runs. Cause **supported by code analysis, not reproduced** (16 parallel and 13 sequential local runs all passed): the Kardex heading renders before its rows, and the cart's quantity buttons stay disabled while a PATCH is in flight. Fix (D-8E.15, commit `9a53cc5`): wait with `findByText` / `waitFor(...toBeEnabled())`. Tests only.
- *`pg-verify` stalled at step 10* (`db:reset-demo` printed its last line and never returned) in the runs of `1eec094` and `5d3ca26` (both ended cancelled). The two later runs (`8d55547`, `9a53cc5`) finished. **Root cause unknown; not resolved.** Added in `8d55547`: a time budget per step (15 min, 60 for the integration suites; a timeout is a FAIL that aborts the run), diagnostics also on `cancelled()`, and temporary `[debug]` output in `reset-demo-tenant.ts` (variable `RESET_DEMO_DEBUG_ACTIVE_RESOURCES`). The logs of the green runs were not available, so it was not checked whether the `closing` and `returned` lines appeared.

**Limits.** (1) One green run on a real runner exists (above); stability over several runs is not established. (2) Node 20 and Linux were exercised by that run; the local runs used Node 24 on Windows. (3) `.gitattributes` pins `database/migrations/**` to LF; the green run is consistent with it but its effect was not isolated. (4) The earlier `ci` failure on `sales.orders.view_all` (`packages/database` test) was fixed in D-8E.3 (stale manual list); the web unhandled error of `products-mobile.test.tsx` was fixed in the same step. (5) The `[debug]` instrumentation and the `pg-verify` hang are open (see `MIG-CI-PGVERIFY-HANG` in the pending register). (6) PL/pgSQL bodies and dynamic SQL stay unanalysable (6e); H5 is untouched; ADR-0041 stays Proposed.

## 11. Experiment design — `ALTER ROLE … SET role = app_migrator` as an extra defence against `RESET ROLE` (not run; not relied upon)

- **Question.** Does a per-role default `role` setting make `RESET ROLE` return to `app_migrator` instead of the login, and does the
  limited login still fail to reach anything beyond its own rights?
- **Where.** Only in a disposable cluster of the new harness (§10) on PostgreSQL 16.15; never against an existing database.
- **Steps.** (1) Create the incremental login, make it a member of `app_migrator` `WITH SET`. (2) `ALTER ROLE <login> SET role =
  app_migrator`. (3) Connect as the login; record `session_user`, `current_user`. (4) `RESET ROLE`; record both again. (5) `SET ROLE
  <login>`; `SET ROLE postgres`; `SET SESSION AUTHORIZATION postgres`; `CREATE ROLE x` — record each outcome. (6) Repeat with a
  superuser login to see whether the setting changes anything for it.
- **Reading the result.** If `RESET ROLE` lands on `app_migrator` and the escalations stay denied, it is a *useful additional* layer;
  if it lands on the login (or the setting makes the login unable to connect), it is dropped. In either case the decisions of ADR-0041
  (limited login, no `CREATEROLE`, privileged migrations only in bootstrap mode) stand on their own.

## 12. Limits and residual risk

- **D-8B reduces, but does not remove, this gap**: the owner / RLS invariants (§6c) refuse a batch that leaves a table with RLS enabled but not FORCEd, disables RLS that was enabled, or leaves an object owned by another role. They do **not** see privileges or anything else.
- **D-8D adds a real linter (§6e)** for statements the parser understands; what it cannot see — PL/pgSQL bodies, dynamic SQL — it reports as unanalysed. The older text scan of the privileged manifest (`PRIVILEGED_STATEMENT_UNDECLARED`) is kept as an independent, cruder check on the declaration.
- **The text scan is not a linter.** It sees `CREATE/ALTER/DROP ROLE`, `CREATE EXTENSION`, `RESET ROLE`, `SET [LOCAL|SESSION] ROLE` and
  `SET SESSION AUTHORIZATION`. It does **not** see `GRANT`/`REVOKE`, `ALTER … OWNER`, `DISABLE ROW LEVEL SECURITY`, `NO FORCE ROW LEVEL SECURITY`,
  `SECURITY DEFINER`, `ALTER DEFAULT PRIVILEGES`, `CREATE DATABASE` or `COPY … PROGRAM`. An explicit `ordinary` classification is a record of who
  decided, **not** a semantic validation: the harness shows a migration containing `GRANT ALL ON ALL TABLES … TO app_tenant`, classified `ordinary`, being executed by an incremental run. (A
  `DISABLE ROW LEVEL SECURITY` that the D-7.2 harness also showed passing is, since D-8B, refused before the commit — but only for tables that had RLS enabled.) The
  wrapper is therefore **not** complete protection against sensitive SQL. Owner-accepted for this delivery; closing it is the SQL/RLS linter
  delivery (pending register `MIG-SQL-RLS-LINTER`), which must at least evaluate the nine statement kinds above.
- `reviewedIn` is validated for format only.
- The hash algorithm is replicated from the pinned `drizzle-orm@0.45.2` (§3); re-verify it on any Drizzle upgrade. The files are read twice (by the
  wrapper and by Drizzle); a change in between is caught by the final registry-versus-journal check, not prevented.
- PostgreSQL 16+ is required (`pg_auth_members.set_option`); other versions are refused as `FACTS_UNAVAILABLE`. Only 16.15 was exercised.
- The existing twelve data migrations with hand-written `NO FORCE`/`FORCE` windows are unchanged and unguarded; `rls-window.ts` is for new ones.
- Not validated: any database that really existed, E1-B1 (whether `0032` took effect anywhere) and the Docker/CI path.
