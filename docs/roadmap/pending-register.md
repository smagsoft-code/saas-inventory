# Pending-items register

**Baseline:** repository state verified on **2026-10-26** — branch `develop`, HEAD `2215f5d` at the
time of the first version (the documentation commit `7ca9b94` followed), clean working tree, 119
commits, **no upstream configured (nothing has ever been pushed)**. Updated the same day after the
owner's decisions on six items; each affected entry carries a *decided* banner.

This register separates *implemented* work from *validated* work. An item is never closed here
without evidence a reader can re-run. It is the starting point for the FASE 19 audit; it does not
replace per-phase reports.

**Status vocabulary** (Spanish equivalents in parentheses):

| Status | Meaning |
| --- | --- |
| `open` (abierto) | Confirmed by evidence listed in the entry. |
| `to-verify` (por verificar) | Reported earlier, but not reproducible from the repo alone; needs a running stack, an operator, or a decision. |
| `fixed-pending-validation` (corregido pendiente de validación) | A change exists but has no re-runnable proof. |
| `closed-with-evidence` (cerrado con evidencia) | Closed, with evidence cited. |

**Evidence levels used below:** *static* = read from current source/docs; *runtime* = a command was
run on 2026-10-26; *notes* = recorded only in earlier session notes (the QA campaign's raw evidence
files are **not** in the repository — see `QA-EVIDENCE-PERSISTENCE`).

Severity: **P1** blocks release / security-relevant, **P2** must be fixed before MVP, **P3**
improvement or limitation.

---

## A. Security and robustness (FASE 19 candidates)

### GAP-F19-PARSE-UUID

- **Description:** a malformed UUID in a path parameter reaches PostgreSQL and surfaces as HTTP 500
  (`22P02`) instead of 400/404. 5S measured 10 of 11 critical `:id` endpoints failing this way.
- **Evidence:** *static* — `ParseUUIDPipe` appears **0** times under `apps/api/src`; `@Param('…Id')`
  appears **81** times across 22 controllers; no filter maps `22P02`. *notes* — the 5S probe.
  Not re-run against a live API in this pass.
- **Severity / risk:** P2. Not a cross-tenant exposure (5S: cross-tenant access returned 404), but it
  is an unhandled-error path on the whole API surface and noisy for monitoring.
- **Proposed phase:** FASE 19.
- **Dependencies:** none. Cheapest fix is one shared validation point, not 81 edits.
- **Acceptance:** every UUID path param rejects a malformed value with a deterministic 4xx; a test
  enumerates all routes with an id param; no PostgreSQL error text reaches a response or log at
  `error` level.
- **Status:** `closed-with-evidence` (2026-10-26, commit `7855019`). **Before** (real PostgreSQL, same suite): all 20 sampled
  routes answered **500** to a malformed UUID. **After:** all 20 answer **400** in the standard envelope with no database
  text, and a well-formed but unknown UUID still answers **404** (the pipe is not over-broad). `ParseUUIDPipe` is on all 81
  UUID path params in 22 controllers; `uuid-path-params.spec.ts` fails if a new `@Param` is added without it (`code` and
  `token` are the only documented exceptions, and are verified untouched). **Limits:** HTTP behaviour was exercised on 20
  tenant routes with an admin session; the other params rely on the source guard, and `/platform/*` routes were not
  exercised over HTTP.

### GAP-F19-EMPTY-BODY *(ID created by this register; 5S recorded it without one)*

- **Description:** `POST /platform/tenants/:id/suspend` sent with `Content-Type: application/json`
  and an empty body returns 500 (Fastify's empty-JSON-body error is not mapped to a 4xx).
- **Evidence:** *notes* — 5S. *static* — no handler for the Fastify empty-body error was found in
  `apps/api/src`. Not reproduced here.
- **Severity / risk:** P2. Likely affects every bodyless POST action (`confirm`, `cancel`,
  `approve`, `dispatch`, …) when a client sends the JSON content type.
- **Proposed phase:** FASE 19. **Dependencies:** none.
- **Acceptance:** every bodyless POST action succeeds or returns 4xx with and without the JSON
  content type; one integration test per action class.
- **Reproduction (2026-10-26, real PostgreSQL, before the fix):** `Content-Type: application/json` with no body answered
  **500 `INTERNAL_ERROR`** (server log: `FastifyError: Body cannot be empty when content-type is set to 'application/json'`)
  on a bodyless action (`POST /orders/:id/cancel`) and on a body-requiring endpoint (`POST /customers`). Malformed JSON was
  already 400; `text/plain` is parsed by Fastify (not a 415).
- **Fix (commit `7855019`):** an empty/whitespace JSON body is read as "no body" (bodyless actions run; body-requiring
  endpoints still answer 400 `VALIDATION_ERROR`, nothing is silently accepted); Fastify `FST_*` 4xx errors (415, 413, …) are
  mapped to their real status with fixed messages instead of 500.
- **Status:** `closed-with-evidence` — after the fix the same 5 cases pass against real PostgreSQL. **Limit:** the exact
  route in the original report (`POST /platform/tenants/:id/suspend`, needs a platform session) was not exercised; it goes
  through the same parser.

### GAP-F19-RLS-IDOR-DEPTH

- **Description:** the 5S isolation campaign covered 14 read and 10 mutate cross-tenant probes plus
  RLS checks, on `develop` at `1a50133` (2026-09-10). Everything added afterwards is **unprobed**:
  platform support sessions, platform tenant onboarding/invitations, `sales.orders.view_all` scope,
  tenant logos, order payments, bulk stock load, exports/PDF, bulk QR generation, Kardex report.
- **Evidence:** *notes* (5S result) vs *static* (migrations 0031–0050, 61 commits since `6fcfb79`).
- **Severity / risk:** P1 until probed — new surface in a multi-tenant system.
- **Proposed phase:** FASE 19. **Dependencies:** a disposable PostgreSQL + two tenants (see
  `PG-VERIFY-FULL-RUN`).
- **Acceptance:** per new endpoint, a cross-tenant read and mutate by real UUID returns 404; RLS
  denies the `app_tenant` role across tenants for every new table; results kept in the repo.
- **Added 2026-10-26:** the existing per-table isolation suite (`multi-tenancy-rls`) aborted for
  `categories` and `customers` because its fixtures are out of date, so even those two tables have no
  current isolation proof (`DEFECT-INTEGRATION-STALE-TESTS`).
- **Update 2026-10-26 (HTTP sweep):** the mandatory post-5S surfaces were probed over real HTTP against real PostgreSQL with
  two isolated tenants — **47 cases in 2 files** (`apps/api/test/security/`), matrix and method in
  [`docs/security/tenant-isolation-http-matrix.md`](../security/tenant-isolation-http-matrix.md). Surfaces: support sessions
  (ADR-0036), onboarding / invitations / revocation, `sales.orders.view_all`, order payments, bulk stock load, import jobs
  (state, results, downloads), exports (orders, customers, transfers, payments, product catalogue, Kardex), Kardex and
  inventory movements. **No cross-tenant read or write succeeded in any case**; every refused write was checked for side
  effects in the database. The sweep did find two defects (below), both reproduced, documented, fixed and covered by regression
  tests.
- **Update 2026-10-26 (seller-scope follow-up):** `POST /price-approvals` and `POST /sales-returns` (and return cancel) were swept
  with 23 further cases — four findings, fixed (`FINDING-SELLER-SCOPE-APPROVALS-RETURNS`); the reads of approvals/returns were then scoped by owner decision
  (`FINDING-APR-RET-READ-SCOPE`, ADR-0040) and the approver / warehouse workflows attacked with no defect
  (`FINDING-APPROVER-WAREHOUSE-WORKFLOWS`).
- **Status:** `closed-with-evidence` **for the listed surfaces and the stated probes only.** Not covered, and therefore still
  open under FASE 19: PDF exports, product images / QR management / roles-users admin / other reports,
  repeated-run stability. **This is not "tenant isolation validated" for the whole system, and FASE 19 is not complete.**

### SUP-READ-NOT-AUDITED *(new, characterised — owner decision needed)*

- **Severity: P3 (accountability), not an access-control failure.** ADR-0036's documented "read-through" lets a platform admin with
  an active support session `GET` the ordinary tenant API (read-only, bound to the session's tenant, every non-`GET` refused —
  all verified by `ISO-SUP-10/12/13`). Those reads leave **no per-request audit row**: only `support_session.started/ended` and
  the one curated write are audited (`ISO-SUP-14` characterises it).
- **Why it matters:** the read-through exposes customer PII, prices and financial data of the tenant, and the tenant cannot later see
  *what* was read. **Not fixed** here: choosing between per-request audit, sampled/route-class audit or accepting the gap is a
  product/compliance decision (volume, retention, tenant visibility). **Proposed phase:** FASE 19/20. **Status:** `open`.

### FINDING-VA-WRITE-SCOPE *(new, found by the 2026-10-26 HTTP isolation sweep)*

- **Severity: P2 (medium) — intra-tenant authorization gap, not a cross-tenant leak.** Tenant isolation itself held: tenant B
  could not read or act on A's orders (404, no side effect).
- **Description:** the seller-scope rule of `sales.orders.view_all` is enforced on READS only. `OrdersService.getById` and the
  notifications read call `canSeeSellerOf(...)`; `confirm` and `cancel` do not — they apply only the location check. A seller
  without `view_all` cannot even see another seller's order (404) yet can **cancel** it (needs `sales.orders.cancel`) or
  **confirm** it (needs `sales.orders.create`, which every default Vendedor holds), recording payments and committing stock.
- **Reproduction (real PostgreSQL, before the fix, `iso-run3`):** s1 (no `view_all`) `GET /orders/{s2 order}` → 404, but
  `POST /orders/{s2 pending order}/cancel` → **200 `status: cancelled`** (`ISO-VA-03a`) and `POST /orders/{s2 pending
  order}/confirm` with a cash payment → **200 `status: confirmed`** (`ISO-VA-03b`). Source: `orders.service.ts` `confirm`
  (l.421) / `cancel` (l.535) — no `canSeeSellerOf` call.
- **Impact:** a seller can cancel a colleague's pending sale or close it under their own session (the order keeps the original
  `placedByUserId`; the audit row records the actor). Integrity and attribution risk (commission/fraud), not data disclosure.
- **Fix (commit in this block):** both methods hide an order the caller may not see, exactly as the read does (404, before any other
  work, including before the idempotent "already confirmed/cancelled" return that used to expose the order body).
- **Evidence after the fix:** `ISO-VA-03a/b` pass (404, order still pending, no payment row, no movement), `ISO-VA-03c` keeps the
  legitimate paths (owner confirms; `view_all` holder cancels); 4 new unit tests in `orders.service.spec.ts`. Two existing
  integration tests relied on a non-owner reaching the *location* check (`outbox-transactional` rollback, `T3/T4`); their actor now
  also holds `view_all` so the failure under test is still the location authorization — intent kept, nothing weakened.
- **Status:** `closed-with-evidence`. **Behaviour change to note:** a seller without `view_all` can no longer confirm/cancel an
  order another seller placed (default Vendedor included); the Administrador (holds `view_all`) is unaffected.
- **Not covered / still to verify:** other order-id write routes that may need the same scope — `POST /price-approvals`
  (request for a line of another seller's order) and `POST /sales-returns` (return of another seller's order) — were not
  exercised in this sweep.

### FINDING-SELLER-SCOPE-APPROVALS-RETURNS *(new, found by the 2026-10-26 seller-scope follow-up — 4 sub-findings)*

Follow-up to `FINDING-VA-WRITE-SCOPE`: the two order-id write routes the first sweep left open. All are **intra-tenant**
authorization gaps (tenant isolation held: another tenant got 404 and no side effect). Reproduced on 2026-10-26 against real
PostgreSQL **before any fix** with `apps/api/test/security/isolation-seller-scope-approvals-returns.integration.test.ts`
(a seller without `sales.orders.view_all` gets **404** reading the order, yet:)

| ID | Severity | Observed before the fix | Root cause |
| --- | --- | --- | --- |
| `FINDING-APR-REQUEST-SCOPE` | **P2** | `POST /price-approvals` by another seller → **201** (pending approval created under their name, event + audit written), also with `newPrice: 95` (`ISO-APR-02`) | `PriceApprovalsService.request` locks the order but never applies the seller scope; the optional `newPrice` path (`applyPriceEdit`) can **rewrite the unit price and totals of the line**. |
| `FINDING-RET-CREATE-SCOPE` | **P2** | `POST /sales-returns` by another seller → **201**; the default **Supervisor** (`sales.returns.create`, no `view_all`) → **201** (`ISO-RET-02`, `ISO-RET-05`) | `ReturnsService.create` applies only the location check. |
| `FINDING-RET-CANCEL-SCOPE` | **P2** | `POST /sales-returns/:id/cancel` by another seller → **200** (return cancelled, event + audit) (`ISO-RET-11`) | `ReturnsService.cancel` has no scope check at all. |
| `FINDING-RET-IDEMPOTENCY-REPLAY` | P3 | the same `Idempotency-Key` + payload sent by another seller → **201** instead of being refused (`ISO-RET-07`) | the idempotency record is keyed by tenant + scope + key, not by actor, and its lookup runs before any scope check. |

**Impact:** a seller can file price-approval requests (and attempt price edits) on a colleague's sale, and register or cancel
returns of orders they cannot even see — integrity/attribution risk and noise for approvers/warehouse; no data disclosure
across tenants. **What already held (positive controls, all passed before the fix):** `view_all` alone grants no functional
permission (403 without `pricing.discount.request` / `sales.returns.create`); anonymous 401; no-permission 403; malformed and
foreign ids; non-pending / non-confirmed orders (409), non-exceptional line (422), over-return (409); duplicate and concurrent
requests; the owner, the Administrador and a `view_all`+functional role keep working; approvers approve, the warehouse
inspects/resolves.

**Evidence after the fix (23 cases, `ISO-APR-01…11`, `ISO-RET-01…12`, all pass):** the three refusals are 404 with the database
read back unchanged (no approval / return / item row, line price and total, payments, stock, `RETURN` movements, outbox events, audit);
the cross-user idempotency replay is refused; races end 201 + 409 / 201 + 404 with exactly one row and one event; the owner, the
Administrador, a `view_all` + functional role, approvers (approve/reject, confirm) and the warehouse flow (inspect/resolve → one
`RETURN` movement) keep working. Unit specs added in `price-approvals.service.spec.ts` and `returns.service.spec.ts`.

**Status:** `closed-with-evidence` for the four sub-findings.

**Fix (this block):** the seller rule of `FINDING-VA-WRITE-SCOPE` is now one shared function
(`orders/order-seller-scope.ts`) used by order confirm/cancel, `PriceApprovalsService.request` and
`ReturnsService.create`/`cancel` (404 first, before any status-dependent answer); the return idempotency hash now includes the
actor. **Behaviour change to note:** the default **Supervisor** can no longer register a return for another seller's order unless
granted `sales.orders.view_all` (same consequence as order confirm/cancel); approvers still approve/reject any request.

### FINDING-APR-RET-READ-SCOPE — **decided and fixed 2026-10-26 (owner)**

- **Severity: P3.** A seller without `view_all` could **read** another seller's price-approval request and sales return (by id and in the
  list) — those reads were scoped by location only (`ISO-APR-11` / `ISO-RET-12` observations).
- **Decision (owner):** approvals — **option B** with an exception for approvers; returns — **option C**. Recorded as
  [ADR-0040](../decisions/0040-seller-scope-for-order-derived-operations.md); **no new permission**.
  - Approval requests: a seller sees only the requests on their own orders; `pricing.discount.approve` keeps the whole queue; `view_all`
    widens it; `view_all` alone does not open the queue (still needs `pricing.discount.request` or `.approve`) and grants no action.
  - Sales returns: a seller sees the returns of their own orders; `inventory.returns.manage` (warehouse) keeps every return, bounded by its
    location scope; `view_all` widens it; it grants no inspect/resolve. The `returns-summary` aggregate carries the same predicate.
  - Common: the scope is a SQL predicate (list **and totals**) and a 404 by id with the **same body as a missing resource**; tenant
    isolation and the location scope still apply.
- **Evidence (`ISO-APR-11…14`, `ISO-RET-12…16`, all pass):** own-only lists/totals/by-id, hidden = missing (same body), filters cannot
  widen, list ⇔ by-id for every viewer, approvers / warehouse / `view_all` keep their views, an unassigned Bodega sees nothing, the
  aggregate matches the database truth per role. Unit specs in `returns.service.spec.ts`, `price-approvals.service.spec.ts`,
  `returns-report.service.spec.ts`.
- **Behaviour change / tests touched:** the default Supervisor keeps the queue and every return; sellers' screens show only their own
  documents. One existing test (`GET /price-approvals is gated by @RequireAnyPermission`) had the Administrador file the request and a
  Vendedor read it — it now has the Vendedor own the order, so it still proves the permission gate.
- **Status:** `closed-with-evidence`.

### FINDING-APPROVER-WAREHOUSE-WORKFLOWS *(new — result of the cross-seller attack matrix, no defect)*

- `approve` / `reject` (`ISO-APV-01…07`) and `inspect` / `resolve` (`ISO-RTW-01…07`) were attacked by the owner, another seller, `view_all`
  alone, `view_all` + seller permissions, no-permission and anonymous callers, other-tenant and malformed ids, invalid states and
  concurrent requests, with a database read-back after every refusal (status, dispositions, line price / totals, payments, stock,
  `RETURN` movements, outbox events, audit). **No defect found:** sellers and `view_all` get 403 with nothing changed; approvers and
  the warehouse (Supervisor, Administrador, Bodega with its location) act across sellers by design; races end with exactly one decision
  event / one `RETURN` movement. **Limits:** the unassigned-location Bodega is refused by the location scope; price edits beyond the
  approver edit and the inventory-ledger document labels (movement / Kardex responses) were not attacked.
- **Status:** `closed-with-evidence` (no finding).

### FINDING-IMP-FOREIGN-REF-500 *(new)*

- **Severity: P3 (low) — robustness; the database blocked the cross-tenant reference.**
- **Description:** `POST /imports` accepts `defaultLocationId` / `mappingTemplateId` as multipart text fields and passes them to
  the job update without checking that they belong to the caller's tenant (or are UUIDs). The composite foreign keys
  `(tenant_id, default_location_id)` reject a foreign id, but as an **unhandled `500`** — after the uploaded file was already
  written to object storage (orphan object).
- **Reproduction (before the fix, `iso-run3`, `ISO-IMP-05`):** tenant B uploads with `defaultLocationId` = A's location id →
  `500 INTERNAL_ERROR`; server log: `Failed query: update "import_jobs" set "default_location_id" = … ` (FK violation). No A
  data was written or returned, and the same 500 occurs for any non-owned id, so it is not an existence oracle.
- **Fix (commit in this block):** `ImportJobService.assertReferencedIdsBelongToTenant` — UUID format → 400, must exist in the tenant
  → 404 — runs before the file is stored.
- **Evidence after the fix:** `ISO-IMP-05` — foreign / unknown / malformed ids are refused (404 / 400), no job is created in A or B,
  own ids still work. **Status:** `closed-with-evidence`.

### DECISION-SELF-APPROVAL — **decided 2026-10-26 (owner)**

> **Decision:** anyone holding `pricing.discount.approve` may resolve a price request, their own
> included. Recorded as an amendment to ADR-0022. Code, UI and tests changed to match in a separate
> commit (the service no longer special-cases `pricing.policy.manage`; the ApprovalActions UI no longer
> hides the buttons for the requester). **Status: `fixed-pending-validation`** — API unit 778/778 and
> web unit pass; the real-PostgreSQL proof is in `PG-VERIFY-FULL-RUN`. Note for FASE 19: by default
> only the Administrador holds both `.request` and `.approve`; treat `.approve` as privileged.
> The entry below is the original finding, kept for history.

- **Description (original finding):** `PriceApprovalsService.resolve` now lets a holder of `pricing.policy.manage`
  resolve **their own** exceptional-discount request (`price-approvals.service.ts:304-310`, comment:
  "owner decision"). At least six documents still state the requester can **never** resolve their own
  request (`CLAUDE.md`, `roadmap.md` FASE 13, `security.md:164`, `modules.md:216`,
  `f17-screen-catalog.md:622`, `frontend-screen-specs.md:275`). No ADR records the exception:
  ADR-0022 was amended on 2026-10-05 (see `DOC-ADR0022-TRIGGER-DRIFT`) but that amendment says
  nothing about who may resolve a request.
- **Evidence:** *static* — introduced in `b198a7d` (2026-10-23); test `P7` (requester blocked) and
  `P25` (tenant admin allowed) both exist and are consistent with the code; migration `0049`
  backfills the permissions to admins.
- **Severity / risk:** P2. It diverges from the documented separation-of-duties rule without a
  recorded decision. Whether it stays, is narrowed (e.g. extra audit or a second approver) or is
  reverted is the owner's call; this register does not prejudge it.
- **Proposed phase:** before FASE 19 (decision), then docs.
- **Dependencies:** owner decision.
- **Acceptance:** an ADR (or ADR-0022 amendment) states the exception, its audit requirement and
  scope; the six documents are aligned.
- **Status:** `fixed-pending-validation` (was `open — needs an owner decision`).

## B. Notifications / n8n

### GAP-NOTIF-RETRY-BACKEND

- **Description:** no endpoint lets an authorised admin re-enqueue a failed notification; the order
  detail card shows status only.
- **Evidence:** *static* — no retry/requeue/redeliver route in any `*.controller.ts`.
- **Severity / risk:** P3. Recovery today is a manual SQL requeue (used once in 5R-A).
- **Proposed phase:** FASE 20 (operations) or a dedicated block. **Dependencies:** ADR, a permission
  code, likely a migration (attempt/requeue audit).
- **Acceptance:** permissioned, audited endpoint that only requeues `dead_letter`/`pending` rows of
  the caller's tenant and never changes the payload or `eventId`; UI action on the order card.
- **Status:** `open`.

### FINDING-N8N-RESPOND-INVALID

- **Description:** in the operator's n8n workflow the `Respond Invalid` node answers HTTP 500 instead
  of 400 (its `responseCode` was `"=400"`, then `"400"`; an integer `400` is needed). Consequence: an
  invalid envelope is classified **retryable** by the backend instead of permanent. A dead
  `order.cancelled` rule in `Route eventType` is harmless.
- **Evidence:** *notes* only — the workflow lives in n8n, outside this repository, and the repo docs
  do not mention it.
- **Severity / risk:** P3 — the backend always sends a valid envelope, so it triggers only on a
  contract regression.
- **Proposed phase:** operator action before FASE 21. **Dependencies:** n8n access.
- **Acceptance:** a deliberately invalid POST to the webhook returns HTTP 400 and the event goes
  `dead_letter` immediately; `docs/integrations/n8n.md` records the workflow version checked.
- **Status:** `to-verify`.

### GAP-NOTIF-COVERAGE — **decided 2026-10-26 (owner): keep as is**

> **Decision:** the MVP keeps the current notification coverage; no new Telegram messages are added.
> `docs/integrations/n8n.md` records it. What remains `to-verify` is only whether the operator's n8n
> workflow really matches the documented table (it lives outside this repository).

- **Description (original finding):** only 3 of the 8 event types produce a Telegram message (`order.confirmed`,
  `price_approval.requested`, `order.cancelled`); the rest are delivered to n8n and ignored. This
  matches `n8n.md`'s "optional" rows but has never been confirmed as the intended MVP scope.
- **Evidence:** *notes* (5S) + *static* (`n8n.md:95-101`).
- **Severity / risk:** P3. **Phase:** owner decision, then n8n-side work. **Dependencies:** none.
- **Acceptance:** owner states which events must notify; n8n.md table matches the workflow.
- **Status:** `to-verify`.

### Telegram / notification state (informational)

- Backend default: `N8N_EVENTS_ENABLED=false` in `.env.example` (verified). With it false nothing is
  claimed and events stay `pending`. The effective value of a local `.env` is **not** recorded here.
- Last recorded outbox state (5S, 2026-09-10, notes): 26 delivered / 0 pending / 0 `dead_letter`.
  The 5 `dead_letter` rows of 5R were replayed in 5R-A (notes) and are **not** outstanding.
  Current database contents were **not** queried in this pass.

## C. Functional defects and limitations

### DEFECT-TZ-DEFAULT-UNSETTABLE

- **Description:** a tenant cannot set its timezone back to the default `UTC`.
- **Evidence:** *static + runtime* — `UpdateTenantSettingsDto.timezone` is
  `@IsIn(Intl.supportedValuesOf('timeZone'))` (`update-tenant-settings.dto.ts:21`) while
  `DEFAULT_TIMEZONE = 'UTC'` (`tenant-settings.service.ts:21`). On Node v24.19.0 that list has 418
  entries and **does not contain `UTC`** (checked 2026-10-26), so `PATCH {timezone:"UTC"}` must fail
  validation. HTTP-level reproduction not run.
- **Severity / risk:** P3 (workaround: any other zone). **Phase:** small fix, any block.
- **Acceptance:** `PATCH {timezone:"UTC"}` returns 200 and the same value on `GET`; test added.
- **Reproduction (2026-10-26):** over HTTP, before the fix, `PATCH /administration/tenant-settings {"timezone":"UTC"}` → **400**
  (`timezone must be one of the following values: …`), on Node v24.19.0 where the list has 418 names and no `UTC`. The web
  picker had the same gap (it also could not offer `UTC` to a tenant on another zone).
- **Fix (commit `7855019`):** API accepts every runtime name plus exactly `UTC`; the web helper offers `UTC` once.
- **Status:** `closed-with-evidence` — after the fix: `UTC` → 200 and read back; `America/Guayaquil` → 200 then back to `UTC`;
  `Mars/Phobos`, `utc `, ``, `UTC+5`, `Not/AZone`, `123` → 400. Unit tests on the DTO and the web helper/form. (`null` is
  treated by `@IsOptional` as "omitted" — unchanged, not part of this defect.)

### LIMIT-SERIALIZED-LOT-SALES — **decided 2026-10-26 (owner): MVP scope decision, not a defect**

> **Decision:** recorded in [ADR-0039](../decisions/0039-mvp-scope-serialized-lot-sales.md). Variants
> without serial/lot sell as today; serialized/lot-tracked variants keep being rejected with **422**
> and the rejection must have no side effects. No phase is assigned. **Code change:** the cart used to
> answer `409` for these variants; it now answers `422` like checkout. New integration suite
> `sales-serialized-lot-rejection.integration.test.ts` proves, against the database, that a rejection
> leaves no cart item, order, reservation, idempotency record, audit row or `event_outbox` row, and that
> the `Idempotency-Key` stays reusable. **Status: `closed-with-evidence`** for the 4 new tests (passed
> in the real-PostgreSQL run of 2026-10-26). Reopens only on an explicit scope change.

- **Description (original finding):** variants flagged serialized or lot-tracked cannot be sold: cart and order creation
  reject them (`carts.service.ts:322`, `orders.service.ts:714`). No approved model links
  `order_items` to `product_serials`/`product_lots`, and `inventory_movements` has no serial/lot
  column.
- **Evidence:** *static*, in code and in `database.md`.
- **Severity / risk:** P3 for a generic MVP, **P1 if the first customers sell serial-numbered
  appliances** — owner to confirm. **Phase:** not assigned. **Dependencies:** ADR + schema.
- **Acceptance:** an ADR defines the order↔serial/lot link and movement traceability; the 422 is
  replaced by a tested flow.
- **Status:** `open` (known limitation, unscheduled).

### DEFECT-WEB-TEST-UNHANDLED *(new)*

- **Description:** `pnpm test` in `apps/web` exits non-zero although all tests pass: Vitest catches
  one unhandled `TypeError: Cannot read properties of undefined (reading 'then')` at
  `products-mobile.tsx:183`, triggered by a click in `products-mobile.test.tsx`.
- **Evidence:** *runtime* — 138 files, 1009 tests passed, 1 error, exit non-zero (2026-10-26,
  reproduced twice). Production code awaits `apiFetch(...)`, so the likely cause is a test mock that
  returns `undefined`; not confirmed.
- **Severity / risk:** P2 for CI (a red `test` job), P3 for runtime.
- **Phase:** before FASE 19. **Acceptance:** `pnpm --filter @saas-inventory/web test` exits 0.
- **Status:** `open`.

## D. Verification gaps

### PG-VERIFY-FULL-RUN

> **First full run on the current tree — 2026-10-26** (isolated instance on port 55433 by temporarily
> editing the tool's `PORT`, reverted afterwards; the development database on :55432 was not touched).
> Result: **635 tests — 582 passed, 45 failed, 8 skipped; 53 files, 14 failed** (+2 failed suites in
> `multi-tenancy-rls`), and 5 structural checks failed (`52 tables exist — found 54`,
> `43 tenant-owned tables — found 45`, …). **Not green.** The `EBUSY` teardown error did not occur this
> time. Diagnosis (see `DEFECT-INTEGRATION-STALE-TESTS`): the failures look like **tests and fixtures
> that were not updated** after the October rework (migrations 0031–0050, customer/taxId validation,
> default-role permissions, read-scope), not product regressions — but that is a reading of the error
> messages, not a proof; no baseline run of the previous commit was made.
> The 8 skipped tests are all in `multi-tenancy-rls` (they depend on its two aborted suites). Passed in
> that run: `sales-serialized-lot-rejection` (4/4, new), `sales-transition-concurrency` (15/15),
> `roles-crud` (12), `users-rbac` (21), `platform-support` (14), `platform-tenant-onboarding` (9),
> `tenant-logo` (5), `bulk-receipts` (9), `import` (27) and `import-worker` (8). A second, targeted run of
> the four sales suites touched by this work confirmed the fixed `P7` and the same 6 outdated tests.
> Raw log: `scratchpad/pgverify-run.log` (git-ignored, not preserved by the repository).

- **Description (original finding):** no complete, green real-PostgreSQL integration run exists for the current tree.
- **Evidence:** *static* — 52 integration test files now. Last recorded totals: 503/40 files
  (F18-10) → 557/43 files (Login+Usuarios block, **5 and 7 failures on two runs**, attributed to
  contention under `fileParallelism` without proof). Roles and onboarding/support suites were
  reported passing on an isolated instance (:55433). Everything since (split payments, Kardex
  changes, view_all, logos, bulk load, exports, approval numbers…) has **no recorded run**. Not run
  in this pass: a development PostgreSQL is live on :55432, which `tools/pg-verify` needs.
- **Severity / risk:** P1 — it is the only proof of RLS/tenant behaviour.
- **Phase:** first step of FASE 19. **Dependencies:** exclusive port, or the temporary port override
  used in earlier blocks (revert afterwards).
- **Acceptance:** one run reports 0 failed / 0 skipped; the "flaky under contention" claim is either
  demonstrated (isolated reruns of failing tests pass) or the deadlock is fixed.
- **Status:** `closed-with-evidence` (2026-10-26). **Before:** 635 tests, 45 failed, 8 skipped, 2 aborted suites, 4 structural
  checks failed. **After** (commits `7855019` + `3e86244`): `pnpm … verify` on an isolated instance — **parallel phase 52
  files / 662 tests passed; serial phase 2 files / 23 tests passed; 0 failed, 0 skipped; "All checks PASSED"** (54 tables,
  45 tenant-owned all with RLS + FORCE + policy, 43 permissions, role/grant audits). **Not** proven: stability over repeated
  runs — two intermediate runs each showed one failure, both root-caused to the deadlock described in
  `TEST-FLAKY-DEADLOCKS`; the final run was a single clean pass.
- **Known environmental noise:** the harness's `EBUSY` on `.verify-pgdata` teardown (documented
  since F18-04) and the web build's Windows `EPERM` symlink step (documented since FASE 12) were
  **not re-checked** here.

### DEFECT-INTEGRATION-STALE-TESTS *(new)*

- **Description:** in the 2026-10-26 run, 45 integration tests and 2 suites fail in 14 files; the
  messages point at outdated expectations rather than behaviour regressions:
  `inventory-stock` (11), `movements-summary` (7), `inventory-movements-date-filter` (4),
  `sales-customers` (4), `sales-exceptional-pricing` (3 + my P7, since fixed), `sales-cart-orders` (3),
  `sales-returns-approvals-history` (3), `inventory-summary` (3), `transfers-summary` (2),
  `inventory-transfers` (1), `platform-summary` (1), `sales-returns` (1), `migrations` (1 — counts 52
  tables, now 54), and `multi-tenancy-rls` (2 suites aborted: its fixtures insert into a `categories.slug`
  column that no longer exists and a now-generated `customers.display_name`).
  Representative causes seen: the `Vendedor` template now holds `inventory.view` (tests expect 403);
  `taxId` must be 10 digits for `cedula`; customer names are standardised/upper-cased; GET-by-id of an
  approval returns 404 to a Supervisor/Vendedor with no location assignment (ADR-0035 read scope).
- **Severity / risk:** P2 for FASE 19 — **the per-table cross-tenant isolation test for `categories` and
  `customers` did not run**, so that proof is currently missing (other tables in that suite passed).
- **Phase:** first step of FASE 19. **Acceptance:** each failing test is either updated to the current
  rules (with the rule it now encodes stated) or the product bug is fixed; a full run reports 0 failed.
- **Status:** `closed-with-evidence` — all 45 tests updated to the current schema/rules (intent kept, no test removed or
  weakened; one count assertion relaxed with a stated reason: `platform-summary`, parallel files register tenants), green in
  the 2026-10-26 full run. Details in commit `3e86244`.

### DEFECT-API-TEST-TYPECHECK *(new)*

- **Description:** `tsc --noEmit -p test/tsconfig.json` reports 2 errors in files this work did not
  touch: `test/inventory/bulk-receipts.integration.test.ts(65)` (`body` is not a known option of the
  inject helper) and `test/sales/sales-order-transitions.integration.test.ts(203)` (`import.meta`
  needs a newer `module` setting). `pnpm --filter … typecheck` therefore cannot pass.
- **Evidence:** *runtime*, 2026-10-26. **Severity:** P3 (CI hygiene). **Phase:** before FASE 19.
- **Acceptance:** the API `typecheck` script exits 0. **Status:** `closed-with-evidence` (commit `3e86244`; `tsc --noEmit -p test/tsconfig.json` exits 0).

### TEST-FLAKY-DEADLOCKS *(new)* — root cause found

- **Description:** earlier notes (CLAUDE.md, the 557/43 run) attributed random integration failures to "contention under
  `fileParallelism`" without proof. On 2026-10-26 the PostgreSQL log of three consecutive full runs showed the real cause:
  `deadlock detected` between ordinary test queries and statements that **replay migration SQL over the whole shared
  database** — `ALTER TABLE "audit_log" NO FORCE ROW LEVEL SECURITY` / `ALTER TABLE "orders" …` (the migration-0047 backfill test)
  and `INSERT INTO tenant_memberships … SELECT … FROM users` (the migration-0029 backfill test). The victim was an unrelated
  test each time (R15, U9, the migrations RLS check): a 500 or a flipped `relforcerowsecurity`.
- **Fix (commit `3e86244`):** those two files are renamed `*.serial.integration.test.ts`, excluded from the parallel phase
  and run afterwards, one file at a time (`vitest.integration.serial.config.ts`; `pnpm test:integration:all` runs both;
  `pg-verify` runs both). The 0047 replay is faithful again (full SQL, with its ALTERs).
- **Evidence:** run with the two phases → 662 + 23 tests passed, no `deadlock detected` in the log.
  **Limit:** one clean run, not a statistical proof of stability.
- **Status:** `closed-with-evidence`. Any new test that replays migration SQL or does DDL on shared tables must use the
  `.serial.` suffix.

### OBS-DEV-CREDENTIAL-IN-SPEC *(new, informational)*

- `docs/ui-ux/UI-UX-SPEC-001.md` contained a QA login and password for the local development tenant
  (introduced by commit `1283de8`, one occurrence in tracked files). CLAUDE.md §7.4 forbids committing
  credentials.
- **Action 2026-10-26:** the literals were replaced by the placeholders `<QA_ADMIN_EMAIL>` /
  `<QA_ADMIN_PASSWORD>`; `git grep` finds no remaining occurrence in the working tree.
- **Exposure assessment:** the account belongs to the ephemeral local database `saas_inventory_dev`
  (`qa-tenant`, a non-routable `@dev.local` address); the repository has **no remote and was never
  pushed**, so the value has not left this machine through Git. It was **not** tested by logging in.
  Residual risk: the value still exists in Git history (`1283de8` and later) and, if that password
  was reused for anything real, it must be treated as exposed and **rotated**. If the local QA account
  is kept, rotate its password anyway.
- Not rewritten: Git history (needs explicit authorization). Informational: `tools/pg-verify` seeds
  use fixed, documented dev-only passwords for throwaway instances (`DevPassword123!` in
  `seed-qa-data.ts` / `dev-server.ts`) — not changed.
- **Status:** `fixed-pending-validation` (working tree clean of the literal; history untouched).

### Unit-test baseline (verified 2026-10-26)

| Suite | Result |
| --- | --- |
| `apps/api` unit | 72 files, **790 passed**, exit 0 (was 70 / 778; +12 = UUID guard, filter, DTO) |
| `apps/web` unit | 138 files, **1010 passed**, 1 unhandled error, exit non-zero (`DEFECT-WEB-TEST-UNHANDLED`, still open) |
| `apps/api` typecheck (src + `test/tsconfig.json`) / eslint | pass / pass (2026-10-26, after the fixes) |
| `apps/web` typecheck / eslint | pass / pass |
| Web build | not run (known Windows `EPERM` at the trace step, unchanged) |

### QA-EVIDENCE-PERSISTENCE

- **Description:** the QA 5A–5S campaign's raw evidence (snapshot and result files, QA tenant
  fixtures) is not in the repository. `scratchpad/` is git-ignored and now contains only dev logs.
  The campaign results survive in `roadmap.md` prose and in session notes.
- **Severity / risk:** P3 — results cannot be re-audited. **Phase:** FASE 19 (re-run the isolation
  probes as committed tests) and FASE 23.
- **Acceptance:** the isolation/IDOR probes exist as repeatable integration tests in the repo.
- **Status:** `open`.

### QA-VISUAL-REGRESSION

- **Description:** 5S verified frontend pages at HTTP level only; visual, responsive and interaction
  regression was never executed, and the FASE 18 reports were validated by jsdom tests only.
- **Evidence:** *notes* (5S, `5S-UI-05` in UI-UX-SPEC-001). **Phase:** FASE 23.
- **Status:** `open`.

## E. UI/UX redesign — declared finished, not matched to the written spec

### UIUX-SPEC-VS-IMPLEMENTATION — **decided 2026-10-26 (owner): option B**

> **Decision:** close `UI-UX-SPEC-001` with a delivered / deferred table (now its §0) and schedule a
> small *UI tokens + primary blue* block **after FASE 19 and before FASE 22**. The spec is no longer
> "in progress", and it is explicitly **not** "UI finished". **Status: `open`** until that block runs
> (scheduled in `roadmap.md`, not started).

- **Description (original finding):** `UI-UX-SPEC-001` is still marked "EN CURSO — LOTE 1 de 3"; Lotes 2 and 3 were
  never produced. Verified state of its approved decisions in `apps/web`:

  | Spec decision | Verified state |
  | --- | --- |
  | Spanish UI (`DECISION-LANG`) | **Implemented** (login and shell are Spanish) |
  | Compact nav rail (`DECISION-NAV-RAIL`, 68 px, hover/focus → 232 px) | **Partly**: rail exists at 64 px, expanding on hover to 256 px; `focus-within`, tablet pin and `--nav-bg = primary` not verified/absent |
  | Blue primary `#2F6FED` (`DECISION-PRIMARY`) | **Absent**: no match in `apps/web`; `tailwind.config.ts` has an empty `extend` |
  | Design tokens in `:root` (`DS-01/02`) | **Absent**: `globals.css` defines no custom properties |
  | Phone layouts, mobile tab bar | **Implemented** (≈35 web commits, 2026-10-22…26) — this is what the "redesign" delivered; not specified in the spec |

- **Severity / risk:** P3 (no security impact) but a documentation-integrity problem: the spec
  describes work that was not done and omits work that was.
- **Phase:** owner decision now; tokens/theme in a later UI block. **Acceptance:** the spec is either
  closed with a "delivered / won't do / deferred" table per decision, or the missing items are
  scheduled.
- **Status:** `open`.

## F. Roadmap and documentation

### ROADMAP-F22-F23-SPLIT

- **Description:** the owner proposed redefining FASE 22 as scenario-based demo preparation
  (`DEMO-01…DEMO-12` + "Reset Demo") and FASE 23 as owner-driven "use and destroy/repeat" QA over it.
  Recorded in `UI-UX-SPEC-001.md` §22.3 as "registered, **not applied**".
- **Status:** `closed-with-evidence` — **approved by the owner on 2026-10-26** and applied: the FASE 22
  and FASE 23 rows of `roadmap.md` now carry the new definitions, and `UI-UX-SPEC-001` §22.3 says so.
  Still open and small: decide whether `DEMO-01…DEMO-12` needs its own short ADR when FASE 22 starts.

### DOC-STALE

- `CHANGELOG.md` still lists only the project-foundation entry under `[Unreleased]`.
- `CLAUDE.md` "Current project status" had no entry for work after the Login+Usuarios block; its
  opening paragraphs still say "No role/permission CRUD exists yet" and "No other business
  functionality exists yet" (historical, now flagged as such).
- `roadmap.md` "Current status" stopped at FASE 18 + QA (fixed in this pass).
- **Status:** `fixed-pending-validation` for roadmap and `CLAUDE.md`; `CHANGELOG.md` `open`.

### DOC-ADR0022-TRIGGER-DRIFT *(new)*

- **Description:** ADR-0022 carries an amendment dated 2026-10-05: the exceptional-discount approval
  trigger moved from `min_price` to **`base_price`** (`min_price` stays the hard floor
  `max_discount_below_min_percent`). The code matches the amendment
  (`SalesPricingService.classify` → `below_base`, `unitPrice < ctx.basePrice`). At least nine other
  documents still describe the trigger as "below `min_price`": `database.md`, `modules.md`,
  `security.md`, `threat-model.md`, `information-inventory.md`, `f17-gaps.md`,
  `f17-screen-catalog.md`, the FASE 12/13 paragraphs of `CLAUDE.md` and of `roadmap.md`.
- **Evidence:** *static* — ADR-0022 amendment, `sales-pricing.service.ts:10,40`, grep of the docs.
  The other documents were **not** edited here: they are historical per-phase text and aligning them
  is its own review.
- **Severity / risk:** P3 (documentation integrity; pricing rules are security-relevant, so a reader
  following the older text would misjudge when approval is required).
- **Owner confirmation (2026-10-26):** `base_price` is the current rule.
- **Resolution:** a dated "Update (2026-10-26)" pointer to the ADR-0022 amendments was added — not a
  rewrite, the phase text is kept as history — to `modules.md`, `security.md`, `database.md` (2
  places), `f17-screen-catalog.md` (2), `f17-gaps.md`, `frontend-screen-specs.md` (2), `roadmap.md`
  (FASE 13) and `CLAUDE.md` (status banner + catch-up). Reviewed, **no edit needed**: `threat-model.md`
  and `information-inventory.md` only mention the hard floor `max_discount_below_min_percent`, which
  is still keyed to `min_price`. Not annotated: `database.md` ~l.1052 (a general rationale sentence).
- **Acceptance:** each listed document either states the current trigger or carries a pointer.
- **Status:** `fixed-pending-validation` (docs only; no tooling checks prose).

## G. Items already tracked elsewhere (not duplicated)

- Reporting gaps — [`architecture/reporting/data-gaps.md`](../architecture/reporting/data-gaps.md)
  (e.g. `GAP-TRANSFER-CYCLE-TIME`, `GAP-MULTI-STATUS`, `GAP-PLATFORM-AGGREGATE`, `GAP-SA-BILLING`).
- Frontend gaps — [`architecture/frontend/f17-gaps.md`](../architecture/frontend/f17-gaps.md)
  (e.g. `GAP-SUSPENDED-TENANT-UX`, `GAP-IMPORT-PROGRESS`, `GAP-QR-PRINT`).
- Deferred refund registry — [`future-refunds.md`](future-refunds.md).
- Their current status was **not** re-audited in this pass.

## H. Closed, with the evidence level stated

| ID | What | Evidence |
| --- | --- | --- |
| `GAP-ROLE-CRUD` | custom-role CRUD, ADR-0034 | *static*: `roles.controller.ts`, migration `0032`, `roles-crud.integration.test.ts`; passing run reported in notes, not re-run |
| `GAP-SA-CREATE-TENANT` / `GAP-SA-IMPERSONATION` | onboarding + support sessions, ADR-0036 | *static*: `platform-tenants/`, `platform-support/`, migration `0033`, 2 integration files; passing run reported in notes, not re-run |
| `GAP-COST` | weighted-average cost, ADR-0037 | *static*: `reports/kardex/kardex-report.controller.ts`, migration `0034` |
| `FINDING-5R-N8N-UNROUTABLE-ORDER-CANCELLED` | n8n 422 on `sales.order.cancelled` | *notes* only: operator fixed the workflow; 5R-A replayed 5/5 to `delivered` |
| `GAP-5RA-DEDUPE-MARK-COMPLETED` | missing "Mark Completed" node | *notes* only: re-validated with a fresh cancellation |

A `closed` row whose evidence is *notes* only should be re-confirmed during FASE 19 / FASE 23.

## I. Verification log — pre-FASE 19 closure (2026-10-26)

**Environment.** Windows 11, Node v24.19.0, pnpm workspace, `embedded-postgres` 18.4.0-beta.17. Integration runs used
`tools/pg-verify` with **`PG_VERIFY_PORT=55433`** — a throwaway instance whose data directory is deleted at the end. No
real customer data: every fixture is generated by the tests.

**The development database `saas_inventory_dev` on port 55432 was not modified.** Evidence: every connection string the
runs used is built from the 55433 port (the run logs contain no reference to 55432); the same process (PID 19128) was
listening on 55432 before, during and after; the tool's default is unchanged and its data directory
(`tools/pg-verify/.verify-pgdata`) did not remain. This is evidence of non-use, not a before/after dump of that database.

| Step | Command | Before | After |
| --- | --- | --- | --- |
| Full integration (reproduction) | `pnpm --filter @saas-inventory/pg-verify verify` (port 55433) | 635 tests: 582 pass / 45 fail / 8 skipped, 2 aborted suites, 4 structural checks failed | — |
| HTTP defects (reproduction) | same, `PG_VERIFY_TEST_FILTER="test/http/http-input-validation"`, controllers reverted | 50 tests: 24 pass / 26 fail (UUID 500 ×20, empty body 500 ×2, `UTC` 400 ×2, 2 wrong expectations of mine) | — |
| Full integration (final) | `PG_VERIFY_PORT=55433 pnpm --filter @saas-inventory/pg-verify verify` | — | parallel 52 files / 662 pass; serial 2 files / 23 pass; **0 failed, 0 skipped; All checks PASSED** |
| API unit | `pnpm --filter @saas-inventory/api test` | 778 | 790 |
| Web unit | `pnpm --filter @saas-inventory/web test` | 1009 (+1 unhandled error) | 1010 (+1 unhandled error, unchanged) |
| API typecheck / lint | `tsc --noEmit` (+ `-p test/tsconfig.json`), `eslint .` | 2 test type errors | 0 / clean |

**Effective coverage of the isolation question** — see `GAP-F19-RLS-IDOR-DEPTH`: database-level isolation is now proven for the
representative tables (incl. `categories`, `customers`) and every tenant-owned table has RLS + FORCE + a policy; HTTP-level
cross-tenant probing of the post-5S surface is **not** done. FASE 19 is **not** complete and tenant isolation is **not**
declared fully validated.

**Open risks after this pass:** `GAP-F19-RLS-IDOR-DEPTH` (new surface unprobed); `DEFECT-WEB-TEST-UNHANDLED`;
`GAP-NOTIF-RETRY-BACKEND`; `FINDING-N8N-RESPOND-INVALID` and `GAP-NOTIF-COVERAGE` (n8n side, unverifiable from the repo);
`QA-EVIDENCE-PERSISTENCE` / `QA-VISUAL-REGRESSION`; `UIUX-SPEC-VS-IMPLEMENTATION`; the credential still present in Git
history (`OBS-DEV-CREDENTIAL-IN-SPEC`, rotation advised); repeated-run stability of the integration suite not demonstrated.
