# pg-verify — local development and testing environments

This package runs a real, Docker-free PostgreSQL (`embedded-postgres`). It serves **two separate environments** (D-8E.24; the
architecture is in [docs/architecture/environments.md](../../docs/architecture/environments.md)). They never share a data
directory, a port or a database name, and the testing side cannot delete anything of the development side.

| | Development | Testing |
|---|---|---|
| Purpose | Daily work, manual QA, data you want to keep | Verification: migrations, RLS, roles, integration suites |
| Data | **Persistent** — `scratchpad/.dev-pgdata` (or `DEV_PGDATA_DIR`) | **Disposable** — `tools/pg-verify/.verify-pgdata` |
| Database / port | `saas_inventory_dev` / the port of `MIGRATOR_BOOTSTRAP_DATABASE_URL` (55432 today) | `saas_inventory_verify` / `PG_VERIFY_PORT` (default **55450**) |
| Start | `pnpm --filter @saas-inventory/pg-verify dev` | `pnpm --filter @saas-inventory/pg-verify verify` |
| Deleted by | **Nothing in this repository.** Only you, on purpose, after a backup | Every `verify` run, or `test:db:reset` |
| Seeds | Only what you run (`seed:qa`); never automatic | Fixed, fictitious, inside `verify-real-postgres.ts` |

## Development

```sh
pnpm --filter @saas-inventory/pg-verify dev        # PostgreSQL + dev S3 shim + API + Web
pnpm --filter @saas-inventory/pg-verify dev:db     # only the PostgreSQL, from the existing data directory
pnpm --filter @saas-inventory/pg-verify seed:qa --check   # inspect the QA tenant (needs QA_SEED_TENANT_SLUG); add --yes to write (see below)
```

- `dev` creates the data directory **only if it is missing or empty**. `PG_VERSION` alone does not mean the cluster is usable, so two marker files
  **next to** the directory record the real progress: `<dir>.initializing` (before `initdb`) and `<dir>.initialized` (written only after the server
  answered, it owns this directory and the database exists). What `dev` does:

  | State of the directory | Result |
  |---|---|
  | missing or empty | creates it, verifies it, writes `.initialized` |
  | PostgreSQL + `.initialized` | starts it as it is and verifies it (migrations run on top; nothing is re-seeded) |
  | PostgreSQL + `.initializing` only (a failed first start) | **refuses**, touching nothing. `dev --finish-init` starts it, creates the database if missing, verifies it and completes the marker |
  | PostgreSQL without any marker (older tool, or by hand — **this includes the current `scratchpad/.dev-pgdata`**) | **refuses**, touching nothing. `dev --adopt` starts it, checks that the database exists, and only then writes `.initialized` |
  | not empty and not PostgreSQL, or the port is in use | **refuses**, touching nothing |

  Nothing in `dev` ever deletes a directory, including after a failure. `--finish-init` and `--adopt` never delete or modify the data; they need the
  port free (stop the running server first, e.g. the one started by `dev:db`).
- Ctrl+C stops the processes and PostgreSQL. **The data stays on disk**, as does the dev S3 shim data (`scratchpad/s3data`, product images).
- The QA administrator is registered **only on the first start of a new, empty directory**. `QA_ADMIN_PASSWORD` (12–128 characters) is
  required in the environment or in the git-ignored root `.env`; there is no default, and it is never printed. `QA_ADMIN_EMAIL`
  defaults to `qa-admin@dev.local`. `seed:qa` reads the same variables and only logs in; it does not create or change the account.
- To start from scratch you delete the directory yourself. Never run `git clean -x`/`git stash -u` while the database is running.

### `seed:qa` — the QA seed (hardened in D-8E.26-B4.1)

`seed:qa` fills the QA tenant with a connected dataset (warehouses, products, stock, images, QR, customers, orders, returns, transfers) through the
real HTTP API. It can no longer pick a tenant on its own, write without confirmation, or add data twice.

**Configure the tenant explicitly** (environment or the git-ignored `.env`; names only here, never values in Git):

| Variable | Meaning |
|---|---|
| `QA_SEED_TENANT_SLUG` | **Required, no default.** The only tenant the seed may act on (today `qa-dev-tenant`). The old `qa-tenant` is not a fallback. |
| `QA_ADMIN_EMAIL`, `QA_ADMIN_PASSWORD` | The QA account the seed logs in as (the password is required and is never printed). |
| `QA_SEED_API_URL` | Optional. Must still be `127.0.0.1` or `localhost`; a remote URL is refused, there is no switch to allow one. |

**Three ways to run it** (always `pnpm --filter @saas-inventory/pg-verify seed:qa <flags>`, with `dev` running):

| Flags | What happens |
|---|---|
| `--check` | Inspection: logs in, verifies the tenant and prints what exists and what is missing. **It writes no seed data** — after the login every request is a GET. This is enforced in three places, not by control flow alone: `guardApi` refuses any non-GET call, `guardUpload` refuses the image upload, and the HTTP client of a `--check` run is created read-only (`createHttpClient(..., { readOnly: true })`), so at the network edge it can send only GET and the login POST. It is **not an absolute read-only mode**: the login is the backend's normal authentication and it may update the account's last-login metadata and create a session (a refresh-token row). `--yes` is not accepted. |
| `--create --yes` | Initial build. Allowed **only if the tenant has no operational data** (no products, warehouses, customers, orders or movements); otherwise it refuses and writes nothing. |
| `--yes` | Normal run: creates **only what is missing** and leaves everything else as it is. |

A run without `--yes` (other than `--check`) is refused. Before the first request it also checks: the flags, the slug, that the API is loopback, and the credentials. After
login it checks that **the session and `GET /tenant` both report exactly `QA_SEED_TENANT_SLUG` and that the tenant is active**. It stops, with nothing written, if the account
has more than one active membership (it never chooses), if the tenant is suspended (it never reactivates it), or if the login produces no session (inactive membership).
It never calls registration, identity, membership, password or platform endpoints, and never PATCHes or DELETEs existing data (the only PATCHes are the activation of a product or the discontinuation of a variant that the same run has just created).

**Redirects are never followed.** The loopback check applies to the URL you configure, but `fetch` follows redirects by default, so a local service answering 307/308 could forward the login (with the QA credentials in its body) to another host. Every request of the CLI goes through one function in `qa-http-client.ts` that forces `redirect: "error"`; a redirect stops the run with a message that contains no password, cookie or header, and nothing is sent to the redirect target. The same applies to the image upload.

**What is idempotent.** Records are recognised by a stable key or by a marker the seed wrote, and are created only if missing:
warehouses and locations (name + code), categories (**name + the seed's reserved code**, see below), products and variants (**by SKU**, see below), customers (name + tax id; created complete, **never patched**),
the initial stock (a `RECEIPT` whose `reason` is `seed-qa:v1:stock`; the first version's reason is also recognised), product images (only a product with none),
QR codes (only a variant with none) and the two transfers (`notes` starting `seed-qa:v1:transfer-N`; the first version's notes are also recognised).
Orders carry no marker: if either seed customer already has orders the seed **skips** the orders and returns block and creates none (it cannot prove they are its own);
the returns only run on orders created by that same run.

**What marks a category as the seed's (B4).** The seed creates its two categories with the reserved codes `QA-SEED-FERRETERIA` and `QA-SEED-ELECTRONICA` (categories have a client-settable code, unique per tenant). A category is reused only if **both** its code and its name (the backend stores names in uppercase, so they are compared case-insensitively) match. A category with the same name but another code — including one with an automatic `CAT-nnn` code, and one the first versions of this seed created — is **not provably the seed's**: the run stops and writes nothing further. Resolve it by hand (rename or recode it, or leave it), never by the seed. A code held by a category with another name, several candidates, or a list whose categories do not all report name and code, also stop the run.

**How a product is recognised (B4.6): by SKU, not by name.** The backend stores product and category names as `name.trim().toUpperCase()` (`catalog/upper-name.ts`), so the text the seed sends ("Casco de Seguridad") never equals what it reads back ("CASCO DE SEGURIDAD"); comparing names exactly made a second run miss its own products and try to create them again (a SKU conflict, 409). The SKU is unique per tenant, so it is the identity: the seed asks the products list for the SKU, for the name as the backend stores it, and for the name's longest plain-ASCII word (`q` is an `ILIKE` substring over name, SKU and barcode: case-insensitive but never accent-insensitive, and in a C-locale database it does not even fold `Á`/`á` — so a name typed with other accents is caught by the ASCII word and compared in code with case and accents folded), reads the variants of every candidate, and classifies each seed product as:
- **SKU held by a compatible product** → reused, nothing written. Compatible means: same name after the backend's normalisation, the seed's category (the reserved-code category above), and the same `maxPrice`/`basePrice`, plus `minPrice`/`cost` when the account can see them.
- **SKU held by an incompatible product** (another name, category or price) → the run **stops**; the record is neither reused nor modified.
- **Several variants report the SKU, or a SKU differs only in letter case, or a product with the seed's name exists under another SKU** → the run **stops** (ambiguous; the seed neither reuses a namesake nor creates a second one).
- **No SKU and no namesake** → the product is created, the response must come back complete (id, the stored name, a variant with the SKU) or the run stops before activating or stocking it.
- **An incomplete answer** (a list without `meta.total`, variants that are not a list, a variant without prices, a product without id or name) → stops; it is never judged.

A product that was soft-deleted is invisible to the list but still owns its SKU, so creating it fails with a 409 and the run stops (safe, needs a person). The same SKU-first rule is what `--check` prints (`present` / `missing` or a refusal).

**Request contracts (B4.9).** B4.8 found by reading the controllers that the seed sent three bodies the API answers 400 to (`whitelist` + `forbidNonWhitelisted` are on). They were fixed against the real DTOs, which are the source of truth:
- **Stock** — `POST /inventory/adjustments` with `movementType: 'RECEIPT'` **requires `unitCost`** (`create-adjustment.dto.ts`, `@ValidateIf`). The seed sends the cost it defined for the product (70 / 9 / 18 / 30 / 4): never 0, never a price. `ADJUSTMENT_IN` would default it, `ADJUSTMENT_OUT` ignores it.
- **Customers** — `POST /customers` takes `type` (`cedula` | `ruc` | `pasaporte`; taxId 10 digits / 13 digits / alphanumeric), **`firstName` and `lastName` (both required)**, `taxId`, `email`, `phone`, and `address` as **one text line**; there is no `displayName` on create (the backend derives it as `first last` and stores both names in Title Case). The two seed customers are therefore `cedula` Juan Pérez and a `ruc` customer "Ferretería" / "El Tornillo": the contract has no company-name field, and the former "S.A." suffix cannot be kept (standardisation would store it as `S.a.`). **This renaming of a fixture is a decision worth confirming**; the web form also asks every customer for "Nombres" and "Apellidos".
- **Confirming an order** — `POST /orders/:id/confirm` takes `payments` (≥ 1 of `{ paymentMethod: cash | transfer | card | other, amount > 0 }`) and the service rejects it unless `roundMoney(Σ amounts)` equals the order total exactly. The seed pays the **total the backend reported, once, in cash**, unchanged; a missing, non-positive or more-than-2-decimals total is not rounded or guessed — the order is simply not confirmed and the run stops.
- **Transfers** — a tenant may disable the approval and/or preparation gates (tenant settings), in which case creation already passes them. The seed now takes `approve` / `prepare` only when the transfer is at the status that step starts from, requires each answer to report the status it reached, dispatches with no `items` (= everything requested) and receives with `{ items: [{ transferItemId, quantityReceived }] }` and an `Idempotency-Key`; the service refuses over-receiving (more than dispatched − received), a wrong status, or an item that is not on the transfer. A transfer that is created already dispatched / received is not continued.

**These bodies are validated against the real DTO classes in the unit tests** (`qa-dto-contracts.ts` imports the DTO files from `apps/api` and validates with the same `class-validator` options as the API's `ValidationPipe`; no Nest module, database client or HTTP server is loaded). The fake API runs every body through them and answers 400 like the backend, so a DTO change or a wrong body fails a test instead of a seed run. `tools/pg-verify/tsconfig.json` therefore enables `experimentalDecorators` and includes the DTO files. **Rules that live in services rather than DTOs** (payments sum, receive quantities and statuses, unique tax id and SKU) are re-implemented in the fake, from reading the services — a **second source of truth that can drift**; a source-pin test covers the one function duplicated verbatim (`standardizeName`). None of this is an integration test: the real API, database and transitions have never been exercised.

**The open cart.** `POST /cart` is "create or get the active cart": if the QA account already has an open cart the backend returns that one and ignores the request body. The seed therefore checks every cart it receives (open, the requested location and customer, no lines) and stops, leaving the cart untouched, if it is anything else.

**Blocking records, recovery after an interrupted run, the pre-run checklist and what the fakes do and do not reproduce are in [QA-SEED-RUNBOOK.md](QA-SEED-RUNBOOK.md).** `--check` lists every record that would stop a writing run (id, code or SKU, name) and ends non-zero.

**What the QA account needs.** The QA account is the tenant's founding **Administrador**: it must hold `sales.orders.view_all` (it also holds the catalog, inventory, sales and returns permissions the steps use) and have an unrestricted location scope. `pricing.floor.view` / `pricing.cost.view` are not required — without them `minPrice`/`cost` are simply not compared.

**Why the order list must be proven complete (B5).** `GET /orders` is filtered by the backend twice, invisibly to the caller: without `sales.orders.view_all` it lists only the orders the caller placed, and a caller restricted to some locations lists only theirs (`orders.service.ts`, `order-seller-scope.ts`, `LocationAuthorizationService`). A short or empty list is therefore not proof that no order exists. Before **any write** of a `--create` or normal run the seed requires the session to report `sales.orders.view_all` and `GET /inventory/location-scope` (the caller's own scope) to report `unrestricted: true` (today only the founding Administrador). Otherwise it stops with nothing written; it grants and widens no permission to get past this. Every list is also checked to be complete (`meta.total` present and equal to the rows received; a customer filter must be honoured), and an incomplete, oversized or ambiguous answer stops the run. `--check` does not refuse on this: it prints `orders: NOT VERIFIABLE` and the reason.

**Existing or ambiguous records.** If a name or code matches but the record is not exactly the seed's (another code, another tax id, a product without the seed SKU, a seed
customer without phone or address, two candidates), the run **stops** with a message instead of reusing, patching or "repairing" it. An error mid-run also stops the run where it is:
there is no rollback and no repair; the next normal run completes only what is missing.

**Interrupted runs — what is and is not recoverable.** There is no global transaction: every call is its own request, and an error stops the run where it is (no rollback, no repair). A second run is safe and completes what is missing for: warehouses and locations, categories, products and variants, initial stock (marker `reason`), images, QR codes, customers and the two transfers (marker `notes`). It does **not** recover, and a person must look at it: (a) the **orders block** — orders carry no marker, so if the run died after creating some of the three orders, the next run sees orders for the seed customers, skips the whole orders-and-returns block and creates no more (the dataset stays incomplete rather than risk duplicates); (b) the **returns**, which only run on orders created by the same run; (c) a **transfer** that stopped between its create and its last transition (a `seed-qa:v1:transfer-N` marker exists, so it is not repeated, and it stays in whatever state it reached); (d) a product created but not yet activated or discontinued (the activation PATCH happens only in the run that created it); (e) a seed category, customer or product that exists but is not provably the seed's, which always needs manual resolution. So the seed is **idempotent for the catalog, stock, images, QR, customers and transfers' creation, and not idempotent across a partial orders / returns / transfer-lifecycle run**.

**Never against Mueblería Elegante or production.** The tenant is the one you name and it must be a QA tenant; the API must be on this machine. Do not point `QA_SEED_TENANT_SLUG`
at `muebleria-elegante` or at any tenant that is not QA data. The seed has no way to know a tenant's purpose: choosing the slug is your responsibility, and `--check` first is the safe habit. The image script is additionally pinned to `saas_inventory_dev` on port 55432 and the local S3 shim. **Running any of these seeds against a real environment is a separate decision that needs its own explicit authorization; the automated checks never do it.**

**`apps/api/src/database/seed-test-product-images.ts`** (a separate, older script that writes product images straight to the database) refuses to run unless, **before any connection or upload**:
`SEED_TENANT_SLUG` is set (no default; the `qa-tenant` default is gone) and is on the **fixed allowlist in code** (`qa-dev-tenant` only; `muebleria-elegante` and every other tenant are rejected and
no variable extends the list); `APP_PLATFORM_DATABASE_URL` and `DATABASE_URL` are the **same server and database** and that is the **development database exactly** — `saas_inventory_dev` on
port **55432** (the testing server 55450, a restored copy 55470, the other clusters 55433/55440 and the installed service 5432 are all refused, as is any unknown port; an explicit port is required;
multi-host URLs and URL parameters such as `host=` or `dbname=` are refused); `S3_ENDPOINT` is the local dev S3 shim (loopback, port **9000**, no credentials, no path); the tenant exists and is
active; and `--yes` is given. A product that already has an image is never touched; if none needs one, nothing is uploaded or written. Run:
`SEED_TENANT_SLUG=qa-dev-tenant pnpm --filter @saas-inventory/api exec tsx src/database/seed-test-product-images.ts --yes`.
The development port has no variable of its own (it lives in the git-ignored `.env`), so 55432 is fixed in the guard; if the development port ever changes, the guard must be changed on purpose.

Unit tests (`pnpm --filter @saas-inventory/pg-verify test`; `pnpm --filter @saas-inventory/api exec vitest run src/database/seed-test-product-images.guard.spec.ts src/database/seed-test-product-images.core.spec.ts`)
use in-memory fakes — a fake tenant API for the QA seed (whose product names go through the backend's real `upperName`, imported from `apps/api/src/catalog/upper-name.ts` rather than re-implemented; including partial lists, a missing `meta.total`, restricted sellers and scopes, uppercase category names and a 403 on the scope request), a fake `fetch` that implements the redirect modes for 301/302/303/307/308, and fake ports (tenant, products, a transactional store with
rollback, an object store) for the image seed. They start no PostgreSQL, API, web or S3 and open no connection. **Everything above about categories, order visibility and read-only enforcement is validated only against these fakes, never against the real API or PostgreSQL.** **Not covered by any automated test:** the real SQL and S3 adapters of the image
seed, and the real HTTP behaviour of the API behind the QA seed; those need a manual run on the development stack, which the automated checks never perform.

### `app_qa_readonly` (B4.11) — prepared, not applied

> B4.11.3: migration `0052` replaces the slug pin with an immutable tenant UUID in the empty-by-default table `qa_readonly_tenant_config` (docs/security/qa-readonly-role.md §11). `qa-readonly-role.embedded.test.ts` now has 51 tests and covers 0051 + 0052; `QA_RO_PG16_BIN=<PostgreSQL 16.15 bin>` runs it on 16.15 in its own temporary cluster. No UUID of a real tenant exists anywhere in the repository.
>
> **CI (B4.11.5, prepared — the remote workflow has NOT been run):** the job `qa-readonly-isolation` of `.github/workflows/ci.yml` starts its own `postgres:16.15@sha256:…` container (loopback, ephemeral port, random masked password), checks `server_version_num = 160015` on the running server, and runs `pnpm --filter @saas-inventory/pg-verify test:qa-readonly` with `QA_RO_SERVER_URL` (superuser URL of that container) and `QA_RO_EXPECTED_SERVER_VERSION_NUM=160015`. In that mode the test starts and stops nothing: it refuses a non-loopback host, a protected port, a non-superuser, or a server that is not **fresh** (any database besides `postgres`/templates, any role besides `postgres`/`pg_*` — the migrations create cluster-wide roles), creates its own database `qa_ro_test`, drops it at the end, and the job removes the container (`if: always()`, a failed removal fails the job). Locally, the same mode works against any disposable server you started yourself; a second run on the same server is refused as "not fresh" by design. The bootstrap → incremental `0051 → 0052` scenario is covered by the `migration-harness` job (section 12), not duplicated here. Diagnostics (container log tail and the test log with lines mentioning "password" removed) are uploaded only on failure; the step summary shows server version, migrations applied (53), `app_qa_readonly` policies (27) and the test counts (51).
>
> **Wrapper mode (B4.11.5.2):** the same file also runs as a child of the migration harness (section 13 of `apps/api/test/migration-harness/wrapper.harness.test.ts`) with `QA_RO_PREMIGRATED_DATABASE=qa_ro_wrap_*` + a per-run `QA_RO_HARNESS_TOKEN` (must equal the database COMMENT): it applies no migration and checks what the **wrapper** produced (full bootstrap, and bootstrap-to-0051 + incremental 0052). Three tests that need the migration text on a pristine cluster are skipped there and stay in direct mode. Not a command to run by hand: the harness creates and owns the databases.

Migration `0051` defines a read-only, tenant-pinned role for diagnosing `qa-dev-tenant` ([docs/security/qa-readonly-role.md](../../docs/security/qa-readonly-role.md), [ADR-0042](../../docs/decisions/0042-readonly-qa-diagnostic-role.md)). It has **not** been applied to any database and enables no access. `pnpm --filter @saas-inventory/pg-verify test:embedded` also runs `qa-readonly-role.embedded.test.ts` (38 tests): it starts its own temporary PostgreSQL (temp directory, random port 56200-56299, synthetic data, removed afterwards), applies the real migrations and attacks the role; it connects to nothing else. By default the server is the embedded PostgreSQL 18; with `QA_RO_PG16_BIN=<bin directory of an installed PostgreSQL 16.15>` it builds a NEW cluster with those binaries (`initdb`/`pg_ctl`, never the installed service or its data) and requires `server_version_num = 160015` — that is the reference-version run (38/38 passed on 16.15 in B4.11.1).

### Protect and recover development data

1. **Back up** before risky work: stop the database (`Ctrl+C`, or `pg_ctl stop`), copy the whole data directory **and**
   `scratchpad/s3data` to a folder outside the repository (for example `C:\Users\<you>\Backups\saas-inventory-dev\<date>\`), restrict its
   permissions to your user, and record a SHA-256 of the copy. A logical dump needs `pg_dump` of the **same major version** as the server
   (the embedded server is PostgreSQL 18; the bundled binaries do not include `pg_dump`).
2. **Recover:** with the database stopped, restore the copied directory over an empty `scratchpad/.dev-pgdata` (or point `DEV_PGDATA_DIR`
   at it) and run `dev:db`. Test a restore in another directory and port first.
3. **Move it out of the repository:** copy the stopped data directory to a permanent folder, set `DEV_PGDATA_DIR` to it, start with `dev:db`.

## Testing

```sh
pnpm --filter @saas-inventory/pg-verify verify            # build a fresh disposable server, run everything, tear it down
pnpm --filter @saas-inventory/pg-verify test:db:reset     # explicit rebuild: delete only .verify-pgdata (refuses if a server runs)
pnpm --filter @saas-inventory/pg-verify test              # unit tests: guards, QA credential loader, init state machine (pure, temp dirs)
pnpm --filter @saas-inventory/pg-verify test:embedded     # opt-in: the init/recovery flows against a REAL embedded server, in temp dirs on its own ports (~40 s)
```

`env-guard.ts` runs before anything is created or deleted (and `verify` also checks, once connected, that the server that answered owns the disposable
directory — the real destination, not only the declared one): it rejects the protected ports (5432, 55432, 55433, 55440), any database that is
not `saas_inventory_verify*`/`saas_inventory_test*`, any directory not named `.verify-pgdata`, anything that overlaps the development data
directory, and anything marked with a `.persistent` file. A name or a port alone is never accepted as proof. CI uses only disposable
databases (a fresh container per job, `PG_VERIFY_SERVER_URL`, or the embedded server) and never these development directories.

## Rebuild QA from scratch (development)

Only when you really want to discard the development data: back it up, stop the database, delete `scratchpad/.dev-pgdata` yourself, set
`QA_ADMIN_PASSWORD`, run `dev` (it creates a new database and registers the QA admin), then `seed:qa`.

> `app_qa_readonly` / migration `0051` (ADR-0042): prepared, **not applied**, `NOLOGIN`. The final risk review, the slug-pin decision and the conditions for a future
> enablement are in `docs/security/qa-readonly-role.md` §10. `test:embedded` (the role's 38 isolation tests) is not run by CI.
