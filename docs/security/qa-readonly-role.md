# `app_qa_readonly` — a read-only, tenant-pinned role for diagnosing the QA tenant

> **Update B4.11.3 (2026-10-30):** the scope is no longer the slug `qa-dev-tenant`: migration `0052_qa_readonly_tenant_config` pins it to an immutable tenant **UUID** held in a protected,
> empty-by-default table. Everything below that speaks of "the slug" describes `0051` as it was created and is **superseded by §11**. Nothing is applied; the role is still `NOLOGIN`.

**Status (D-8E.26-B4.11.1): designed, implemented as migration `0051_qa_readonly_role.sql`, reviewed, and tested against disposable PostgreSQL clusters
(16.15, the project reference, and 18.4) — and NOT applied to any real database. Nothing here means real access is enabled.**
Decision record: [ADR-0042](../decisions/0042-readonly-qa-diagnostic-role.md).

## 1. Why this exists

B4.10 could not diagnose the data of `qa-dev-tenant`: the only ways in were a login (which writes `last_login_at` and a session), a role with
`BYPASSRLS` (`app_platform`), or `app_tenant` (which can write). A role that can only `SELECT`, only that tenant's rows and only non-sensitive columns
removes that blocker without widening anything else.

## 2. The central risk, and how the design avoids it

Every tenant-isolation policy of the project is `TO "app_tenant" USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. `app.tenant_id` is a
**session variable the connection sets itself** (`set_config`, `SET`). That is fine for the application, which sets it from the authenticated session, but a
role that can run arbitrary SQL **could set it to another tenant's id**. So `app_qa_readonly` is deliberately **not** given any policy that reads a variable.

Instead each of its policies is
`FOR SELECT TO "app_qa_readonly" USING (tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s))` where `qa_readonly_scope` is a view, owned by `app_migrator`,
that resolved **`slug = 'qa-dev-tenant' AND status = 'active'`** from `tenants` in `0051` (since `0052`: the configured tenant UUID, see §11).

Why that cannot be bent from the session (each point has a test):
- the role cannot alter, replace, drop or re-own the view, change its options, write through it, or touch `tenants` or any policy;
- a policy stores the view **by object id** (`pg_depend` shows the 27 dependencies), so neither `search_path` nor a look-alike temporary table redirects it;
- the view is `security_barrier`: a function placed in the caller's `WHERE` never sees rows the view has not filtered (a leaky-function test captures its notices);
- `SET row_security = off` makes the query fail ("would be affected by row-level security"), it does not bypass anything.

- **Fail closed:** no active tenant with that slug → the view is empty → `tenant_id = NULL` → the role reads nothing. Suspended, renamed or deleted → nothing.
- **No existing policy applies to it:** every existing policy is `TO <named role>`; none is for `PUBLIC` (a test asserts it on the migrated database). With RLS on and no
  matching policy, a table returns no rows.
- **Known property of 0051 (removed by 0052, §11) — the pin was the slug.** Whoever can write `tenants.slug` (platform admin, superuser — never this role) decides which tenant it sees
  (a test documents it). A tenant registered later with that slug in another database would be the one visible there; that is why the role is **NOLOGIN** and is
  not meant to be enabled outside the development database.

## 3. The role

`CREATE ROLE app_qa_readonly WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2`, with
`default_transaction_read_only = on`, `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 60s` — defence in depth only: a role can override its
own settings and the tests do exactly that; **the privileges are what stop it**. Member of no role and no role is a member of it; owns nothing; **no default
privileges exist in the database** (a table created later is invisible until a migration grants it on purpose — tested).

**Roles are cluster-wide, so the migration handles a role of that name that already exists** (a second database of the same cluster, as in the CI harness): if it is
SUPERUSER or BYPASSRLS, is a member of a role or has members, or owns an object in this database, the migration **refuses** (`RAISE EXCEPTION`); otherwise it is
put back to NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOREPLICATION / NOBYPASSRLS / NOINHERIT / CONNECTION LIMIT 2, leaving LOGIN as it is (six scenarios, tested).
Applying it a second time to the same database fails (its views exist) and changes nothing (tested).

**Granted:** `USAGE` on schema `public`; `SELECT` on the two views; `SELECT` (table-level or column-level) on the 27 tables below.
**Never granted:** INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, CREATE, EXECUTE beyond PostgreSQL's PUBLIC defaults, membership, BYPASSRLS.
`information_schema.table_privileges`, `column_privileges` and `role_table_grants` list only `SELECT` for it; PUBLIC holds nothing on any application table or view.
Because some tables are granted by column, `SELECT *` on them fails with *permission denied* — by design; list the columns.

### Tables and columns

| Table | Access | Left out (sensitive / unnecessary) |
|---|---|---|
| `qa_readonly_tenant` (view) | id, name, slug, status of the scoped tenant only | every other tenant |
| `qa_readonly_scope` (view) | the scoped tenant id | — |
| `tenant_settings` | id, tenant_id, timezone, `transfers_require_approval`, `transfers_require_preparation`, timestamps | business_hours |
| `users` | id, tenant_id, email, status, last_login_at, timestamps, deleted_at | **password_hash**, full_name |
| `roles` | id, tenant_id, name, is_system_default, timestamps | description |
| `user_roles`, `role_permissions`, `user_location_assignments` | all columns | — |
| `categories`, `locations`, `inventory_balances`, `inventory_transfer_items`, `carts`, `cart_items`, `order_payments` | all columns | — |
| `products` | id, tenant_id, category_id, name, status, timestamps, deleted_at | description, attributes, brand/supplier |
| `product_variants` | id, tenant_id, product_id, sku, barcode, unit, **max/base price**, status, flags, timestamps, deleted_at | **cost, min_price**, attributes |
| `product_images` | id, tenant_id, product ids, storage_key, mime_type, position, created_at | — |
| `qr_codes` | id, tenant_id, target_type, target_id, status, expires_at, timestamps | **code** (the printed public token) |
| `warehouses` | id, tenant_id, name, code, status, timestamps, deleted_at | address |
| `inventory_movements` | id, tenant_id, variant, location, type, quantity, balance_after, reference_type/id, reason, occurred_at, created_at | **unit_cost**, actor, idempotency key, correlation id |
| `inventory_transfers` | ids, code, source/destination, status, **notes** (the seed markers), stage timestamps | requested_by/approved_by/dispatched_by |
| `inventory_transfer_receipts`, `…_receipt_items` | ids and quantities, incident type | received_by, notes, incident notes |
| `customers` | id, tenant_id, type, first/last/display name, **tax_id**, status, timestamps, deleted_at | **email, phone, address** |
| `orders` | ids, number, document type, status, totals, currency, placed_by_user_id, timestamps | the `customer_*_snapshot` columns, correlation id |
| `order_items` | ids, SKU/name snapshots, unit price, quantity, discount, line total | min price / cost snapshots |
| `sales_returns`, `sales_return_items` | ids, status, quantities, disposition, reason | received_by, inspected_by, notes |

### Decision on cost figures (B4.11.1 — reverses B4.11)

| Field | Need for the B4.10 diagnostic | Sensitivity | Decision |
|---|---|---|---|
| `product_variants.cost` | Would let the diagnostic confirm a SKU holder has the seed's cost. The seed's own `--check` compares it (when the account may see it) before any write, and `max_price`/`base_price` plus name and category already identify a product | High (business margin) | **Removed** |
| `product_variants.min_price` | Same reasoning; ADR-0028 treats it as the price floor | High | **Removed** |
| `inventory_movements.unit_cost` | "Recorded costs" was asked only "if authorized"; no step of the diagnostic depends on it | High | **Removed** |

No demonstrable need, so no access. If a later review wants them, a *new* migration adds them as column grants — not an edit of `0051`.

### `tenant_memberships` (kept excluded)

**No SELECT.** The table has no RLS (login must look memberships up across tenants), so a policy would do nothing and a grant would expose every tenant's rows (the
isolated test caught this in the first draft). Consequence, stated plainly: **this role cannot tell whether the QA identity has more than one active membership.**

*Possible alternative, NOT implemented — for an independent review:* a `security_barrier` view owned by `app_migrator` (it reads the RLS-less table with its own
ordinary rights; no `SECURITY DEFINER`, no RLS change) such as
`SELECT identity_id, count(*) FILTER (WHERE status = 'active') AS active_memberships FROM tenant_memberships WHERE identity_id IN (SELECT identity_id FROM tenant_memberships WHERE tenant_id = <scope>) GROUP BY identity_id`.
Risk to weigh: it reveals, for the identities of the scoped tenant, **how many** active memberships exist elsewhere (never which tenants) — the one cross-tenant
fact the question needs. It also becomes another privileged-owner object to maintain, and it would need its own test of non-leakage. Until that review, the
question stays answerable only through the seed's login (`tenant_selection_required`).

### Deliberately not granted at all

`identities`, `platform_*`, `tenants` (only the scoped view), all token / invitation tables, `audit_log`, `event_outbox`, `idempotency_keys`, `import_*`,
`price_approvals`, `tenant_price_policies`, `tenant_logos`, `brands`, `suppliers`, attributes, `permissions`, `measurement_units`, and the `drizzle` schema.

## 4. What it can still do (implicit, documented)

PostgreSQL gives every role some capabilities through PUBLIC that no migration of this project can remove without changing other roles. After switching its own
read-only default off, the role **can** (tested; none touches application data): create **temporary** tables, create an (empty) **large object**
(`lo_creat`), send a `pg_notify`, and take **advisory locks** (which could stall, until `pg_advisory_unlock_all()` or disconnect, code that uses the same key —
the migration runner holds a database-level advisory lock). It can read the system catalogs (`pg_catalog`, `information_schema`), which expose object names and
approximate sizes (`EXPLAIN` and `pg_class.reltuples` reveal planner estimates of other tenants' tables; `pg_stats` is hidden for RLS tables). It can `EXECUTE` only
PUBLIC's defaults: the two trigger functions of the application (not callable directly) and `pgcrypto`'s side-effect-free functions in `public`. No application
function is `SECURITY DEFINER`. These are why the role is `CONNECTION LIMIT 2`, time-limited and `NOLOGIN` until deliberately enabled.

## 5. What was proved, and where

`tools/pg-verify/qa-readonly-role.embedded.test.ts` (38 tests) builds **its own** cluster — a temporary directory, a random port in 56200-56299, a random password —
applies migrations `0000`…`0051` from the real files, inserts synthetic data for three tenants (`qa-dev-tenant`, `muebleria-elegante`, a suspended
`qa-dev-tenant-3d3920`) and checks, with real errors and not mocks: attributes, memberships, ownership; the full privilege matrix with `has_*_privilege` plus
`information_schema`; RLS enabled and forced on every readable table; reads only its tenant (filter, join, union); every write/DDL/policy/`SET ROLE`/`SET SESSION
AUTHORIZATION` refused — also after the role turns its read-only default off; sensitive and cost columns refuse, even inside subqueries; file/program/large-object
escapes refuse; `SET`/`SET LOCAL`/`set_config` of `app.tenant_id` in and out of transactions, `COMMIT`/`ROLLBACK`, `RESET ALL`, `DISCARD ALL`, connection reuse, a
temp look-alike of the scope view, a leaky function; fail closed on a suspended or renamed scope tenant; a table or view created later is unreadable; the view cannot
be dropped, re-owned, altered or written through; a pre-existing role of the same name is refused or normalised as above; re-applying the migration fails.

| Server | Result |
|---|---|
| **PostgreSQL 16.15** (the installed binaries — `initdb`/`pg_ctl`, a new cluster of its own, `--locale=C`; `QA_RO_PG16_BIN="C:\\Program Files\\PostgreSQL\\16\\bin"`) | **38 / 38** |
| PostgreSQL 18.4 (embedded package, default mode) | 38 / 38 |

The only difference seen between them: `pg_get_viewdef` prints `(slug)::text = …` on 16 and `slug = …` on 18 (the test accepts both). The test asserts the exact
server version (`server_version_num = 160015`) before it does anything in the 16.15 mode, and refuses to run if the binary is not 16.15.
Mutation checks (a policy rewritten to `current_setting('app.tenant_id')`; `tenant_memberships` included) make the isolation tests fail.

Also on 16.15, the project's own migration-wrapper harness (`pnpm --filter @saas-inventory/api test:migration-harness`) now covers 0051 on the **full** real folder
(see §7). Run the role test: `pnpm --filter @saas-inventory/pg-verify test:embedded` (embedded 18) or with `QA_RO_PG16_BIN` set (16.15). Both remove their own
directory and stop their own server; neither connects to anything else.

## 6. Residual risks

- The pin is the slug (above); see §10.1 for the B4.11.2 analysis and decision.
- Implicit PUBLIC capabilities (§4).
- `tenant_memberships` unreadable; `users.email` readable (the QA login identifier).
- Applying the migration needs the privileged login (it creates a role), like `0019`: a database adopted for the **incremental** login cannot apply it, it needs a
  bootstrap-mode run (tested in the harness).
- The SQL linter reports 0 errors and a `PRIV-GRANT` warning per grant (accepted, visible).

## 7. Changes under `apps/api` and the CI harness (audited in B4.11.1)

- `sql-lint/rules.ts`: `app_qa_readonly` added to `PROJECT_ROLES`. Without it the linter's `PRIV-GRANT-PUBLIC` rule (ERROR: "a role that is not a project role") rejects every
  GRANT in 0051. Side effect: the linter now only *warns* about any GRANT to this role in any future migration. **Mitigation added:**
  `migration-integrity/qa-readonly-role.repo.spec.ts` reads the real migrations and fails if any statement gives the role anything but a plain `SELECT`, `WITH GRANT OPTION`, a
  membership, a dangerous or LOGIN attribute, default privileges, or a policy not pinned to the scope view. No general linter rule was changed.
- `migration-files.repo.spec.ts`, `sql-lint.repo.spec.ts`: the privileged set is now `0000, 0019, 0051`. They are intentional guards of "which migrations need the privileged login".
- `test/migration-harness/cluster.ts`: protected ports extended with 55450 and 55470 (its random port range 55461-55499 included 55470).
- `test/migration-harness/wrapper.harness.test.ts`: **0051 would have broken the CI `migration-harness` job**: it asserts "all 51 migrations", "11 remaining after 40" and runs the
  *incremental* login over whatever remains, which is impossible once a privileged migration is pending. Its historical scenarios now run on a frozen copy of the first 51 migrations
  (byte-identical files; journal and manifests cut), and a new section 12 covers 0051 on the full real folder: bootstrap applies everything; an incremental run is refused
  before applying anything; the bootstrap run then applies 0051.

## 8. Using it later (none of this has been done)

1. Apply `0051` with the project's wrapper in **bootstrap** mode (privileged login) on the **development** database only. The role is created NOLOGIN.
2. As a privileged operator, enable it with a password generated and kept outside Git: `ALTER ROLE app_qa_readonly WITH LOGIN PASSWORD '<generated>';` (never
   committed; silence `log_statement` for the session as `provision.ts` does).
3. Connect over loopback to the development database only (`saas_inventory_dev`, port 55432), with a connection string in a git-ignored variable (suggested name
   `APP_QA_READONLY_DATABASE_URL`). A diagnostic tool would list columns explicitly.
4. **Verify** after applying: `SELECT rolcanlogin, rolsuper, rolbypassrls, rolconnlimit, rolconfig FROM pg_roles WHERE rolname = 'app_qa_readonly';`,
   `SELECT tablename, policyname FROM pg_policies WHERE 'app_qa_readonly' = ANY (roles);` (27 rows), `SELECT * FROM qa_readonly_scope;` (exactly the QA tenant id) and
   `SELECT DISTINCT privilege_type FROM information_schema.table_privileges WHERE grantee = 'app_qa_readonly';` (only `SELECT`).
5. **Revoke** immediately when done: `ALTER ROLE app_qa_readonly NOLOGIN;` (instant, reversible). To remove it entirely a *new migration* (never an edit of `0051`) would
   `DROP POLICY …` ×27, `REVOKE` the grants, `DROP VIEW qa_readonly_scope, qa_readonly_tenant` and `DROP ROLE app_qa_readonly`.

## 9. What is still missing to enable real diagnostics

Owner authorization to apply `0051` to the development database; the password / connection-string handling; a read-only diagnostic tool (SQL over this role, explicit
columns) and its review; the decision on the `tenant_memberships` alternative; and a decision about the slug pin if the QA tenant is ever renamed.
(B4.11.2 below turns these into explicit decisions and enabling conditions.)

## 10. Final risk review (D-8E.26-B4.11.2 — static review; nothing applied, nothing enabled)

State, unchanged: `0051` is **prepared and not applied** to any existing database; `app_qa_readonly` **does not exist** in any real database; no password or
connection string exists for it; nothing in the repository (seed, API, scripts, CI) enables or connects with it. The only place it exists is in disposable
clusters created and destroyed by tests.

### 10.1 Dependence on the slug `qa-dev-tenant`

*Who can write `tenants.slug` (read from the code and the migrations):* `tenants` is owned by `app_migrator`; `app_platform` holds a table-level
`SELECT, INSERT, UPDATE` (migration 0001); `app_tenant` has **no** grant on it; `app_import_worker` has `SELECT (id, status)` only; a superuser can do anything. In
the application **no code path updates `slug` after creation**: `TenantsPlatformRepository` updates only `name` (`updateName`) and `status` (`setStatus`,
`markSuspended`); `UpdateTenantDto` has no slug field; `PlatformTenantsController`/`PlatformSupport*` expose no slug edit. So a slug can change only through
direct SQL by the platform connection (`app_platform` compromised or misused), the migrator or a superuser. **There is no audit of such a change**: the only
trigger on `tenants` is `set_updated_at`; `audit_log`/`platform_audit_log` record API actions, not SQL.

*What can happen at creation (the realistic path):* the slug is **derived from the company name** (`reserveSlug`/`slugify`), by both self-service
`POST /auth/register` and platform onboarding, and `UNIQUE(slug)` makes a colliding name get a random suffix (this is exactly how `qa-dev-tenant-3d3920` came to be).
Consequence: in a database where **no** tenant holds the slug, anyone who registers a company called "qa-dev-tenant" (or "QA Dev Tenant") obtains that slug and becomes the
tenant the role would read. In the real development database the slug is already taken by the QA tenant, so this path is closed there **as long as that tenant
keeps the slug**; to point the role at another tenant someone with SQL access must first rename the QA tenant (the role then sees nothing — fail closed) and then
rename the other. While the role is `NOLOGIN`, none of this exposes anything.

| | A — keep the slug | B — immutable tenant id | C — controlled scope configuration |
|---|---|---|---|
| Idea | current view (`slug = 'qa-dev-tenant' AND status = 'active'`) | view filters `t.id = '<uuid>'` | a table `qa_readonly_scope_config` (one row, tenant id) owned by `app_migrator`, no grant to any `app_*` role or to `app_qa_readonly`; the view joins it to `tenants` |
| Advantage | exists, tested on 16.15/18.4, works on any install, fails closed | immune to rename and to slug squatting | empty by default → **closed on every new install until a privileged operator sets it**; immune to slug squatting and rename; the id is chosen deliberately |
| Risk | slug squatting where the QA tenant is absent; unaudited rename; pin is a human-readable string | **cannot be written in the migration**: the id differs per installation (UUIDv7 generated at registration) and does not exist on a fresh install; a constant would be dead code or, worse, a predetermined id | one more table (schema/RLS-coverage tests enumerate tables: 54 → 55, `TENANT_TABLE_NAMES`, pg-verify "45 tenant-owned" counts must be reviewed — it is platform-scoped, no RLS, like `tenants`); the row is data, set outside the migration |
| Complexity | none | not feasible as a migration constant | moderate: new table + grants + view change + a privileged "set scope" step + tests |
| Fresh installs | works (and is squattable) | does not work | works (closed) |
| Migrations | already written | would need a post-step anyway | the post-step is a data operation by the migrator/superuser, never part of the migration; 0051 is unapplied, so it may still be amended without breaking the "never edit an applied migration" rule |
| Change procedure | rename tenants (SQL) | edit the view (new migration) | one privileged `UPDATE`/`INSERT` on the config row, recorded in the operator's log |
| Verifiable | tested | — | testable: with no row → no rows; row = tenant A → only A; rename of the tenant → still A; the role cannot read or write the table |

**Recommendation: A is acceptable only while the role is `NOLOGIN` and 0051 is not applied; before `LOGIN` is ever enabled, move to C** (or an equivalent
that pins the tenant by **id**, set by a privileged operator outside the migration). B alone is rejected because an id cannot be fixed in a migration that must
also work on installations where the tenant does not exist. **0051 is not changed in this phase**: C touches the table inventory and several count-based tests and
deserves its own phase with review, and the current design remains safe in its present state (role NOLOGIN, unapplied). Interim control if the owner decides to apply
0051 before C: immediately before enabling `LOGIN`, run `SELECT id, slug, status FROM qa_readonly_scope s JOIN tenants t ON t.id = s.tenant_id;` as a privileged
operator and confirm that the id is the QA tenant the owner expects (a pre-flight, not a control).

### 10.2 `tenant_memberships`

Decision: **keep the limitation (no SELECT).** The aggregate view was analysed and is **not recommended as a default**: (a) it reveals, for each identity of the scoped
tenant, how many active memberships exist elsewhere — a cross-tenant fact (an identity with *k* memberships is part of *k−1* other tenants), and combined with
`qa_readonly_tenant` and `users.email` it relates a readable login to the existence of external tenants (never their ids or names, if the view returns only the
count and no `identity_id`); (b) a view exposing only `count` for the whole scope (no identifiers, no `GROUP BY identity_id`) would hide *which* identity but still
answer "does any QA identity have more than one membership"; (c) it is a privileged-owner object reading an RLS-less table, i.e. exactly the shape that must be
reviewed on every change; (d) B4.10 never *needed* it: the seed's own login already reports `tenant_selection_required` when an identity has several active
memberships, which is the check that matters for the seed. **Therefore the role does not verify membership counts**, and no document may claim it does. If an
operator needs this fact it should be obtained by a **privileged, audited, one-off procedure** (a superuser/migrator query by a named person, logged), not through
this role. The view stays as a documented option for an independent decision.

### 10.3 Implicit PUBLIC capabilities

Practical risk for the intended use (a read-only diagnostic on a development machine, at most 2 connections, `statement_timeout 30s`,
`idle_in_transaction_session_timeout 60s`):
- **Temporary tables / large objects / `pg_notify`:** the temp tables live in the session's own schema and vanish with it; `lo_creat` creates an empty object that
  persists until removed (`pg_largeobject_metadata` grows by one row each — negligible, but not self-cleaning); `pg_notify` only reaches sessions that `LISTEN`. Resource
  consumption is bounded by 2 connections and the timeouts, not by privileges. The statement timeout does not limit temp-file disk use of a sort/hash spill; a deliberate
  abuse could fill disk — it is a development database and the role is operator-controlled, so accepted.
- **Advisory locks:** the one real interaction. The role (after turning its read-only default off) can take an advisory lock with any key; the migration wrapper holds
  a session advisory lock per database and waits up to `MIGRATOR_LOCK_TIMEOUT_SECONDS` (60 s). A held key could make the wrapper time out; it cannot corrupt anything, ends
  at disconnect and is bounded by `idle_in_transaction_session_timeout` only for transaction-scoped locks (session-level locks persist while the connection is
  idle). Mitigation procedure, not code: do not run migrations while a diagnostic session is open; `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE
  usename = 'app_qa_readonly';` by an operator; `NOLOGIN` does not kill existing sessions.
- **Two connections:** protects the server's `max_connections` from this role; a leaked session cannot starve the application pool.
No change to `PUBLIC` is proposed (it would affect every other role). Possible separate mitigation, **not applied**: a per-database
`REVOKE EXECUTE ON FUNCTION pg_advisory_lock(bigint) … FROM PUBLIC` is possible technically but changes behaviour for other roles and for the wrapper itself — rejected.

### 10.4 Historical risks (status after review; none resolved by this phase)

| Risk | Status | What is missing |
|---|---|---|
| QA password in public Git history | **open.** Present in `1283de8` and later commits and in earlier versions of `dev-server.ts`/`seed-qa-data.ts` (`OBS-DEV-CREDENTIAL-IN-SPEC`). "Public" refers to the repository's history as pushed; the pending register says it was local-only when written — whether it has since been pushed to a remote is not established here (`origin/develop` exists at the same HEAD). | rotation of the QA password in the real DB (needs authorization), and the owner's decision on history rewriting; neither done |
| Real SQL / S3 adapters of the image seed | **open**, tested only with in-memory fakes (`seed-test-product-images.core.spec.ts`, fakes for ports) | an integration run of the real adapters against a disposable PostgreSQL and a disposable S3-compatible server (never the existing MinIO) |
| `undici`/`fetch` redirect behaviour | **open**: `qa-http-client` is tested against a fake `fetch` implementing the redirect modes, not against the real runtime | a test with a local `node:http` server issuing 301/302/303/307/308 across origins, asserting the `Authorization`/cookie headers are not forwarded, run on the project's Node versions (20 in CI, 24 locally) |
| `pg-verify` hang (`MIG-CI-PGVERIFY-HANG`) | **open, root cause unknown** (two stalled runs, two complete runs; instrumentation `[debug]` kept; job logs not readable) | repeated CI runs and the `[debug]` lines; not diagnosed here (running pg-verify was out of scope) |
| Background shell `bo9318p3h` | **not touched.** Its output (read-only) shows two things: the `icacls` step that should restrict the backup directory's permissions **failed** (the path with `é` was mangled: "0 archivos procesados, 1 con error"), so **the backup ACL was not restricted by that command**; and `RESUME issued 2026-10-29 22:32:38`. The harness still lists it as running. | owner authorization and an independent review to decide whether to stop it and to re-apply the ACL correctly; unverified whether the development PostgreSQL is still the process the earlier command resumed |
| Backups on a single disk | **open**; there is no independent external copy | an off-disk, access-restricted copy and a restore test of it |

### 10.5 CI — what it would and would not do with these changes (static review of `.github/workflows/ci.yml`; **not executed remotely**)

- Jobs: `ci` (lint, typecheck, `pnpm test`, build), `migration-harness` (PostgreSQL 16.15 pinned by digest, server version verified on the running server, typecheck/lint/unit,
  SQL linter on the real migrations, `test:migration-harness`, `git diff --check HEAD~1 HEAD`), `pg-verify` (same image, `pg-verify verify`). Containers are named per run, bound to
  `127.0.0.1` on an ephemeral port, removed with `docker rm -f` of the job's own container (`if: always()`); there are no references to local directories.
- **0051 reaches them:** the journal/manifests are consistent (52 migrations). `ci` and `migration-harness` run `qa-readonly-role.repo.spec.ts` and the amended repo specs through
  `pnpm test`. `migration-harness` runs section 12 (0051 on the full folder: bootstrap applies it; incremental is refused) plus the frozen-prefix historical scenarios.
  `pg-verify` bootstraps from an empty database, so 0051 is applied in bootstrap mode; the following incremental run has nothing pending. By reading, the existing checks there tolerate the
  new objects (`relkind = 'r'` queries ignore views; the 45-tenant-table count and the 5-application-role query are unaffected; the policies are on existing tables).
  **This pg-verify path was not executed in this phase**, and the harness result is a local one on 16.15, not CI.
- **Not covered by CI:** the 38 isolation tests of `qa-readonly-role.embedded.test.ts` (`tools/pg-verify` `test:embedded` is not part of `pnpm test` nor of any job — it needs
  PostgreSQL binaries to create its own cluster). CI therefore verifies the static shape of the role and its creation, not the isolation behaviour. A future job could run it
  against the runner's `postgresql-16` binaries (version assertion included).
- Minor: the workflow's protected-port `case` lists `5432|55432|55433|55440` and not `55450|55470`; on a runner these ports are irrelevant (ephemeral container ports) and
  the harness' own `cluster.ts` already refuses them. Not changed.
- Pending, needs authorization: a push (or a PR) to run the workflow on GitHub; until then CI for this change is **pending, not approved**. `git diff --check HEAD~1 HEAD` only
  looks at the last commit, so it will run on whatever commit is eventually pushed.

### 10.6 Conditions for a future controlled enablement

All must hold, each needing the owner's explicit authorization: (1) a decision on §10.1 (C implemented and tested, or an explicit written acceptance of A); (2) the CI run
of this change green on GitHub (or an explicit decision to proceed without it); (3) a backup of the development database with restricted permissions and a verified restore
(the ACL step above failed once); (4) apply `0051` in bootstrap mode to the **development** database only, with no migration or diagnostic session running; (5) the §8
verification queries show exactly the expected state; (6) the password generated outside Git, `LOGIN` enabled only for the diagnostic session and reverted with `NOLOGIN` (and
`pg_terminate_backend`) afterwards; (7) a reviewed, read-only diagnostic tool with explicit column lists.

## 11. B4.11.3 — the scope is an immutable tenant UUID in a protected configuration (migration `0052`)

**State: implemented in `database/migrations/0052_qa_readonly_tenant_config.sql`; tested on disposable PostgreSQL 16.15 and 18.4; NOT applied to any real database; the table is empty; the role is `NOLOGIN`, has no password and no access.**
This is alternative C of §10.1.

### 11.1 Why the slug is gone

`tenants.slug` is derived from the company name and is a mutable attribute: a registration could claim it on a database without the QA tenant, and two renames could re-point the role at
another company (a test of B4.11 documented exactly that). The new scope depends on **nothing but a UUID** stored where only a privileged operator can write: renaming, re-slugging,
swapping slugs or changing a name never changes what the role reads (tested). The tenant's **status** still matters: a suspended or archived tenant is not readable (fail closed).

### 11.2 The configuration table `qa_readonly_tenant_config`

| Column | Meaning |
| --- | --- |
| `singleton boolean` PRIMARY KEY, default `true`, `CHECK (singleton)` | at most one row can ever exist |
| `authorized_tenant_id uuid NOT NULL` → `tenants(id)` ON DELETE RESTRICT | the tenant the role may read; no default; an unknown UUID cannot be stored; the tenant cannot be deleted while configured |
| `configured_by text NOT NULL DEFAULT session_user`, `configured_at timestamptz NOT NULL DEFAULT now()` | who and when (database session user, not an application user) |
| `reason text NOT NULL` (not blank) | why |

- **Empty after every migration.** `0052` inserts nothing, looks nothing up, and does not assume that a QA tenant exists.
- Named `authorized_tenant_id`, not `tenant_id`: it is configuration *about* a tenant, not tenant-owned data. **No RLS**: access is by GRANT alone, like `tenants`/`platform_admins`.
- **Ownership and privileges (checked from the catalogs and by real attempts):** owner `app_migrator` (the project's DDL identity). **No role has any privilege on it** — `app_tenant`, `app_platform`,
  `app_import_worker`, `app_event_processor`, `app_public_resolver`, `app_qa_readonly`, nor PUBLIC (the project has no default privileges). Even the owner has `INSERT, UPDATE, DELETE, TRUNCATE`
  **revoked** (it keeps `SELECT`, which the views need, plus `REFERENCES`/`TRIGGER`), so a later migration or a stray `app_migrator` session cannot change the scope by accident. Honest limit: the owner can
  re-grant itself the privilege, and any session able to `SET ROLE app_migrator` (the incremental login) is a member of that identity — the deliberate path is §11.4, as the bootstrap superuser.
- **No `SECURITY DEFINER`, no function.** A view runs with its owner's privileges, so `app_qa_readonly` needs no grant on this table or on `tenants`.

### 11.3 The views (final definitions)

```sql
CREATE OR REPLACE VIEW qa_readonly_scope WITH (security_barrier = true) AS
  SELECT c.authorized_tenant_id AS tenant_id
  FROM qa_readonly_tenant_config c JOIN tenants t ON t.id = c.authorized_tenant_id
  WHERE t.status = 'active';
CREATE OR REPLACE VIEW qa_readonly_tenant WITH (security_barrier = true) AS
  SELECT t.id, t.name, t.slug, t.status
  FROM qa_readonly_tenant_config c JOIN tenants t ON t.id = c.authorized_tenant_id;
```

`CREATE OR REPLACE` keeps each view's OID, owner (`app_migrator`) and the `GRANT SELECT` to the role, so **the 27 policies of `0051` are untouched and still depend on the same view by OID** (tested: same OID before/after,
27 dependencies). Neither view consults `slug` to decide anything (`qa_readonly_tenant` merely *shows* name/slug/status of the configured tenant, including a suspended one, so a diagnostician sees why nothing is readable).
Results: empty configuration, unknown/suspended/archived tenant → **no row**, so every policy compares with NULL and the role reads nothing. A join view is no longer updatable at all (before: refused for lack of privilege; now `55000`).

### 11.4 Future procedure to set the tenant — NOT executed, not automated, no endpoint

A privileged, explicit, one-off operation, run **as the bootstrap superuser, in a psql session opened by the owner**, never through the application, HTTP, a seed or a session variable:

1. Identify the tenant by its **UUID**, read from the target database by a person (`SELECT id, name, slug, status FROM tenants WHERE id = '<uuid>';`). Never select it by slug in the statement that writes the configuration, and
   never reuse a UUID from another database: ids are generated per installation.
2. Confirm that it exists and is `active` (the foreign key enforces existence; the view enforces `active`), and that the configuration is empty: `SELECT * FROM qa_readonly_tenant_config;` (a second row is impossible;
   to *replace* a configuration, `UPDATE` the single row — the table keeps only the latest, so the operator records the previous value in the change record).
3. `INSERT INTO qa_readonly_tenant_config (authorized_tenant_id, reason) VALUES ('<uuid>', '<reason and change reference>');` — `configured_by`/`configured_at` fill themselves. No `GRANT` is needed and none must be added: a superuser writes it.
4. Verify: `SELECT * FROM qa_readonly_scope;` returns exactly that UUID; `SELECT count(*) FROM pg_policies WHERE 'app_qa_readonly' = ANY (roles);` is 27; `app_qa_readonly` is still `NOLOGIN`.
5. The operator records the change in the project's change record; no application audit row is written (there is no application path). Enabling `LOGIN` remains a **separate** authorization (§8, §10.6).

To switch the scope off: `DELETE FROM qa_readonly_tenant_config;` (as superuser) — the role instantly reads nothing.

### 11.5 What was proved (PostgreSQL 16.15 and 18.4, both 46/46 in `qa-readonly-role.embedded.test.ts`; migration harness 145/145 on 16.15)

- **Empty by default:** after all migrations the table has 0 rows, both views 0 rows, the role (given a temporary login by the test) reads 0 rows from every one of the 27 tables, even after `SET app.tenant_id`.
- **Configured explicitly (as superuser, by UUID):** the view returns exactly that tenant; the role reads only its data; the second tenant and the suspended tenant are invisible by filter, id, JOIN and UNION.
- **Manipulation by the role:** cannot read, insert, update, delete, truncate, drop, re-own the table, add RLS, replace/drop the view, alter a policy, `SET ROLE`, change `app.tenant_id`/`set_config`, nor redirect through a
  `pg_temp` look-alike of the configuration with `search_path`. No other `app_*` role (really attempted with `SET ROLE`) and not PUBLIC has any privilege; `app_migrator` cannot write it either.
- **Tenant attributes:** renaming a tenant, changing its slug, and giving its old slug to another tenant leave the scope unchanged; suspending it removes access; reactivating restores the same tenant only.
- **Invalid configurations:** unknown UUID (FK), duplicate (PK), `singleton = false`, missing tenant/reason (NOT NULL), blank reason (CHECK), deleting a configured tenant — all refused; a suspended or archived configured tenant is stored but yields no access.
- **Migration machinery:** `0052` is *ordinary* (classified in `history-manifest.json`, not in `privileged-manifest.json`); the harness proves a fresh bootstrap applies it and that the **limited incremental login** applies it over a database that already has `0051`;
  SQL lint: 0 errors, one expected WARNING (`PRIV-REVOKE`, the deliberate revoke); the repo guard `qa-readonly-role.repo.spec.ts` now also fails if `0052` seeds the table, grants on it, filters a view by slug/name or adds a function.

### 11.6 Remaining limitations

- Whoever is the superuser/bootstrap identity (or can `SET ROLE app_migrator` and re-grant) can change the scope; that is the privileged path by design, and there is no database audit of it beyond `configured_by/at` of the latest row.
- The configuration is per database; the role is cluster-wide. Enabling `LOGIN` in one database of a cluster makes the role able to connect to the others, where it sees nothing unless that database was configured too.
- `tenant_memberships`, the PUBLIC capabilities (§10.2–10.3) and the pending CI run on GitHub (§10.5) are unchanged. For §10.6 (1): the decision on §10.1 is **C, implemented** — still unapplied.

## 12. B4.11.5 — the isolation tests in CI (prepared; the remote workflow has NOT been run)

- **Job:** `qa-readonly-isolation` in `.github/workflows/ci.yml` — one more job with the same pinned image (`postgres:16.15@sha256:…`), its own container and a fresh server, because the migrations create cluster-wide roles. The existing jobs were not changed except the structural expectations of `ci-workflow.spec.ts` (3 PostgreSQL jobs, 4 installs).
- **Command:** `pnpm --filter @saas-inventory/pg-verify test:qa-readonly` with `QA_RO_SERVER_URL` / `QA_RO_EXPECTED_SERVER_VERSION_NUM=160015` (the job sets both; the password is generated at run time and masked).
- **Covers:** the 51 tests (46 of §11.5 + 5 of §12.1) plus role creation attributes, no password/memberships/ownership, 27 policies by OID, empty configuration, UUID scope, slug/name/status changes, and the evasion attempts — all against the real server. The bootstrap → incremental `0051 → 0052` scenario stays in the `migration-harness` job.
- **Cleanup:** the test drops only the database it created; the job removes only its own container and fails if it still exists. No name-based process killing, no global deletes.
- **Permissions:** workflow-level `contents: read` only (enforced by `ci-workflow.spec.ts`); no secrets, no deployment, no `.env`; artifacts only on failure (container log tail and a test log without lines mentioning "password").
- **Local vs CI:** locally the test builds its own cluster (`QA_RO_PG16_BIN`, or the embedded 18.4 package); in CI it talks to the container. Same test file, same assertions.
- **Limitations:** the workflow YAML was checked only by `ci-workflow.spec.ts` (text) and by running the same test against a local disposable 16.15 server in the CI mode; no YAML parser was available and GitHub Actions was not run, so the job is **pending, not approved**. The test applies the migration SQL over one superuser connection (not through the wrapper), as before.

### 12.1 B4.11.5.1 — password, the 27 policies one by one, YAML, lint (local evidence; GitHub Actions still NOT run)

- **No password, from the real catalog.** `pg_authid.rolpassword IS NULL` (the hash is never selected into the output), `rolvaliduntil IS NULL`, `rolcanlogin = false`, no privileged attribute, no membership in either direction — checked on the role the migrations CREATE. **Known residual, tested and documented, 0051 unchanged:** if a role of that name already existed with `LOGIN` and a password (roles are cluster-wide), 0051 normalises its attributes but never its credentials, so it keeps both; the test `with-residual-password` proves that.
- **The 27 policies, individually** (`verifyQaPolicies()`): read from `pg_policy` ⨝ `pg_class` ⨝ `pg_namespace`, `pg_roles` (via `polroles`), `pg_get_expr` (USING / WITH CHECK) and `pg_depend`. For **every policy that applies to the role or to PUBLIC** (so an extra permissive policy is caught, not only a weakened one) it requires: the table set equals the 27 planned tables with exactly one policy each; schema `public`; name `<table>_qa_readonly_select`; command SELECT; PERMISSIVE; roles exactly `{app_qa_readonly}`; no WITH CHECK; USING exactly `tenant_id = (SELECT s.tenant_id FROM qa_readonly_scope s)` (whitespace-normalised); a `pg_depend` row on the scope view's OID; RLS enabled **and** forced. A second test runs `EXPLAIN` as the role (`SET LOCAL ROLE`) on each of the 27 tables and requires the tenant filter reading `qa_readonly_tenant_config` in the plan. A third proves the checker is not vacuous: `USING (true)`, an extra policy TO PUBLIC, an extra policy TO the role, a dropped policy, a policy recreated FOR ALL, `NO FORCE` and a USING on a fixed UUID are each applied inside a rolled-back transaction and must be reported. Result: **27/27 verified, 0 NOT VERIFIED.** Row-level behaviour on data is covered by the existing tests (tables with synthetic data) — the EXPLAIN check is what covers the other tables, whose synthetic tables are empty.
- **YAML:** `.github/workflows/ci.yml` was parsed with a real YAML parser (js-yaml 4.3.1, already in the lockfile as a transitive dependency; a one-off script, **no dependency added**): 4 jobs; workflow `permissions: {contents: read}`, none per job; `qa-readonly-isolation`: `ubuntu-latest`, `timeout-minutes: 20`, no `needs`/`if`/`services`/`environment`/`container`, image `postgres:16.15@sha256:…`, `EXPECTED_SERVER_VERSION_NUM 160015`, loopback ephemeral port with protected ports refused, masked random password and URL, version checked before the tests, test command and working directory, diagnostics/upload only on `failure() || cancelled()`, cleanup `if: always()` that fails if the container remains; no `secrets.`, write permission, `.env`, `latest`, deployment or global/destructive command. 26/26 checks passed. The text-level `ci-workflow.spec.ts` stays as the permanent guard.
- **ESLint:** `pnpm exec eslint qa-readonly-role.embedded.test.ts` in `tools/pg-verify` → exit code 0, no output.
- **Direct SQL vs the wrapper.** `qa-readonly-role.embedded.test.ts` applies the migration files statement by statement over one superuser connection; it proves what the **resulting schema** does, not that the wrapper produces it. The wrapper is exercised by the `migration-harness` job (section 12): a fresh bootstrap of the full folder, and the limited incremental login applying `0052` over a database that already has `0051` (same view OID, 27 policies counted, empty configuration, no privilege for any role on it, the role `NOLOGIN` with `rolpassword IS NULL`). That covers the incremental scenario sufficiently; it was not duplicated. **Pending gap, not closed:** the harness asserts the *count* of 27 policies, not each policy's definition, and the behavioural tests are not run against a database migrated *by the wrapper*; if the wrapper ever altered the SQL it executes, only the harness's coarser checks would notice. **Closed locally by B4.11.5.2 (§12.2).**

### 12.2 B4.11.5.2 — the isolation suite against databases migrated BY THE WRAPPER (gap of §12.1 closed, locally)

- **Where:** section 13 of `apps/api/test/migration-harness/wrapper.harness.test.ts` (job `migration-harness`; no change to `ci.yml`, no new container, no duplicated run — `qa-readonly-isolation` keeps the *direct SQL* mode, `migration-harness` now runs the *wrapper* mode of the same file). It reuses the wrapper (`runMigrations`: manifests, journal, ownership/RLS invariants, lock, SQL lint, registry) exactly as the other sections do; no second wrapper, no migration edited.
- **How the suite is reused, not copied:** the harness starts `tools/pg-verify/qa-readonly-role.embedded.test.ts` as a child process with `QA_RO_PREMIGRATED_DATABASE=<db>`. In this "wrapper mode" the suite applies no migration and runs the same assertions — including `verifyQaPolicies()` (27 policies, one by one) and the mutation tests — on the database the wrapper made. Guards: loopback, unprotected port, superuser, database named `qa_ro_wrap_*`, **its COMMENT equals a random per-run token** the harness generated (so a database that merely has such a name is refused), no tenant and an empty `qa_readonly_tenant_config` at the start, role `NOLOGIN` without password at the start. The suite resets the role (`NOLOGIN PASSWORD NULL`) when it ends, and the harness asserts it. Output is checked for the token, the incremental password and any `postgres://`.
- **Scenario A:** wrapper **bootstrap** of the full folder → 53 migrations, registry = journal, configuration empty, role `NOLOGIN`/no password/no expiry/no privileged attribute → suite: 51 tests, 47 pass, 0 fail, 4 skipped, `verifyQaPolicies: 27 policies verified individually, 0 problems`.
- **Scenario B:** wrapper bootstrap **to 0051** → OIDs captured (scope view, tenant view, all policies of the 27 tables: 58) → wrapper **incremental login** applies **0052** (1 migration) → the same OIDs, configuration empty → suite: 51 tests, 48 pass, 0 fail, 3 skipped, same `verifyQaPolicies` line. 
- **Skipped on purpose (7 of 102 test executions, never silently):** the 3 tests that apply the 0051 *text* to a pristine cluster to see how it treats a pre-existing role (`superuser`, `bypassrls`, member, owner, benign, residual-password scenarios) cannot run on a finished database, because the role is cluster-wide and already exists; they stay in direct mode (51/51 there, on 16.15 and 18.4). In scenario A the "view REPLACED, same OID" test is also skipped (it needs the OID between 0051 and 0052, which scenario B captures and passes in). Cluster note: by section 13 the cluster already holds the role (created by section 12), so both databases meet an existing NOLOGIN, password-less role; its creation path is asserted by section 12 and by direct mode.
- **Result (PostgreSQL 16.15, harness 147/147):** the wrapper-produced schema satisfies the same isolation controls (attributes, no password, empty configuration, UUID scope, slug/name/status changes, 27 policies, OID dependencies, `app.tenant_id`/`set_config`/`SET ROLE`/`search_path`/temporary-table/JOIN/UNION attacks, direct access to the configuration, policy mutations) as the directly-applied SQL. **PostgreSQL 18.4:** the harness is specified for 16.x (it asserts the major version) and was *not* run in wrapper mode; 18.4 remains covered in direct mode (51/51).
- **Still open:** the remote GitHub Actions run of `migration-harness` (it spawns `pnpm exec node --import tsx` from `tools/pg-verify`, which the frozen install provides, but this was only run locally); and the 7 skips above.

### 12.3 B4.11.5.3 — review before the first remote run (local only; GitHub Actions still NOT run)

- **Frozen install, clean room:** the workspace manifests, `pnpm-lock.yaml` and `pnpm-workspace.yaml` were copied to a new temporary directory and `pnpm install --frozen-lockfile --offline --ignore-scripts` succeeded (831 packages, 0 downloaded). From `tools/pg-verify` of that tree `node --import tsx`, `import('embedded-postgres')` and `postgres` resolved: `tsx`, `embedded-postgres` and `postgres` are declared in `tools/pg-verify/package.json` and present in the lockfile (including the `linux-x64` embedded binary). No lockfile change, no global install, no `.env`.
- **Child process:** section 13 now starts `process.execPath --import tsx --test --test-reporter=spec qa-readonly-role.embedded.test.ts` with `cwd = tools/pg-verify` (no shell, no pnpm wrapper — `pnpm exec` only adds `.bin` to PATH; `tsx` resolves from the cwd) and `killSignal: SIGKILL`, so a timeout kills the child itself (verified: a hung child was killed in 4 s, `ETIMEDOUT`, no `node` process left). `--test-reporter=spec` is explicit because Node 20 (the CI version) prints TAP when stdout is not a TTY; the parser accepts both `ℹ tests N` and `# tests N`, and the workflow Summary step greps both. The environment given to the child is the caller's minus `PG*`, `MIGRATOR_*`, `MIGRATION_HARNESS_*`, `QA_RO_*`, plus only: the harness server URL (loopback), `QA_RO_PREMIGRATED_DATABASE`, the per-run token, the expected version number.
- **Failure propagation (tried):** wrong or missing token, a database not named `qa_ro_wrap_*`, a database of another run, a protected port and a non-loopback host all end with exit code 1 and the reason in the output; the harness asserts `status`, `tests`, `fail` and `pass + skipped` and now attaches the last 2.5 KB of the child output to that assertion. An `afterAll` puts the cluster-wide role back to `NOLOGIN PASSWORD NULL` even if the child was killed before its own cleanup. The suite no longer creates a temporary directory when a server is supplied (a killed run left an empty `pgv-qa-ro-*` once; fixed).
- **CI conditions simulated:** the whole harness run against an **external** disposable PostgreSQL 16.15 (loopback, ephemeral port, random password, fresh server) via `MIGRATION_HARNESS_SERVER_URL`, the exact attach path of the `migration-harness` job: 147/147; and in own-cluster mode: 147/147; sections 13A/13B as in §12.2. **Not reproduced:** Linux, Node 20, the GitHub-hosted runner, the Docker container itself, the real `pnpm install` of the runner and its cache. Those remain unverified until the first remote run.
- **`ci.yml`:** one change only — the Summary grep also accepts the TAP form; YAML parsed with js-yaml (26/26 checks) and `ci-workflow.spec.ts` passes.
