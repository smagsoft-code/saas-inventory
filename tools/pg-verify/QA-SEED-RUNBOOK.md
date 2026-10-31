# QA seed — runbook: blocking records, recovery and pre-run checklist

Companion of [README.md](README.md) (D-8E.26-B4.7). Nothing in this document has been exercised against a real API, PostgreSQL or S3: the seed's behaviour
is covered by unit tests with in-memory fakes only (see §6). **Running any seed against a real environment needs its own explicit authorization.**

## 1. Rules that never change

- The seed never adopts, recodes, renames, merges, patches or deletes a record it did not create. If it cannot *prove* a record is its own, it stops and describes it.
- There is no global transaction and no automatic repair. An error stops the run where it is.
- Orders, returns and transfers are never re-created or "completed" automatically (that could duplicate sales, movements or stock).

## 2. Records that block a run, and what a person does

The seed's own records are recognised **only** by these keys; everything else that *resembles* them blocks the run.

| Record | The seed's own = | Blocks the run when |
|---|---|---|
| Category | reserved code `QA-SEED-FERRETERIA` / `QA-SEED-ELECTRONICA` **and** the exact name (compared as the backend stores it: `trim().toUpperCase()`) | same name (or the same name without accents) with another code — **this includes categories created by earlier versions of the seed, which had automatic `CAT-nnn` codes**; the reserved code with another name; two records matching |
| Product | SKU (`TAL-20V-001`, `CASCO-001`, `MULTI-001`, `CABLE-UTP6`, `LINT-001`, `GUANTE-M`) held by a product with the same normalised name, the seed's category, and the same `maxPrice`/`basePrice` (+ `minPrice`/`cost` when visible) | the SKU is held by anything else; a product with the seed's name (or without accents) exists under another SKU (including one with no variants); the SKU differs only in letter case; two variants report the SKU; a soft-deleted product keeps the SKU (the create answers 409) |
| Customer | display name (`first last`: Juan Pérez / Ferretería El Tornillo) **and** tax id `1710000001` (`cedula`) / `1790000000001` (`ruc`) **and** the same identification type | only one of name / tax id matches, or the type differs; phone or address missing (B4.9: the former "Ferretería El Tornillo S.A." customer from earlier seed versions no longer matches — its name differs) |
| Warehouse / location | name **and** code | only one matches |

`seed:qa --check` lists **every** blocking record (not just the first), each with its id, code/SKU and name, then ends non-zero. The text of each message ends with the
action: *resolve it by hand (rename or recode it yourself, or leave it and use another tenant)*.

Manual options for a blocking **category** (the seed does none of them): rename/recode it yourself so it is clearly not a seed category and let the seed create its own; or, if it truly *is* a
seed category from an earlier run, give it the reserved code and the exact name **by hand, as a deliberate decision** — then the seed will recognise it. Never delete a category that has products;
this runbook does not describe merging because the seed has no merge.

## 3. Name search and accents

The seed finds candidate products with `GET /products?q=…`, which is `ILIKE '%q%'` over the product name and the variants' SKU and barcode.

- `ILIKE` is case-insensitive and **never accent-insensitive**. Whether it folds the case of `á`/`Á` depends on the database's `LC_CTYPE`: a `--locale=C` cluster (the one `tools/pg-verify` builds for testing) folds ASCII letters only. The locale of the **development** cluster could not be checked from here.
- Consequence found in B4.7: B4.6 searched the name as typed (`Taladro Inalámbrico 20V`); the stored value is `TALADRO INALÁMBRICO 20V`; in a C locale they do **not** match. The seed's own product was still found (by SKU) but a namesake by name could have been missed.
- Fix: three locale-proof queries per product — the SKU; the name exactly as stored (`trim().toUpperCase()`, identical bytes match under any locale); and the longest plain-ASCII word (finds a namesake typed with other accents). The decision is made in code: namesakes are compared with case **and** accents folded (`NFD`, marks removed), so `INALAMBRICO` and `INALÁMBRICO` are the same name and block the run.
- Limits that remain: a product whose name shares **no** plain-ASCII word of ≥3 letters with the seed's cannot be reached by name search (the seed refuses to start for such a name; none of the six seed names has that problem); barcode matches only add candidates; results are paged and must reconcile with `meta.total` or the run stops.

## 4. Recovery after an interrupted run

Every case: **detect** with `seed:qa --check` plus the screens named below; the seed **repeats nothing** it cannot prove safe.

### 4.1 Orders (three orders: 1 confirmed, 2 pending invoice, 3 cancelled)

- Order of operations: open cart → add lines → create order → (confirm | cancel). Orders carry **no seed marker**.
- Interrupted after some orders exist → the next run finds orders for the seed customers (tax ids above), **skips the whole orders-and-returns block** and creates nothing (reported as `skipped: orders+returns`).
- Interrupted with lines in the cart but no order → the QA account keeps an **open cart** (`POST /cart` returns the existing one). The next run **stops** at the cart check ("already has an open cart") instead of mixing lines.
- Detect: orders list filtered by the two customers (needs `sales.orders.view_all`); the cart screen of the QA account.
- Safe to repeat: nothing. Manual: finish or cancel each seed order in the UI (expected end state: order 1 confirmed — 2 taladros + 3 cascos; order 2 pending invoice — 1 multímetro + 1 cable; order 3 cancelled — 1 casco), and complete or discard a leftover open cart. A pending order holds a stock reservation until confirmed or cancelled.
- Blocks continuation: an open cart that is not an empty cart for the seed's location and customer; orders of a customer that the seed cannot attribute to itself.

### 4.2 Returns (return 1 resolved with restock; return 2 left `requested`)

- Only created on orders created **in the same run**. If the run died after order 1 was confirmed but before its returns, the next run skips the returns (the orders exist, the block is skipped) and **will not create them**.
- Detect: returns list, filtered by order 1. Return 1 should be `resolved` (1 taladro restocked), return 2 `requested` (1 casco).
- Safe to repeat: nothing. Manual: inspect/resolve or cancel a return left in `requested`/`inspecting` through the returns screens; create a missing return by hand. A `resolved` return has already moved stock and cannot be undone.

### 4.3 Transfers (transfer 1: create → approve → prepare → dispatch → receive; transfer 2: create → approve)

- Recognised by the `notes` marker (`seed-qa:v1:transfer-N …`, or the first version's notes) **whatever state they reached**; a marker present means "skip".
- Detect: transfers list; the marker is in the notes. Statuses: created/approved/preparing → can still be completed or cancelled; **dispatched** → stock is in transit and the transfer cannot be cancelled, it must be received; **partially received** → receive the remainder.
- Safe to repeat: nothing (the seed does not retry a transition). Manual: complete the transition in the transfers screens. A transfer you **cancel keeps its marker**, so the seed will not create it again — create a replacement by hand if you need one.
- Blocks continuation: nothing blocks the run, but the dataset stays as the interruption left it.

### 4.4 Products, stock, images, QR

- Product created but not activated, or `LINT-001`'s variant not yet discontinued: the activation / discontinuation happens only in the run that created the product. A later run reuses the product by SKU (status is not compared) and does **not** apply it — set it by hand.
- Product created without all its variants: the missing `GUANTE-L` variant **is** added on the next run (SKU-based, safe to repeat).
- SKU occupied by an incompatible record: blocks (see §2); nothing is modified.
- Stock receipts (`seed-qa:v1:stock` reason), images (only a product with none) and QR codes (only a variant with none) are safe to repeat.

## 5. Checklist before a future real run

Legend — **S** static (no access to anything), **R** needs read access to a service, **W** modifies data, **A** needs the owner's separate explicit authorization.

| # | Check | Type |
|---|---|---|
| 1 | The target is exclusively the authorized QA tenant (`QA_SEED_TENANT_SLUG`), and the seed's tests and typecheck pass on the exact working tree | S |
| 2 | It is **not** Mueblería Elegante: the slug is not `muebleria-elegante`; for the image script the allowlist in code contains only `qa-dev-tenant` | S |
| 3 | The expected database is `saas_inventory_dev` on port 55432 (image script: both URLs identical; ports 55433/55440/55450/55470/5432 refused) | S (code) + R (that the running server is the intended one) |
| 4 | The S3 endpoint is the authorized local shim (loopback, explicit port 9000, no credentials, no path) | S (code) + R |
| 5 | The QA identity exists, is active, has exactly one active membership (the seed refuses otherwise), holds `sales.orders.view_all` and has an unrestricted location scope | R |
| 6 | `seed:qa --check` reports the orders as verifiable (not `NOT VERIFIABLE`) | R + A (the login writes last-login metadata and a session) |
| 7 | `--check` shows no blocking record; if it lists categories, products, customers or warehouses, they are resolved **by a person** first (§2) | R, then W done by a person |
| 8 | SKUs already taken, historical products/variants and soft-deleted products are reviewed (the 409 case cannot be seen from the list) | R |
| 9 | State of orders, returns and transfers of the seed customers/markers is reviewed (§4); no open cart on the QA account | R |
| 10 | A fresh, verified backup of the development database exists and the restore procedure is known (the backups so far are on one physical disk) | R/S + A |
| 11 | The development API (`nest start --watch`) and the dev S3 shim are running; the seed is not run while a migration or import is in progress | R |
| 12 | The owner authorizes the run in writing, naming the mode: `--check`, then (separately) `--create --yes` or `--yes` | **A** |
| 13 | The image script (`seed-test-product-images.ts`) is a separate action with its own authorization | **A**, W |

Items 6, 12 and 13 are the only ones that touch data or need permission; items 1-4 can be re-verified at any time without any service.

## 6. What the fakes reproduce — and what they do not

| Contract | In the fakes? |
|---|---|
| Name normalisation | **Yes — the real `upperName`** is imported from `apps/api/src/catalog/upper-name.ts` (a test also covers a backend that does not change case) |
| `ILIKE` over name / SKU | **Yes** since B4.7: case-insensitive, never accent-insensitive, C-locale and unicode variants. Barcode matching and trigram/collation specifics: no |
| Unique SKU per tenant, soft-deleted product keeping its SKU | Yes (409; a SKU hidden from the list) |
| Category `code` unique, name stored uppercase | Yes |
| `POST /cart` returns the vendor's existing open cart | Yes since B4.7 (it was **not** in B4.1–B4.6, which hid a real gap) |
| Pagination, `meta.total` | Partly: honours `page`/`pageSize` and total; no 100-row cap, no sort order. Faults (missing total, fewer/more rows than declared) are injected |
| Permissions, location scope | The login's `permissions` and `GET /inventory/location-scope` answer. `GET /orders` is **not** filtered by seller or location in the fake — the seed stops before reading it unless the account is unrestricted, so the filtering itself is untested |
| **Request bodies** | **Yes since B4.9, against the REAL request DTO classes** (`class-validator`, same options as the API's `ValidationPipe`): every body the seed sends is validated, 400 on failure. B4.1–B4.8 accepted any body, which hid three contract errors (§6.1) |
| Variants / prices | Variant rows with numeric or string prices; `minPrice`/`cost` optional |
| HTTP errors | Thrown as `METHOD path -> status` like the real client, without a real body |
| Orders: total and confirmation | Since B4.9: total = Σ quantity × base price; confirm requires `payments` summing exactly to the total (re-implemented from `orders.service.ts`). Stock reservation, exceptional discounts, document-type / customer-data rules: no |
| Transfers | Since B4.9: a status machine (draft → approved → preparing → dispatched → partially_received / received, tenant gates, 409 on a wrong status, over-receiving refused). Stock movements, location authorization, incidents: no |
| Returns | **No state machine**: create / inspect / resolve answer a fixed shape. A failure inside them (over-returning, wrong status) is not reproduced |
| Concurrency, RLS, real constraints (customer tax id uniqueness, etc.) | No |
| Real HTTP / undici redirect behaviour | No — a fake `fetch` implements the redirect modes |
| Real SQL / S3 adapters of the image script | No |

### 6.1 Contract errors found in B4.8 and fixed in B4.9

| Step | Sent before | The real contract (file) | Now |
|---|---|---|---|
| 5 stock | `RECEIPT` without cost | `unitCost` mandatory for `RECEIPT` (`inventory/movements/dto/create-adjustment.dto.ts`) | `unitCost` = the product's own defined cost |
| 8 customers | `type: individual/business`, `displayName`, `address` object | `type` cedula/ruc/pasaporte, `firstName` + `lastName`, `address` text, no `displayName` (`sales/customers/dto/create-customer.dto.ts`) | exact DTO body; business customer → ruc with the two name fields "Ferretería" / "El Tornillo" |
| 9 confirm | no body | `payments` ≥ 1, sum = total (`sales/orders/dto/confirm-order.dto.ts` + `orders.service.ts`) | one cash payment = the order total |
| 11 transfers | always approve → prepare | gates may be disabled per tenant (`transfers.service.ts` `advanceThroughDisabledStages`) | status-driven steps |

Two caveats on the fakes: the DTO classes are real, but the **service-level** rules (payment sum, receive quantities and statuses, unique tax id) are the fake's own re-implementation from reading the services, and fixture ids ("cat-f") stand in for UUIDs only while a body is validated. They are guards against drift, not proof of integration.

A passing test therefore shows that the seed's *logic* handles these responses; it does not show that the real API, database or object store behave this way.

## 7. Historical risks kept open (not addressed here)

The QA password literal in public Git history · no integration test of the real SQL/S3 adapters · no real-undici redirect test · the intermittent `pg-verify` hang (and its `[debug]` instrumentation) · background process `bo9318p3h` · all backups on one physical disk (no independent external copy).
