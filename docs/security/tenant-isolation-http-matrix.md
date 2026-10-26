# Tenant isolation over HTTP — sweep matrix (GAP-F19-RLS-IDOR-DEPTH)

**Date:** 2026-10-26 · **Scope:** the surfaces added or changed after the QA 5S campaign · **Status of FASE 19:** *not*
complete — this sweep is one requirement of it (see "What this does NOT prove").

All cases live in `apps/api/test/security/` and run through the real `buildApp()` over HTTP against real PostgreSQL
(isolated disposable instance on port 55433 via `tools/pg-verify`; the development database on 55432 was not used). Reproduce:

```bash
PG_VERIFY_PORT=55433 PG_VERIFY_TEST_FILTER="test/security" pnpm --filter @saas-inventory/pg-verify verify
```

**Method (per surface):** two isolated tenants A and B with known users/roles → legitimate access for each tenant (a
**positive control**, so "nothing leaked" is never vacuous) → cross-tenant reads and writes by swapping ids, filters, bodies,
headers and cookies → anonymous and no-permission callers → read the database back to prove **no side effect** after every
refused write. Expected status codes follow each endpoint's own contract (404 for a foreign resource, 403 for a missing
permission or a refused support action, 401 anonymous, 400 malformed). Where the contract allows several, the test names the
allowed set and records it.

## Result summary

| Surface | Cases | Result |
| --- | --- | --- |
| SuperAdmin support sessions (ADR-0036) | `ISO-SUP-01…14` | **Approved.** One known gap characterised (`SUP-14`, reads not audited). |
| Onboarding, invitations, revocation | `ISO-ONB-01…07` | **Approved.** |
| `sales.orders.view_all` scope | `ISO-VA-01…05` | **Failed on first run → fixed.** `FINDING-VA-WRITE-SCOPE` (P2). Approved after the fix. |
| Order payments | `ISO-PAY-01…04` | **Approved.** |
| Bulk stock load | `ISO-BULK-01…03` | **Approved.** |
| Import jobs, tracking, results, downloads | `ISO-IMP-01…06` | **Failed on first run → fixed.** `FINDING-IMP-FOREIGN-REF-500` (P3). Approved after the fix. |
| Exports (orders, customers, transfers, payments, product catalogue, Kardex) | `ISO-EXP-xx`, `ISO-EXP-07` | **Approved.** |
| Kardex and inventory movements | `ISO-KRD-01…04` | **Approved.** |

No **cross-tenant** read or write succeeded in any case. The two findings are an intra-tenant authorization gap and a
robustness defect; both were reproduced, documented in `roadmap/pending-register.md`, then fixed with regression tests.

## Findings

| ID | Severity | Observed (before) | Fix | Evidence |
| --- | --- | --- | --- | --- |
| `FINDING-VA-WRITE-SCOPE` | P2 | A seller without `view_all` got **404** reading another seller's order but **200** cancelling it (`ISO-VA-03a`) and **200** confirming it with a payment (`ISO-VA-03b`); the idempotent "already confirmed" return also exposed the order body. | `OrdersService.confirm` / `cancel` apply `canSeeSellerOf` first → 404. Unit tests added. | `ISO-VA-03a/b/c`; unit `orders.service.spec.ts` |
| `FINDING-IMP-FOREIGN-REF-500` | P3 | `POST /imports` with another tenant's `defaultLocationId` → **500** (the composite FK blocked the write, but unhandled and after the file was stored). | UUID check (400) and ownership check (404) before storing. | `ISO-IMP-05` |
| *(characterised, not fixed)* `SUP-READ-NOT-AUDITED` | P3 / accountability | Under an active support session, tenant `GET`s (the documented ADR-0036 "read-through") leave **no per-request audit row**; only session start/end and the one write action are audited. | none — owner decision needed (see register). | `ISO-SUP-14` |

## Matrix — support sessions (`/platform/…`)

| Case | Endpoints | Attack / probe | Expected | Observed |
| --- | --- | --- | --- | --- |
| SUP-01 | all 6 support routes | no credentials | 401, nothing created | ✔ |
| SUP-02 | same | tenant Administrador (full permissions), own tenant | 401/403 | ✔ |
| SUP-03 | `current`, tenant routes | tenant JWT as platform cookie; platform JWT as tenant cookie | 401 | ✔ |
| SUP-04 | `support/users|warehouses|…status` | platform admin, no session | 403, no change | ✔ |
| SUP-05 | `support/users`, `warehouses` (A and B) | READ session on A reading A, B; writing A, B | A 200; B 403; writes 403, no change | ✔ |
| SUP-06 | `PATCH …/warehouses/:id/status` | WRITE session on A: B's warehouse id on A's URL, B's URL, extra fields (`tenantId`, `name`) | 403/404/400, no change, no audit row for B; the legitimate write audited (session id, reason, actor) | ✔ |
| SUP-07 | `support/*` | second admin borrows another's session id (header/query); session moves to B | 403/400; A refused after supersede | ✔ |
| SUP-08 | `current/end` | ending by another admin; using an ended session | own session only; 403 after end | ✔ |
| SUP-09 | `POST …/support-sessions` | unknown tenant, malformed id, bad mode, no reason, extra `tenantId` | 404 / 400 | ✔ |
| SUP-10 | ordinary tenant `GET`s (read-through) | no session; WRITE session; query/header tenant steering; B's ids | no session 401/403; with session `GET` only, bound to A, B's ids 404, no tenant cookie issued | ✔ |
| SUP-12 | 10 ordinary `POST/PATCH/PUT/DELETE` routes | write verbs under a WRITE session | 403 each, row counts and names unchanged | ✔ |
| SUP-13 | `GET /warehouses` | suspended tenant; ended session | read-through denied; restored on activate | ✔ |
| SUP-14 | `GET` read-through | audit trail of reads | **characterised: not audited** | known gap |
| SUP-11 | audit | session start/end rows | tenant = target, actor = platform admin | ✔ |

## Matrix — onboarding, invitations, revocation

| Case | Endpoints | Probe | Expected | Observed |
| --- | --- | --- | --- | --- |
| ONB-01 | 8 `/platform/tenants…` routes | anonymous; tenant Administrador | 401 / 401-403, no tenant created, B not suspended | ✔ |
| ONB-02 | `GET /auth/invitations/:token`, `POST /auth/accept-invitation` | token resolves to its own tenant; accepted admin probes A and B | info has no foreign data; user lands in the new tenant; A/B ids 404, lists clean | ✔ |
| ONB-03 | accept | extra `tenantId`/`email`/`roleId`/`tenantSlug` | 400, identity stays `pending_credential` | ✔ |
| ONB-04 | revoke / resend / accept | revoked token; replay of an accepted token | 401; no password; no second membership; replay does not change the password | ✔ |
| ONB-05 | invitation info + accept | unknown, 5 000-char, SQL-ish, path-traversal, tenant id, email as token | never 5xx, never 200 on accept, no leak, uniform answers | ✔ |
| ONB-06 | `POST /platform/tenants` | re-onboard an existing active identity | `identityReused`, **no** invitation link, original roles untouched, original admin still scoped to A | ✔ |
| ONB-07 | `…/admin-invitation[/resend|/revoke]` | unknown tenant, malformed id | GET unknown → `200 null` (no existence oracle); resend/revoke 404; malformed 400 | ✔ |

## Matrix — tenant surfaces

| Case | Endpoints | Probe | Expected | Observed |
| --- | --- | --- | --- | --- |
| VA-01 | `GET /orders`, `/orders/:id`, `/:id/notifications`, `/export` | seller without `view_all` vs another seller's and B's orders | own only; others 404; export has only own | ✔ |
| VA-02 | `GET /orders?placedByUserId|customerId|locationId|warehouseId` | widen scope with foreign filters | intersected with own; B gets nothing of A | ✔ |
| VA-03a/b | `POST /orders/:id/cancel`, `/confirm` | seller without `view_all` acts on another seller's pending order; B acts on A's | 404, no state/payment/stock change | **✘ then ✔ after fix** |
| VA-03c | same | owner confirms own; `view_all` cancels another's | 200 (positive control) | ✔ |
| VA-04 | orders list/detail/notifications/export/cancel | `view_all` holder in A vs B's order | A: all sellers; B: 404 everywhere, unchanged | ✔ |
| VA-05 | 6 order routes | anonymous; role with no permissions | 401 / 403, order untouched | ✔ |
| PAY-01 | `POST /orders/:id/confirm` | B confirms A's order | 404; no payment row, no movement, order pending | ✔ |
| PAY-02 | `POST /orders/:id/confirm` | extra `orderId`/`tenantId`, negative/zero/string amount, bad method, empty | 400, no payment; legitimate confirm writes 1 row under A; B re-confirm 404 | ✔ |
| PAY-03 | `GET /reports/payments`, `/export` | B vs A's data; foreign `locationId|warehouseId|placedByUserId|customerName`; sellers without `view_all` | nothing of A in report or xlsx; own data present; 401/403 | ✔ |
| PAY-04 | `POST /orders` + `Idempotency-Key` | same key in A and B; A replay | two independent orders; replay returns own order | ✔ |
| BULK-01 | `POST /inventory/receipts/bulk[/preview]` | A's location/SKUs from B and vice-versa | 404/403/422; 0 valid rows; no movement or stock change | ✔ |
| BULK-02 | same | same `Idempotency-Key` in A and B; replay | each loads its own stock once; replay does not repeat or cross | ✔ |
| BULK-03 | same + `/template` | steering fields; anonymous; no-permission; seller | 201/400/422 with no landing in A; 401; 403; nothing written | ✔ |
| IMP-01 | `/imports`, `/:id`, `/preview`, `/rows`, `/errors` | A drives its own job | 200; job and rows belong to A | ✔ |
| IMP-02 | `/imports/:id` + `preview|rows|errors|mapping|validate|confirm|cancel` | B on A's job | 404 on all 8; job status/`updated_at`, row count and stock unchanged; absent from B's list | ✔ |
| IMP-03 | all import routes + upload + mapping templates | anonymous; no-permission; seller | 401 / 403; no job created | ✔ |
| IMP-04 | `GET /imports/template` | template content per tenant | no foreign warehouse/location names | ✔ |
| IMP-05 | `POST /imports` | foreign / unknown / malformed `defaultLocationId` and `mappingTemplateId`; steering fields; `../` filename | 404 / 400 with no job created; ignored fields; no traversal in the storage key; own ids work | **✘ then ✔ after fix** |
| IMP-06 | `/import-mapping-templates/:id` | B GET/PATCH/DELETE A's template | 404, template intact, absent from B's list | ✔ |
| EXP-xx | `orders`, `customers`, `transfers`, `reports/payments`, `reports/product-catalog`, `reports/kardex` `/export?format=xlsx` | A's download vs B's; A-derived filters from B; anonymous; no-permission | A has its data (control); B none of it; filters return nothing foreign; 401 / 403 | ✔ |
| EXP-07 | `GET /reports/kardex/export` | other tenant's variant/location; missing/malformed ids | refused or empty, never A's data; 400 | ✔ |
| KRD-01 | `GET /reports/kardex` | B reads A's variant/location (3 combinations) | refused or empty; no foreign names/codes/tenant id | ✔ |
| KRD-02 | `/inventory/movements`, `/balances`, `/reports/movements-summary`, `/inventory-summary` | B with A's ids as filters | none of A's rows | ✔ |
| KRD-03 | `POST /inventory/adjustments`, `/inventory/transfers` | B writes against A's variant/location (and vice-versa) | 404/403/422; no movement, no balance change in A or B | ✔ |
| KRD-04 | Kardex, movements, balances, adjustments | anonymous; no permission; seller | 401 / 403; seller cannot adjust; **cost fields hidden without `pricing.cost.view`** | ✔ |

## What this does NOT prove (not verified in this sweep)

- **FASE 19 as a whole.** Threat-model re-validation, RBAC review beyond these surfaces, mass-assignment and concurrency
  regression across the whole API, dependency review, and the remaining pending-register items are not covered here.
- Other order-id **write** routes that may need the same seller scope as `confirm`/`cancel`: `POST /price-approvals`
  (request against another seller's line) and `POST /sales-returns` (return of another seller's order). Not exercised.
- Surfaces outside the mandatory list: product images, QR management, customers CRUD beyond their export, roles/users
  admin, reports other than payments/movements/inventory summary, the public QR resolver (covered by 5S).
- **PDF** exports (`format=pdf`) — only `xlsx` downloads were parsed and inspected.
- The **asynchronous Import Worker** claim/processing over HTTP: job state and results are covered; cross-tenant claiming of
  the worker's own DB role is covered at database level by `import-worker.integration.test.ts`, not re-probed here.
- Time-based session expiry, rate limiting and brute force (existing tests cover expiry; no new probe).
- One clean run per case; no repeated-run stability study.
