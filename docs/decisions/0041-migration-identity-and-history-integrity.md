# ADR-0041: Migration Identity, History Integrity and Data Migrations under RLS

## Status

Proposed (2026-10-28). It stays **Proposed** until implementation, tests and a review of the evidence are complete.

Approvals so far (owner, 2026-10-28): decisions 1–8 for documentation (D-5); decision 9 with the snapshot work (D-5, D-5.2); and, on
the D-6 report (D-7), the adoption of S3 *for the design of the migrator*, `0000`/`0019` reserved for the privileged flow, the
permanent `GRANT CREATE ON DATABASE` *as an implementation proposal* (decision 1, scope and risk in
[migration-integrity.md](../architecture/migration-integrity.md), §8),
a versioned manifest of every migration (decision 10), the split of the configuration (decision 11), two harness paths kept apart from
`tools/pg-verify` (decision 12) and the design of an experiment on `ALTER ROLE … SET role` (decision 13).

Approved for D-7.2 (owner): an explicit `classification` (`ordinary` | `privileged`) and `reviewedIn` per migration in the history manifest, `.gitattributes`
with `database/migrations/** text eol=lf`, the temporary acceptance of the incomplete text scan (linter in its own delivery), `drizzle-orm@0.45.2`
kept, and PostgreSQL 16.15 as the reference for the integration tests.

**Implemented so far:** the Drizzle snapshot reconciliation (decision 9); *delivery 2a* (pure checks and the manifests); and *delivery 2b* (D-7.2) —
the wrapper in `apps/api/src/database/migrate.ts` / `migration-runner/` (configuration contract, identity and history checks before Drizzle,
bootstrap procedure for the incremental login with narrowed `drizzle` grants, `--provision-only`, a checked RLS-window helper) and a harness on
disposable PostgreSQL **16.15** clusters ([migration-integrity.md](../architecture/migration-integrity.md) §6b, §8, §10). **It remains Proposed:**
the evidence is synthetic (disposable clusters only; no existing database was touched, none is claimed to be affected), the linter is not built
(the wrapper is **not** complete protection against privileged or RLS-affecting SQL), the Docker/CI path and the ownership audit are pending, and
E1-B1 (whether `0032` took effect in any particular database) stays inconclusive.

It amends [database.md#migration-strategy](../architecture/database.md#migration-strategy) and complements
[ADR-0008](0008-drizzle-orm.md) (Drizzle ORM) and [ADR-0004](0004-tenant-isolation-strategy.md) (RLS as defence in depth).
Nothing here edits or reinterprets an applied migration ([CLAUDE.md §7.7](../../CLAUDE.md#77-database)).

## Context

Migrations run through `apps/api/src/database/migrate.ts`: one connection (`max: 1`) opened with `MIGRATOR_DATABASE_URL`, then
`drizzle-orm`'s `migrate()`. Three facts shape the problem. Each is labelled with how it is known.

1. **Which role runs a migration depends on the login, not on the migrator code.** *Static:* migration `0000` ends with
   `SET ROLE app_migrator` and `0019` does `RESET ROLE` / `SET ROLE app_migrator`; `migrate.ts` never sets a role and never checks
   `current_user`. *Observed (synthetic, PostgreSQL 18.4 beta, then 16.15):* a fresh single pass leaves all 54 `public` tables owned
   by `app_migrator`, but an incremental pass run by a superuser login without `SET ROLE` creates its new tables owned by that login
   (four tables: `order_payments`, `platform_support_sessions`, `tenant_admin_invitations`, `tenant_logos`).
2. **`app_migrator` is subject to row-level security.** *Static:* it is neither superuser nor `BYPASSRLS`
   ([database.md#effect-on-app_migrator-and-migrations](../architecture/database.md#effect-on-app_migrator-and-migrations)), and the
   tenant policies are `TO app_tenant`. *Observed:* an `INSERT … SELECT` over `FORCE ROW LEVEL SECURITY` tables run as that identity
   reads zero rows, inserts zero rows, raises no error and is recorded as applied. *Static:* twelve applied migrations use a
   `NO FORCE` / `FORCE` window (`0029`, `0035`, `0037`, `0041`–`0047`, `0049`, `0050`); none uses `row_security_active` or a
   `RAISE EXCEPTION` guard (only `0000`'s trigger function raises). Migration `0032` has no window.
3. **Drizzle does not verify history.** *Static (`drizzle-orm@0.45.2`, `pg-core/dialect.js`):* `migrate()` reads only the registry row
   with the highest `created_at`, applies every journal entry whose `when` is greater than it, in **one** transaction together with the
   registry `INSERT`, and never compares the hash of an already-applied migration. A journal entry whose `when` is at or below the
   maximum is skipped silently and for ever. *Observed:* with the current Drizzle, a missing journal entry, swapped `created_at`
   values, an altered SQL file or a deleted registry row for an earlier migration all end in a silent no-op "success".

A fourth fact corrects existing text. The header of `0000` and the docblock of `migrate.ts` say the bootstrap login needs
`CREATEROLE` and ownership of the database. **`CREATEROLE` is not sufficient on its own.** *Observed:* a non-superuser login with
`CREATEROLE` that owned the database failed at `0000` with `42501 permission denied to create role` (PostgreSQL 18.4 beta). *Inference,
not isolated:* the cause is `CREATE ROLE app_platform WITH LOGIN BYPASSRLS` (`0000`, line 42), which PostgreSQL restricts to
superusers. Those comments are part of applied files (their hash is registered) and are **not** edited; this ADR and the documents
listed in *Implementation status* carry the correction.

## Decision

1. **S3 — a privileged bootstrap and a limited incremental login, both ending in `SET ROLE app_migrator`.**
   - *Bootstrap mode:* a superuser login, for a new database (a single pass) and for any pending privileged migration (decision 2).
   - *Incremental mode:* a dedicated login that is not a superuser, has no `BYPASSRLS` and no `CREATEROLE` (decision 3), is a member of
     `app_migrator` `WITH SET TRUE` (and inherit). After `SET ROLE app_migrator` the migrator
     verifies `current_user = 'app_migrator'`, that neither `session_user` nor `current_user` is a superuser or `BYPASSRLS`, the
     expected database and port, and that `app_migrator` holds `CREATE` on the database. Any mismatch aborts before any statement
     that changes anything.
   - *Requirement observed:* `CREATE SCHEMA IF NOT EXISTS drizzle`, which Drizzle runs on every execution, requires `CREATE` on the
     database even when the schema exists; without it the run fails with `42501`. S3 therefore needs `GRANT CREATE ON DATABASE … TO
     app_migrator`, issued once by the bootstrap procedure, never by a migration.
   - `SET ROLE app_migrator` is applied in both modes whenever the role exists, so objects created by a mixed batch keep a uniform owner.
     **Exception:** a batch that still includes migration `0000` starts as the session user, because `0000` creates the role, the
     extension and the grants as the login and issues its own `SET ROLE` afterwards (`expectedStartingRole`).
   - The permanent `GRANT CREATE ON DATABASE` is approved only as an implementation proposal: it is applied exclusively by the bootstrap
     procedure, and its scope and risk are written down before it is applied in any environment (migration-integrity.md §8).
   - `session_user` (the login) and `current_user` (the effective role) are always checked separately: after `SET ROLE`,
     `current_user = app_migrator` while `session_user` remains the login, and `RESET ROLE` returns `current_user` to the login.
2. **Privileged migrations are `0000` and `0019`, always.** They create roles, an extension and a `BYPASSRLS` role, or `RESET ROLE`
   to the login. A versioned manifest lists them with the SHA-256 of their files. A future migration that needs `CREATE ROLE`,
   `ALTER ROLE`, `CREATE EXTENSION`, `RESET ROLE`, `SET SESSION AUTHORIZATION` or a role change must be declared in the same
   manifest. In incremental mode, any privileged migration pending is **rejected before anything runs**; the batch is then run in
   bootstrap mode. A privileged migration is classified so regardless of the cluster's current state: `0019` succeeds for a limited
   login only when `app_import_worker` already exists (observed), and role existence is a property of the cluster, not of the
   database.
3. **The incremental login has no `CREATEROLE`.** With the superuser login a `RESET ROLE` restores full privileges (observed: it can
   `SET ROLE postgres`, `SET SESSION AUTHORIZATION` and `CREATE ROLE`). With the limited login the same `RESET ROLE` yields only the
   login's own rights and those three attempts are denied (observed). General PostgreSQL knowledge, **not tested here**, says that before
   version 16 a `CREATEROLE` login can also alter other non-superuser roles; this ADR does not rely on `CREATEROLE` being acceptable.
4. **The `drizzle` schema stays under the bootstrap owner.** The incremental login (through `app_migrator`) receives only what the
   run needs: `USAGE` and `CREATE` on schema `drizzle`; `SELECT` and `INSERT` on `drizzle.__drizzle_migrations`; `USAGE` on its
   sequence; plus `CREATE` on the database (decision 1). It has no `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER`.
   *Observed (16.15):* that set completes a full incremental update and blocks `UPDATE`, `DELETE`, `TRUNCATE` and `DROP` of the
   history; `CREATE` on the schema is required (without it `CREATE TABLE IF NOT EXISTS` fails with `42501`); the current grants
   inherited from `0000` (`GRANT ALL`, lines 98–102) do allow `UPDATE`/`DELETE`/`TRUNCATE`. Narrowing them is done by the bootstrap
   procedure, not by editing `0000`. **Privileges alone cannot protect the history**: `INSERT` is indispensable and a row with a very
   high `created_at` makes Drizzle skip real migrations (observed). The history validation of decision 5 is therefore mandatory, not
   optional hardening. Transferring the schema to `app_migrator` was rejected (see *Alternatives*).
5. **An inconsistent state aborts, with no automatic repair.** Before any change the migrator classifies the database from read-only
   queries and the journal, never from the number of registry rows. It aborts, with a diagnostic naming the cause, on: a journal
   with a gap in `idx`, duplicate tags, a non-increasing `when`, or a missing `.sql` file; a registry that is not exactly a prefix
   of the journal (same `when` and the same SHA-256 of the file at each position); a registry row with no journal entry; a pending
   entry whose `when` is at or below the highest applied one; a missing registry with tables present, or an empty registry with
   tables present; a privileged migration unapplied while later ones are applied; a manifest hash that does not match its file; a
   login without the required membership. Repair is a human, reviewed action.
6. **Data migrations on RLS-forced tables follow one contract**, and no universal window is allowed. A migration may open a
   `NO FORCE ROW LEVEL SECURITY` window only if it declares the tables, the reason, the eligible rows and the expected effect in a
   header, and then: (a) guards the identity (`current_user`, and `row_security_active` true for each affected table, so an identity
   that RLS does not restrict fails instead of hiding the problem); (b) opens the window on exactly the affected tables; (c) guards
   that `row_security_active` is now false; (d) fills with an explicit row filter; (e) checks a **set-based postcondition**
   (no eligible row lacks the effect), computed independently of the number of rows inserted and tolerant of zero eligible rows;
   (f) restores `FORCE` explicitly; (g) verifies `relforcerowsecurity` for every affected table and raises otherwise; and (h) sets
   `lock_timeout` with `SET LOCAL` and ends with an explicit `RESET lock_timeout`. Everything runs inside the single transaction
   Drizzle opens for the **whole pending batch**, so the table locks of the window are held until that batch commits; windows are
   kept short and out of busy periods. Any exception rolls back the whole batch, including the registry rows. A guard alone does
   not fix the underlying problem (it only turns a silent no-op into a failure), and `SET LOCAL row_security = off` does not work
   for an owner under `FORCE` (observed: `42501 query would be affected by row-level security policy`).
7. **PostgreSQL 16.15 is the experimental reference for this stage.** No compatibility with any other version is claimed. The earlier
   18.4 beta runs are prior evidence only.
8. **No ownership correction on an existing database without a prior, expressly approved audit.** The audit compares the owner of
   every relation, function, type and schema in `public`, the `drizzle` schema, its table and sequence, and the extension objects
   against the expected owners (all `app_migrator` in `public`; extension functions excluded; `drizzle` per decision 4). A
   deviation would be corrected by a **new** migration, never by editing an applied one.
9. **Snapshot reconciliation (R1).** The Drizzle snapshot chain lacked the column added by `0050`, so the next `db:generate` would
   propose a duplicate `ADD COLUMN "approval_number"`. `database/migrations/meta/0050_snapshot.json` is added to close the gap, and the
   unique constraint `price_approvals_tenant_approval_number_key`, which only the SQL of `0050` created, is modelled in
   `apps/api/src/database/schema/09-sales.ts` and in that snapshot together (D-5.2). The journal and every SQL file are untouched.
10. **A versioned manifest of every migration** (`database/migrations/history-manifest.json`: `idx`, `tag`, `when`, SHA-256). The
    wrapper validates it before invoking Drizzle, so a change to an applied migration (even one made in the file and the registry
    together) is a reviewed diff and an abort, never a silent success. It describes the real files and is only ever *appended to* by
    its generator; the privileged manifest (decision 2) is edited by hand. Hashes are canonical (CRLF normalised to LF) because the
    repository has no `.gitattributes` and a Windows clone with `core.autocrlf=true` would otherwise change them; the registry is
    compared with the raw/LF/CRLF variants of the current file. See migration-integrity.md §3–§4.
11. **Configuration contract.** The incremental connection and the privileged bootstrap connection are separate variables
    (`MIGRATOR_INCREMENTAL_DATABASE_URL`, `MIGRATOR_BOOTSTRAP_DATABASE_URL`); the existing `MIGRATOR_DATABASE_URL` keeps its meaning and
    is never silently reinterpreted (it becomes a deprecated alias of bootstrap once the wrapper is integrated). The names, uses and
    compatibility rules are in migration-integrity.md §9. Nothing reads the new names yet.
12. **Harness for PostgreSQL 16.15, two paths, separate from `tools/pg-verify`:** configurable local `initdb`/`pg_ctl` binaries and a
    Docker image pinned to 16.15 for CI. Both are disposable and never touch a user database. `tools/pg-verify` is not replaced until
    parity is shown (migration-integrity.md §10).
13. **`ALTER ROLE … SET role` as an extra defence against `RESET ROLE`** is to be evaluated in an isolated experiment (design in
    migration-integrity.md §11). Nothing in this ADR depends on it.

14. **SQL/RLS lint policy (D-8D, D-8D.1).** The pending migrations are linted before Drizzle runs, with a parser that implements the PostgreSQL 16 grammar. (a) PL/pgSQL the parser cannot read (DO blocks, `LANGUAGE plpgsql` bodies, and so
    any dynamic SQL inside them) is an **ERROR in an ordinary migration** and a **WARNING in one declared privileged**, always marked as not confirmed by the syntax tree; being privileged is not an authorisation for anything else, and the
    critical rules keep blocking. The linter never states that such a body was validated. (b) A parser that cannot be loaded refuses the run (`SQL_LINT_PARSER_UNAVAILABLE`) before Drizzle. (c) Accepted findings live in a versioned
    `database/migrations/sql-lint-exceptions.json`: one exact statement per entry (rule, migration, line, file hash, reason, review), no wildcards, shipped empty, any defect stopping the run; `LINT-PARSE-ERROR` and `TXN-CONTROL` cannot be
    excepted; an accepted finding stays visible. This does not change the status of this ADR (Proposed). Details: migration-integrity.md §6e.

## Evidence and limits

All results below are **synthetic** (disposable clusters, fabricated tenants), obtained outside this repository. They do not
establish what happened in any existing database and say nothing about production.

| What | Version | Result |
| --- | --- | --- |
| Fresh install, rerun, ownership, `core.roles.manage` | 18.4 beta; 16.15 | 51 registry rows, 54 tables owned by `app_migrator`, rerun a no-op |
| Incremental pass as a superuser login | 18.4 beta | four tables owned by the login |
| `SET ROLE app_migrator` without `CREATE` on the database | 18.4 beta; 16.15 | `42501`, whole batch rolled back |
| Incremental pass, limited login, `SET ROLE`, `CREATE` granted | 18.4 beta; 16.15 | uniform ownership; `0032` applied with zero effect on fabricated roles |
| `0019`: limited login, role missing / role existing / privileged login | 16.15 | fails `42501` and rolls back / succeeds / succeeds |
| `RESET ROLE`: limited vs superuser login | 16.15 | limited stays limited and escalation attempts are denied; superuser regains all |
| Classifier prototype over 11 inconsistent states | 16.15 | aborts all, changes nothing; the current Drizzle fails in 3 and silently "succeeds" in 4 of those 11 |
| `drizzle` grants (current / narrowed / no schema `CREATE` / no database `CREATE` / owner transfer) | 16.15 | as stated in decision 4 |
| RLS contract (identity guard, window, postcondition, restoration, rollback, zero rows, `lock_timeout`) | 16.15 | all behaved as specified; controls show a naive migration is recorded with zero effect and an unrestored `FORCE` is committed |
| Repository `migrate.ts` + three integration files | 16.15 | 51 rows, 54 tables owned by `app_migrator`, 56 tests passed |
| Delivery 2a: unit specs of the pure checks (118 tests, 6 files) and the full API unit suite | no database | 951 tests in 80 files passed; `tsc` (src and tests) and `eslint` clean |
| `embedded-postgres` as a 16.x source | npm registry (read, partial) | newest 16.x seen is `16.14.0-beta.17`, all 16.x are betas; not a 16.15 stable source |

Limits: one operating system; the 16.15 binaries came from the EDB zip and their executables are **not Authenticode-signed** (they are
byte-identical to those installed by the signed, hash-matched EDB installer); the classifier and the contract SQL were prototypes in a
temporary directory; only three of the repository's integration files were run, and as the current superuser flow, not as S3. The
scripts and raw results are not in the repository.

## Alternatives considered

- **S1 — always a superuser login, no `SET ROLE`** (current behaviour): owners differ between a fresh and an incremental run, and a
  superuser hides the very RLS failures the contract guards against.
- **S2 — superuser login plus `SET ROLE`:** `RESET ROLE` (as in `0019`) restores superuser privileges; it also needs the database grant.
- **S4 — `app_migrator` as the login:** untested, and `0000` creates it for a different purpose.
- **Classify by registry row count:** insufficient — Drizzle only reads the last row, and roles are cluster-wide, so a role's
  existence does not say the database was migrated.
- **Split a mixed batch into separate runs:** more machinery with no ownership benefit once `SET ROLE` applies in both modes.
- **`drizzle` owned by `app_migrator`:** the owner may `UPDATE`, `DELETE`, `TRUNCATE` and `DROP` the history (observed).
- **A temporary policy for the owner instead of a `NO FORCE` window:** works (observed) but leaves schema drift if the `DROP POLICY`
  is missed and takes the same locks; allowed only as a justified exception.

## Consequences

- Once implemented, `db:migrate` stops being "run whatever is pending as whoever connects": it classifies, verifies identity, and
  refuses ambiguous states. No production database exists; the "existing environments" are development setups (the compose files and
  `.env.example` use a superuser as `MIGRATOR_DATABASE_URL`), which need a one-time bootstrap and a configuration change — a separately
  approved delivery. The ownership audit of an existing database is a separate, non-blocking activity (decision 8).
- Every new migration now needs one more reviewed change: its entry in `history-manifest.json` (appended by the generator), and, if it
  needs privileges, a hand-written entry in `privileged-manifest.json`.
- Data migrations written after this ADR carry a header and the guard/postcondition block; the twelve earlier window migrations are
  grandfathered in an exception list, unchanged.
- A new `UPDATE`-style data migration run by the limited login will, like `0032`, do nothing to RLS-forced rows unless it follows the
  contract; the contract and the linter exist to make that failure loud.

## Risks and open points

- `GRANT CREATE ON DATABASE` to `app_migrator` lets that role create schemas. It is the observed cost of S3, approved as an
  implementation proposal; its scope and risk are documented (migration-integrity.md §8) and it is applied nowhere yet.
- Line endings: with no `.gitattributes`, a CRLF checkout changes the raw hash of every migration and feeds Drizzle different text. The
  canonical manifest hashes absorb the first effect; the second would be removed by `database/migrations/** text eol=lf`, a separate
  decision (`MIG-EOL-HASH` in the pending register).
- The hash algorithm is replicated from the pinned `drizzle-orm`; it must be re-verified when Drizzle is upgraded.
- The incremental login is one more role and secret to manage.
- Table locks of a window last for the whole Drizzle batch; `lock_timeout` bounds the wait, not the hold.
- `RESET lock_timeout` after `SET LOCAL` was observed to behave as intended; without it the value leaks into later migrations of the
  same batch (observed).
- No other PostgreSQL version, operating system or hosting model has been exercised.
- Whether `0032` or any other data migration took effect in an existing database is **unverified**; nothing here claims that an
  existing database is, or is not, affected.

## Implementation status

| Item | State |
| --- | --- |
| This ADR; `database.md#migration-strategy`; `database/migrations/README.md`; `docs/roadmap/pending-register.md` | Done (documentation only) |
| `database/migrations/meta/0050_snapshot.json` and the `09-sales.ts` unique constraint (decision 9) | Done; `drizzle-kit generate` on a temporary copy reports "No schema changes" |
| Delivery 2a: journal validator, history classifier, execution guard (mode + identity), both manifests, manifest generator/check, unit specs, `docs/architecture/migration-integrity.md` | Done |
| Delivery 2b (D-7.2): wrapper in `migrate.ts` (`--mode`, `--provision-only`), configuration contract, read-only fact gathering, manifest v2 with explicit classification, `.gitattributes`, checked RLS window | Done; run only on disposable 16.15 clusters (37 harness tests; see the pending register for the `tools/pg-verify` run) |
| Bootstrap procedure (login, `SET`-only membership, `CREATE ON DATABASE`, narrowed `drizzle` grants) | Done in `provision.ts`; applied only in disposable clusters |
| Owner / RLS invariants of the state a batch leaves (D-8B): pre-commit hook inside Drizzle's transaction + post-commit audit | Done; limits in `migration-integrity.md` §6c; run only on disposable 16.15 clusters |
| Mutual exclusion between wrapper runs (D-8C): session advisory lock per database, configurable timeout | Done; two-process evidence on disposable 16.15 clusters; limits in `migration-integrity.md` §6d |
| Ownership audit command | Not implemented (`MIG-OWNERSHIP-AUDIT`, independent) |
| CI on PostgreSQL 16.15 | Implemented in D-8E (workflow jobs, external-server mode for the harness and pg-verify, stale-exception fix); statically and locally validated, no real runner run observed (`MIG-PG16-HARNESS`, migration-integrity.md 10b) |
| Migration linter | Done in D-8D over the PostgreSQL 16 grammar (`libpg-query@16.8.1`), run by the wrapper before Drizzle; PL/pgSQL bodies and dynamic SQL are reported as unanalysed; no exceptions file yet (`MIG-SQL-RLS-LINTER`) |
| PostgreSQL 16.15 harness in the repository | Local path done (`test:migration-harness`, `PG_VERIFY_PG_BIN`); Docker/CI path not built |
| `ALTER ROLE … SET role` experiment | Designed, not run |
| Ownership correction of existing databases | Not authorised |
| Decision index ([README.md](README.md)) | Row added (status *Proposed*) |
