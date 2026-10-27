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
| Kardex and inventory movements (tenant isolation) | `ISO-KRD-01…04` | **Approved.** |
| Inventory ledger — seller scope of the document references (movements, Kardex, xlsx / pdf export) | `ISO-LED-01…07` | **Failed on first run → fixed.** `FINDING-LEDGER-REFERENCE-LEAK` (P3). Approved after the fix. |
| Seller scope on approvals and returns — follow-up: writes, **reads** and the approver / warehouse workflows | `ISO-APR-01…14`, `ISO-RET-01…16`, `ISO-APV-01…07`, `ISO-RTW-01…07` | **Writes:** failed on first run → fixed (4 findings). **Reads:** owner decision applied (approvals option B, returns option C) and verified. **`approve` / `reject` / `inspect` / `resolve`:** approved — no defect found. |

No **cross-tenant** read or write succeeded in any case. The findings are intra-tenant authorization gaps and a
robustness defect; both were reproduced, documented in `roadmap/pending-register.md`, then fixed with regression tests.

## Findings

| ID | Severity | Observed (before) | Fix | Evidence |
| --- | --- | --- | --- | --- |
| `FINDING-VA-WRITE-SCOPE` | P2 | A seller without `view_all` got **404** reading another seller's order but **200** cancelling it (`ISO-VA-03a`) and **200** confirming it with a payment (`ISO-VA-03b`); the idempotent "already confirmed" return also exposed the order body. | `OrdersService.confirm` / `cancel` apply `canSeeSellerOf` first → 404. Unit tests added. | `ISO-VA-03a/b/c`; unit `orders.service.spec.ts` |
| `FINDING-IMP-FOREIGN-REF-500` | P3 | `POST /imports` with another tenant's `defaultLocationId` → **500** (the composite FK blocked the write, but unhandled and after the file was stored). | UUID check (400) and ownership check (404) before storing. | `ISO-IMP-05` |
| `FINDING-APR-REQUEST-SCOPE` | P2 | `POST /price-approvals` by another seller → **201** (pending approval under their name), also with `newPrice` (which can rewrite the line price) (`ISO-APR-02`). | `PriceApprovalsService.request` applies the shared seller scope first → 404; no row, no price edit, no event. | `ISO-APR-02`, `ISO-APR-08`; unit specs |
| `FINDING-RET-CREATE-SCOPE` | P2 | `POST /sales-returns` by another seller → **201**; the default **Supervisor** too (`ISO-RET-02`, `ISO-RET-05`). | `ReturnsService.create` applies the shared seller scope → 404. | `ISO-RET-02/05/08`; unit specs |
| `FINDING-RET-CANCEL-SCOPE` | P2 | `POST /sales-returns/:id/cancel` by another seller → **200** (`ISO-RET-11`). | `ReturnsService.cancel` checks the return's order seller → 404. | `ISO-RET-11`; unit specs |
| `FINDING-RET-IDEMPOTENCY-REPLAY` | P3 | the same `Idempotency-Key` + payload by another seller → **201** (`ISO-RET-07`). | the request hash now includes the actor → another user gets a conflict, never the stored return. | `ISO-RET-07`; unit spec |
| `FINDING-APR-RET-READ-SCOPE` | P3 | another seller could **read** the owner's approval request and return, by id and in the list (`ISO-APR-11`, `ISO-RET-12`) — scoped by location only. | **Owner decision applied** ([ADR-0040](../decisions/0040-seller-scope-for-order-derived-operations.md)): a seller reads only their own orders' requests/returns; approvers keep the queue, the warehouse keeps every return, `view_all` widens both; the `returns-summary` aggregate carries the same scope. | `ISO-APR-11…14`, `ISO-RET-12…16`; unit specs |
| `FINDING-LEDGER-REFERENCE-LEAK` | P3 | any `inventory.view` holder — a Vendedor included — read **another seller's order number** (`Venta #ORD-…`), the **order uuid** (`referenceId`), the free-text reason and the **actor** in `GET /inventory/movements`, and the order number in the Kardex JSON and its xlsx / pdf export (`ISO-LED-01/02/03/06` failed on the first run: "owner sees the other seller's order number"). Return numbers leaked the same way. | The reference is resolved under the caller's seller scope (ADR-0040 point 5): own orders unless `view_all`; returns also for the warehouse. Out-of-scope rows stay, with a generic label and no number / uuid / reason / actor. | `ISO-LED-01…07`; unit specs |
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

## Matrix — seller scope on approvals and returns (follow-up)

Fixture: one tenant, two sellers (default Vendedor permissions, same location, **no** `view_all`), an Administrador, a role with
**only** `view_all`, a role with Vendedor permissions + `view_all`, the default Supervisor, a no-permission role, and a second
tenant. After every refused attempt the database is read back: approval / return / item rows, the order line price and total,
payments, stock, `RETURN` movements, outbox events and audit rows are unchanged.

| Case | Endpoint | Probe | Expected | Observed |
| --- | --- | --- | --- | --- |
| APR-01 | `POST /price-approvals` | owner, own exceptional line | 201; 1 row, 1 event, 1 audit, requester = owner | ✔ |
| APR-02 | same | other seller, **no view_all**, incl. `newPrice: 95 / 120` and `requestedPrice` | 404; **nothing changes — no row, no price edit** | **✘ then ✔** |
| APR-03 | same | `view_all` **without** `pricing.discount.request` | 403 (`view_all` grants no action) | ✔ |
| APR-04 | same | `view_all` + functional; Administrador | 201 | ✔ |
| APR-05 | same | default Supervisor | follows its template (no request permission → 403) | ✔ |
| APR-06 | same | unknown / malformed line id, other tenant, tampered fields (`orderId`, `requestedBy`, `tenantId`, `status`, `approvedBy`), missing reason | 404 / 400 / 404 / 400 / 400 | ✔ |
| APR-07 | same | confirmed order, cancelled order, line inside the authorized range, duplicate pending | 409 / 409 / 422 / 409; no new rows | ✔ |
| APR-08 | same | two concurrent requests by the owner; owner ‖ other seller (with `newPrice`) | exactly one 201 + one 409, one row/event/audit; 201 + 404, line unchanged | **✘ then ✔** |
| APR-09 | same | anonymous; no permission | 401; 403 | ✔ |
| APR-10 | `…/approve`, `…/reject`, `POST /orders/:id/confirm` | a seller approving/rejecting; Administrador approving; owner confirming | 403; 200; 200 (approver capabilities unchanged) | ✔ |
| APR-11 | `GET /price-approvals[/:id]` | seller reads own vs another seller's request; filters (`orderId`, `status`); hidden vs missing | own only in list **and totals** and by id; a hidden request answers exactly like a missing one (same body); filters cannot widen | ✔ |
| APR-12 | same | approvers (Supervisor, Administrador, seller + approver), Vendedor + `view_all`; `view_all` alone; no permission; anonymous | whole queue / 403 / 403 / 401 | ✔ |
| APR-13 | same | list vs by-id for every viewer; another tenant | never listed-yet-404 nor retrievable-yet-unlisted; other tenant sees nothing | ✔ |
| APR-14 | `GET /reports/approvals-summary` | a seller | 403 (approver-only: no aggregate path around the list scope) | ✔ |
| RET-01 | `POST /sales-returns` | owner, own confirmed order | 201; 1 return, 1 item, 1 event, 1 audit; **no stock movement until resolve** | ✔ |
| RET-02 | same | other seller, no `view_all` | 404; nothing changes | **✘ then ✔** |
| RET-03 | same | `view_all` **without** `sales.returns.create` | 403 | ✔ |
| RET-04 | same | `view_all` + functional; Administrador | 201 | ✔ |
| RET-05 | same | default Supervisor (`sales.returns.create`, no `view_all`) | 404 (behaviour change) | **✘ then ✔** |
| RET-06 | same | unknown / malformed order, other tenant, foreign receiving location, line of another order, over-return, pending / cancelled order, tampered fields, missing `Idempotency-Key`, short reason, no items, negative quantity | 404 / 400 / 404 / 404 / 422 / 409 / 409 / 409 / 400 …; no side effect | ✔ |
| RET-07 | same | owner replay; same key different payload; **another seller replaying the owner's key** | same return; 409; refused, nothing of the owner's return | **✘ then ✔** |
| RET-08 | same | same key twice; two over-returning requests; owner ‖ other seller | one return; one 201 + one 409; 201 + 404 | ✔ |
| RET-09 | same | anonymous; no permission | 401; 403 | ✔ |
| RET-10 | `…/inspect`, `…/resolve` | Administrador processes the owner's return | 200; exactly one `RETURN` movement, stock restocked | ✔ |
| RET-11 | `POST /sales-returns/:id/cancel` | other seller; the owner | 404, status stays `requested`; 200 | **✘ then ✔** |
| RET-12 | `GET /sales-returns[/:id]` | seller reads own vs another seller's return; filters; hidden vs missing | own only in list and totals and by id; hidden = missing (same body) | ✔ |
| RET-13 | same | Administrador, Supervisor, Bodega (with its location), Vendedor + `view_all`; role without `sales.returns.view`; anonymous | all returns / 403 / 401 | ✔ |
| RET-14 | same | Bodega with **no location assignment** | nothing (location scope still bounds the warehouse) | ✔ |
| RET-15 | same | list vs by-id for every viewer; another tenant | consistent; nothing across tenants | ✔ |
| RET-16 | `GET /reports/returns-summary` (every `groupBy`) | seller vs Administrador / Bodega / `view_all`, against the database truth | seller counts only own returns; the others count all | ✔ |

### Approver and warehouse workflows (cross-seller attack matrix)

`approve`/`reject` and `inspect`/`resolve` are **not** seller-scoped by design: they are gated by their functional permission (and the location scope for the warehouse). Each case reads the database back after a refusal (status, dispositions, line price/total, payments, stock, `RETURN` movements, outbox events, audit).

| Case | Endpoint | Probe | Expected | Observed |
| --- | --- | --- | --- | --- |
| APV-01 | `POST /price-approvals/:id/approve|reject` | owner and another seller (also with a `price` edit) | 403; nothing changes | ✔ |
| APV-02 | same | `view_all` alone, Vendedor + `view_all`, no permission, anonymous | 403 / 403 / 403 / 401 | ✔ |
| APV-03 | same | Supervisor approves, Administrador rejects, a seller who is also an approver approves — across sellers | 200; exactly one event and one audit each; owner then confirms / is blocked (409) | ✔ |
| APV-04 | same | other tenant; unknown / malformed id | 404 / 404 / 400; no change | ✔ |
| APV-05 | same | reject after approve; repeat; request of a cancelled order | 409; idempotent / 409; no extra event or audit | ✔ |
| APV-06 | `…/approve` with `{ price }` | seller vs approver | seller: 403, line unchanged; approver: 200, line price updated | ✔ |
| APV-07 | same | approve ‖ reject; approve ‖ approve; approver ‖ seller | one 200 + one 409; one event; 200 + 403 | ✔ |
| RTW-01 | `POST /sales-returns/:id/inspect|resolve` | owner and another seller | 403; nothing changes | ✔ |
| RTW-02 | same | `view_all` alone, Vendedor + `view_all`, no permission, anonymous | 403 / 403 / 403 / 401 | ✔ |
| RTW-03 | same | Bodega (with its location) processes another seller's return | 200 / 200; one `RETURN` movement, stock +quantity, one event, one audit each | ✔ |
| RTW-04 | same | Supervisor, Administrador; Bodega **without** a location | 200; the unassigned Bodega 403/404 with no change | ✔ |
| RTW-05 | same | other tenant; unknown / malformed id; foreign disposition location; unknown item; invalid disposition; no items | 404 / 404 / 400 / 400-422 / 400; no change | ✔ |
| RTW-06 | same | resolve before inspect; cancelled / resolved returns; resolve without `Idempotency-Key` | 409 / 409 / 400; a resolved return is immutable | ✔ |
| RTW-07 | `…/resolve` | same key twice; two keys at once; resolve ‖ the owner's cancel | exactly one `RETURN` movement; one winner, a cancelled return never restocks | ✔ |


**Behaviour change:** the default **Supervisor** (no `sales.orders.view_all`) can no longer **create or cancel** a return, nor confirm /
cancel an order, for another seller's order — it keeps the whole approvals queue (`pricing.discount.approve`) and every return
(`inventory.returns.manage`), and still approves, rejects, inspects and resolves. A tenant that wants Supervisors to act across sellers
grants `sales.orders.view_all`. Policy and rationale: [ADR-0040](../decisions/0040-seller-scope-for-order-derived-operations.md). Sellers'
approvals and returns screens now show their own documents only.

## Matrix — inventory ledger (FASE 19, seller scope of the document references)

Surfaces found by reading controllers → services → repositories → DTOs (not by grepping for a field name): `GET /inventory/movements`
(`inventory.view`; resolves order, return, transfer and import labels), `GET /reports/kardex` and `GET /reports/kardex/export`
(`inventory.view`; the export is built from the same service response), `GET /reports/movements-summary` (aggregate over
`inventory_movements` alone — type / count / signed quantity, **no reference or document column**, nothing to leak). Reviewed in
code and found already scoped: the payments report, the sales-summary report and `GET /orders` (`placedByUserId` /
`sales.orders.view_all`). A fixture of two sellers with identifiable orders (confirmed sale, pending order, resolved return) and a
second tenant was used; the evidence is the returned body (number, uuid, reason, actor) of every response, including the parsed xlsx.

| Case | Endpoint | Probe | Expected | Observed |
| --- | --- | --- | --- | --- |
| LED-01 | `GET /inventory/movements` | owner, other seller, Vendedor + `view_all`, Administrador, Supervisor, Bodega — order number / uuid, pending order, return number | owner and `view_all`/Administrador: own references; other seller, Supervisor, Bodega: **no order number or uuid**; return number for owner, `view_all` and the warehouse (Supervisor, Bodega), not for another seller | ✔ (after fix) |
| LED-02 | same | a masked row vs the same row for Administrador | same rows, same type / quantity / balance; generic label; no `referenceId`, `reason`, `actorId`; manual receipts untouched | ✔ |
| LED-03 | `GET /reports/kardex` | same viewers | same scope on the label; rows, running stock, closing and `stockByLocation` identical for everyone | ✔ |
| LED-04 | `GET /reports/kardex/export?format=xlsx` | same viewers, cells parsed | same scope as the JSON | ✔ |
| LED-05 | `…/export?format=pdf` | a seller | 200, a PDF, produced from the scoped data | ✔ |
| LED-06 | movements with `movementType` / `locationId` filters | another seller | the filters cannot unmask a reference | ✔ |
| LED-07 | all three | no permission; anonymous; another tenant; malformed ids | 403; 401; nothing of this tenant's ledger; 400 | ✔ |

**Cost fields** (`unitCost`, average cost, stock value) keep their own gate (`pricing.cost.view`, ADR-0028) and are covered by `ISO-KRD-04`.
**Read-only surface:** no state is modified by these routes, so there is nothing to read back from the database beyond the fixture.
Not changed on purpose: the quantities and balances (inventory truth, tenant-wide by design) and transfer / import labels.

## What this does NOT prove (not verified in this sweep)

- **FASE 19 as a whole.** Threat-model re-validation, RBAC review beyond these surfaces, mass-assignment and concurrency
  regression across the whole API, dependency review, and the remaining pending-register items are not covered here.
- **Ledger — beyond order and return references:** transfer codes and import numbers in the ledger are not seller documents and were
  not scoped; any other free-text `reason` typed by hand (receipts, adjustments) is shown as written. The `movements-summary` and
  the payments / sales reports were reviewed in code, not re-attacked over HTTP in this pass.
- Price-approval **editing** beyond the approver price edit exercised in `APV-06`, and the remaining order-derived routes (e.g. order
  PDF/print views) were not attacked cross-seller.
- Surfaces outside the mandatory list: product images, QR management, customers CRUD beyond their export, roles/users
  admin, reports other than payments/movements/inventory summary, the public QR resolver (covered by 5S).
- **PDF** exports (`format=pdf`) — only `xlsx` downloads were parsed and inspected.
- The **asynchronous Import Worker** claim/processing over HTTP: job state and results are covered; cross-tenant claiming of
  the worker's own DB role is covered at database level by `import-worker.integration.test.ts`, not re-probed here.
- Time-based session expiry, rate limiting and brute force (existing tests cover expiry; no new probe).
- One clean run per case; no repeated-run stability study.
