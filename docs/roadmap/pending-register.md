# Pending-items register

**Baseline:** repository state verified on **2026-10-26** — branch `develop`, HEAD `2215f5d` at the
time of the first version (the documentation commit `7ca9b94` followed), clean working tree, 119
commits, **no upstream configured (nothing has ever been pushed)**. Updated the same day after the
owner's decisions on six items; each affected entry carries a *decided* banner.

*Note (2026-10-29) — the sentence "nothing has ever been pushed" above is historical and **no longer true**:* `develop` was pushed to
`origin` (GitHub) on 2026-10-29 with its whole history and the repository was then made public by the owner. HEAD is now `9a53cc5`.
Consequence for the credential recorded in `OBS-DEV-CREDENTIAL-IN-SPEC`: see its update.

*Note (2026-10-28):* the `MIG-*` entries of section D were added later, on top of HEAD `2734363` (`develop`, 155 commits, still no
upstream); the baseline above is the 2026-10-26 one and was not re-verified.

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

### AUDIT-RETENTION-AND-TENANT-VISIBILITY *(new, 2026-10-27 — PROPOSAL drafted, awaiting approval; nothing implemented)*

- **What:** the two read-audit families added in FASE 19 (`support.tenant_read`, `platform.read`) have no retention policy, and the tenant cannot see the support activity on its own company.
- **State of the system (verified in the schema and migrations):** `audit_log` is append-only by grants — `app_tenant` and `app_platform` have `SELECT, INSERT` only, no role can `UPDATE` / `DELETE` — with FORCE RLS on
  `tenant_id`; no retention, archive or purge exists; `app_tenant` already has `SELECT` (a tenant-visible endpoint would need **no new grant**, but a deletion job would need a new role / migration).
- **Proposal:** [audit-log-retention-and-tenant-visibility-proposal.md](../security/audit-log-retention-and-tenant-visibility-proposal.md) — keep write / session audits indefinitely (ADR-0015); for the two read
  families, **24 months online → verified archive → delete** by a dedicated least-privilege role, dry-run by default, each run audited, legal hold; and a read-only tenant endpoint behind a **new explicit permission**
  (default: founding Administrador), tenant taken only from the validated context + RLS, a whitelist of event kinds and fields (no platform-admin identity, no IP, no parameter names), bounded pagination and ranges, self-audit.
  Every period is an engineering judgement, not a legal requirement; legal / data-protection validation is requested.
- **Decisions requested:** retention option and archive step; minimisation of PII inside write audits; the retention-role migration; the new permission and endpoint path; whether the support-session reason may be shown
  verbatim and how platform staff appear to the tenant; whether `platform.read` becomes visible.
- **Status:** `open` — proposal only. No row deleted, no job, no endpoint.

### PLATFORM-READS-NOT-AUDITED *(characterised 2026-10-27; option B approved and implemented 2026-10-27)*

- **Scope, verified by HTTP and by reading `audit_log` (`ISO-SUP-23…26`):** `GET /platform/tenants`, `/:id`, `/:id/admin-invitation` and `GET /platform/summary` are pure `@PlatformOnly()` control-plane routes
  (ADR-0032). They never consult a support session (`TenantGuard` returns for `@PlatformOnly()` before its support branch, so `request.supportSession` is never set and the
  `SupportReadAuditInterceptor` — keyed on it — is inert for them). Observed: identical answers (200, same shape) with no session, a read session, a write session, an expired session and a
  suspended target tenant; the only `audit_log` rows of the admin are the session start/end and, for the suspension, `tenant.suspended`. **No read row exists for any of the four, in any state.**
  Refusals (anonymous 401; tenant Administrador 401/403) carry no tenant data and write no row.
- **What they expose:** list / by id → `id, name, slug, status, isDemo, createdAt` (company metadata; the list covers **every** tenant — a support session on tenant A does not narrow it); invitation →
  `id, status, sentAt, expiresAt, acceptedAt, revokedAt` (no email, no token); summary → aggregates only (no tenant id or name). No RLS-protected tenant data, no PII. This is the reason the support-read
  audit did not cover them: the gap it closed was *what support read inside a tenant*.
- **Classification:** *comportamiento esperado por diseño* for the support question (they are not support reads), and a **risk that requires a decision** for the accountability question (should a
  SuperAdmin's control-plane reads be audited at all?). Severity low (P4): company metadata and aggregates, admin-only, no tenant-scoped data.
- **Options (not implemented):** (A) accept and document — no audit of control-plane reads; (B) audit only the two tenant-specific reads (`:id`, `admin-invitation`), tenant-attributable (`tenant_id` = the path
  tenant), same fields and fail-closed rule as `support.tenant_read`; (C) audit all four. Minimal change for B/C: an **opt-in** interceptor/decorator on those handlers (action `platform.read`, actor = the admin,
  route template, outcome, query key names) — **not** a blanket interceptor on `@PlatformOnly()`: `GET /platform/support-sessions/current` is read on every SuperAdmin page render (the support banner) and would flood
  `audit_log`. It must stay GET-only so the writes' own audit rows (`tenant.suspended`, `tenant_admin.invitation_*`, `support_session.*`) are not duplicated, and must not touch `support.tenant_read`.
- **Decision and implementation (option B, `ISO-SUP-23…28`):** only `GET /platform/tenants/:id` and `GET /platform/tenants/:id/admin-invitation` are audited, through an **opt-in** per-handler decorator
  `@AuditPlatformRead(resource)` → `PlatformReadAuditInterceptor` (not a blanket interceptor on `@PlatformOnly()`). `GET /platform/tenants`, `GET /platform/summary` and
  `GET /platform/support-sessions/current` (read on every SuperAdmin page for the support banner) are deliberately **not** audited — pinned by the tests (five banner reads, the list and the summary: no row).
  Row: `action_code = platform.read` (distinct from `support.tenant_read`), `actor_type = platform_admin`, `actor_id` = the verified admin, `tenant_id` = the path tenant **if it exists**,
  `entity_type = tenant`, `entity_id` = the path uuid, `correlation_id`, `ip_address`; `after_state` = `method, route` (template), `resource` (`tenant` | `tenant_admin_invitation`), `outcome`,
  `statusCode`, `queryKeys` (names only). No tokens, cookies, headers, bodies, response data or parameter values (asserted with a secret query value and the admin's own tokens).
- **Behaviour:** fail-closed like `support.tenant_read` — a successful read writes its row before the response leaves; if it cannot be written the read answers 500 with no tenant data and no cause,
  after one attempt (`ISO-SUP-28`, forced over HTTP; reads resume afterwards and the unaudited routes are unaffected). Authorisation is untouched: `@PlatformOnly()` and the guards run first, so
  anonymous 401 / tenant Administrador 401-403 are exactly as before and write no row; the routes still do not read a support session. HTTP answers are unchanged for unknown and malformed ids
  (`:id` 404, invitation 200, malformed 400). An unknown uuid is recorded with `tenant_id = NULL` (the foreign key is never asked to hold it; the invitation route answers 200 for it); a malformed id is
  not audited (nothing was read). Write events (`tenant.suspended` / `activated`, `support_session.*`) stay one row each, no `platform.read` for a POST (`ISO-SUP-27b`).
- **Evidence:** suite `isolation-platform-reads-audit` 7/7 alone; unit `platform-read-audit.interceptor.spec.ts` (6 cases); API unit 833/833; full integration 781 parallel + 31 serial = 812, 0 failed (two full
  runs; the first failed once on a flaw of the characterisation test itself — it compared the *length* of the tenant list across phases, which moves when parallel files register tenants — fixed to compare the
  element shape, no assertion weakened).
- **Residual risk / open:** the audit rows' retention and their visibility to the tenant remain undecided; the list is still an unaudited read of every tenant's company metadata (by decision); `tenant_id`
  is attribution, not proof of authorisation; the interceptor duplicates the small fail-closed pipeline of `SupportReadAuditInterceptor` instead of refactoring that file (left untouched on purpose).
- **Status:** `closed-with-evidence` for option B.

### FINDING-SUPPORT-LEDGER-401 *(new — found and fixed 2026-10-27, FASE 19 regression pass)*

- **Severity: P3, functional (not a leak).** A regression I introduced with `81d4277` (`FINDING-LEDGER-REFERENCE-LEAK`): the movements list and the Kardex (JSON and export) began to take
  `@CurrentUser()` to scope the document references by seller. A platform admin in a support session has no tenant principal, so the ADR-0036 read-through lost those screens: `GET
  /inventory/movements` and `GET /reports/kardex[/export]` answered **401**. Found while verifying the downloads under support (`ISO-SUP-20`).
- **Reproduced before fixing:** `ISO-SUP-22` failed with `401` on the movements list; `ISO-SUP-20` saw the Kardex export 401 (`exp-before.log`).
- **Fix (no permission, migration or ADR change):** a new `@CurrentReaderId()` decorator returns the tenant user's id, or — only when a support session is active — the platform admin's id; the three **read**
  routes use it (writes keep `@CurrentUser()`, so support stays closed to them). A platform admin id is never a `users.id`, so the seller-scope filter matches nothing: support receives the
  rows and the stock arithmetic with the commercial references **masked** (generic label, no number / uuid / reason / actor). **Policy choice for review:** support is treated as a reader
  *without* `sales.orders.view_all` (least privilege); showing support the references would be a one-line change in the decorator's consumer and needs an owner decision.
- **Evidence:** `ISO-SUP-22` (movements, Kardex JSON, xlsx: 200, SALE row served, `Venta` label, order number / uuid absent, three `success` audit rows); `ISO-SUP-20` (Kardex export 200).
- **Status:** `closed-with-evidence`. Note: other seller-scoped reads keyed off `@CurrentUser()` (orders, approvals, returns, payments) were never open to support and are unchanged.

### SUP-READ-NOT-AUDITED *(characterised earlier — fixed 2026-10-26, FASE 19)*

- **Severity: P3 (accountability), not an access-control failure.** ADR-0036's "read-through" lets a platform admin with an active support session
  `GET` the ordinary tenant API (read-only, bound to the session's tenant, every non-`GET` refused — `ISO-SUP-10/12/13`), and the curated
  `support/users` / `support/warehouses` reads. None of those reads left a per-request audit row; only `support_session.started/ended` and the one
  curated write were audited (`ISO-SUP-14` characterised it). The tenant could not later see *what* support read (customer PII, prices, financial data).
- **Reproduced before fixing:** `ISO-SUP-15/16/17/18` failed with zero `support.tenant_read` rows while every read returned 200 (including the curated reads).
  The scope is therefore **all** support GETs, not only the general read-through.
- **Fix (no table, migration or permission):** a global `SupportReadAuditInterceptor` writes one `support.tenant_read` row per GET under a support session,
  through the existing `PlatformAuditLogService` (actor = platform admin, tenant = session tenant, entity = support session; method, route template,
  outcome / status, mode, query **key names**, resource uuid — no values, tokens, bodies or response data). **Fail-closed on success** (the row is written
  before the response; if it cannot be written the data is withheld); on an error outcome a failed audit write is only logged. ADR-0036 amendment.
- **Evidence:** `ISO-SUP-15…19` 5/5 after the fix (4 failed before); `ISO-SUP-14` rewritten to assert the rows; `support-read-audit.interceptor.spec.ts`
  (8 cases, incl. the fail-closed behaviour and a single write attempt on a failed success-audit); API unit 827/827; the whole `test/security` folder 114/114 after the final code change; the full integration run (776 parallel + 23 serial, 0 failed) predates a small reorder of the interceptor's error handling and was **not repeated** afterwards.
- **Residual risk / still open:** (1) **volume** — one row per request, a busy session writes many; no retention or sampling decision was made;
  (2) the rows live in the tenant's `audit_log` but **no tenant-facing view** of them was added or verified; (3) the audit-write-failure path is now ALSO forced over HTTP (`ISO-SUP-21`: JSON and download refused with 500, one attempt each, no data, nothing recorded, reads
  resume when the audit works); (4) the downloads under a support session were exercised (`ISO-SUP-20`: customers, transfers, product catalog, Kardex: 200 and one audited read each; **orders and
  payments exports are 401 for a support principal** because they are keyed off the acting user — pre-existing, ADR-0036 — and are audited as `denied`); (5) platform-only reads that are not
  support reads (`GET /platform/tenants`, `/:id`, `/:id/admin-invitation`, `/platform/summary`) are not audited by this mechanism and were left unchanged — **characterised**, see
  `PLATFORM-READS-NOT-AUDITED` below (decision needed);
  (6) requests refused by the guards (no session, expired, suspended tenant, non-GET) are, by design, not read rows; (7) `correlation_id` is the client's
  `Correlation-Id` header when it is a UUID (project-wide convention, `main.ts`), so it is traceability, not identity; (8) `ip_address` is `request.ip`,
  and the app sets no `trustProxy`: it is the socket peer (not spoofable through `X-Forwarded-For`) but behind a reverse proxy it would be the proxy's
  address — a deployment setting to decide; (9) **retention** of these rows and **tenant access** to them are undecided — a proposal is drafted (see `AUDIT-RETENTION-AND-TENANT-VISIBILITY`); (10) the **Kardex PDF** under a support session is now verified by HTTP with the PDF text extracted (`ISO-SUP-29…31`): masked, tenant-bound, fail-closed.
- **Status:** `closed-with-evidence` for the per-read audit of support GETs; the residual points above stay open.

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
  approver edit were not attacked. (The ledger document labels were audited afterwards: `FINDING-LEDGER-REFERENCE-LEAK`.)
- **Status:** `closed-with-evidence` (no finding).

### FINDING-LEDGER-IMPORT-JOB-ID *(new — found and fixed 2026-10-26, FASE 19 ledger second pass)*

- **Severity: P4.** `referenceId` of an Excel-import movement = the import job uuid, returned to every `inventory.view` holder; the job routes need
  `import.execute`, so the reader cannot open it. Reproduced (`ISO-LED-10`, first run) and fixed in `MovementsService.toResponse`; the Kardex never carried it.
- **Status:** `closed-with-evidence` (`ISO-LED-10`, unit spec).

### FINDING-LEDGER-REFERENCE-LEAK *(new — found and fixed 2026-10-26, FASE 19 ledger audit)*

- **Severity: P3 (intra-tenant disclosure of commercial metadata).** Any `inventory.view` holder — the default Vendedor included — read, in
  `GET /inventory/movements`, another seller's **order number** (`Venta #ORD-…`, `Pedido #…`), the **order uuid**, the free-text
  reason and the **actor**; the Kardex JSON and its xlsx / pdf export carried the order number (also on return rows) and the return
  number appeared in the movement list. Found by reading the services/repositories, then **reproduced before fixing**: `ISO-LED-01/02/03/06`
  failed on the first run ("owner sees the other seller's order number"). No stock figure or cost was involved and no other tenant's data.
- **Fix (no new permission, no migration):** ADR-0040 point 5 — the reference is resolved under the seller scope of the order
  (`ledgerOrderReferenceScope` / `ledgerReturnReferenceScope` in `sales/orders/order-seller-scope.ts`): own orders unless
  `sales.orders.view_all`; returns also for the warehouse (`inventory.returns.manage`). Rows and stock arithmetic stay for everyone;
  an out-of-scope reference shows a generic label and no number / uuid / reason / actor. The export inherits it (built from the same response).
- **Behaviour change:** the default Supervisor and Bodega no longer see order numbers in the ledger (they keep return numbers).
- **Evidence:** `ISO-LED-01…07` pass after the fix (matrix section "inventory ledger"); unit specs in `movements.service.spec.ts` and
  `kardex-report.service.spec.ts`. The xlsx case (`LED-04`) failed on the first run only because of a case-sensitivity slip in the
  test itself (the helper lower-cases the sheet text); the leak it covers goes through the same `getKardex` response as the JSON case.
- **Second pass (transfers, imports, typed text):** attacked over HTTP (`ISO-LED-08…12`, incl. xlsx cells and real PDF text). Transfer
  codes are not restricted information (the transfers list serves them to every `inventory.view` holder) and transfer movements carry no
  free text: no leak. Import movements leaked the **import job uuid** through `referenceId` — `FINDING-LEDGER-IMPORT-JOB-ID` (P4, opaque id of
  an `import.execute` object), reproduced then fixed by dropping `referenceId` on `import_job` rows. The typed `reason` of receipts / adjustments
  is shown to every ledger reader **by decision** (operator audit trail; masking it would defeat the ledger) — accepted risk, pinned by `LED-11`.
- **Third pass (reports and transfer notes) — `closed-with-evidence`, no defect:** `ISO-LED-13…18` attacked `sales-summary`, `payments` (+ export), `movements-summary`,
  `transfers-summary`, `imports-summary`, the transfers list / detail / xlsx / pdf export and the transfer `notes` over HTTP with two tenants. Seller scope
  holds on `sales-summary` and `payments` (a seller's `placedByUserId` / customer / seller filters cannot widen it); the inventory aggregates are
  tenant-wide by design and carry no order reference or free text; `imports-summary` is `import.execute` only and tenant-isolated; create-time transfer
  `notes` are served to `inventory.view` holders by the transfers list / detail (warehouse text, **accepted risk**, like the typed ledger reasons) and are in
  no download or ledger row; receive-time `notes` are persisted and returned by no route.
- **Fourth pass (`ISO-LED-19…21`) — `closed-with-evidence`, no defect:** `inventory-summary` (exact per-tenant totals 40 / 70; tenant-wide for `inventory.view` holders by design;
  cost totals field-gated on `pricing.cost.view`; a foreign warehouse / location / category id answers exactly like a non-existent one), `product-catalog` (own tenant only;
  a foreign id or search is indistinguishable from "nobody has it"; no cost / floor price in any row; unknown steering parameters are 400; the total of a page past the end
  is 0 by documented design) and **transfer cancel** (the route has no body: `notes` and any other field are ignored — 200, never stored; read back from the transfer, receipt
  and audit tables; seller 403, other tenant 404, double cancel 409).
- **Still open / not verified:** a tenant owner may want a switch to hide typed reasons / transfer notes from sellers (not built, no evidence it is needed).
- **Test fragility CONFIRMED and FIXED (test only) — `platform-summary`:** › "suspending a tenant moves it from the active bucket to the suspended bucket (delta assertion)" failed once in a
  full parallel run (`expected +0 to be -1`) and passed alone and in later full runs. **Reproduced deterministically** (a temporary copy of the test, since deleted, that registers ONE tenant
  between its two snapshots, as another file does in parallel) with the identical signature `expected +0 to be -1`. Cause: the test compares deltas of GLOBAL tenant counts
  (`byStatus.active`, `totalCount`) over a table every parallel file inserts into; the product (`count(*) filter …`) is correct. Not a product defect. The exact assertions must stay exact —
  the semantic ("this suspension moves one tenant from active to suspended") needs a quiet table, so the faithful fix is to run this file in the **serial** phase, not to loosen the comparison. **Done:** the file is now `platform-summary.serial.integration.test.ts`, which the existing
  `vitest.integration.config.ts` excludes from the parallel phase (`exclude: **/*.serial.integration.test.ts`) and `vitest.integration.serial.config.ts` includes — no script change. Assertions unchanged
  and exact. Verified: it ran in the serial phase only, alone 8/8, and in the full run (774 parallel + 31 serial = 805, 0 failed). Production untouched.
- **Test fragility CONFIRMED and FIXED (test only) — `bulk-receipts`:** › "DOUBLE SUBMIT: the same Idempotency-Key loads the stock once" failed once in a full parallel run (409 "clave … ya se usó con un
  archivo … distintos") and passed alone and in later full runs. **Reproduced at the cause:** two ExcelJS builds of the same rows are byte-identical within a second
  (`0190902686f10b27` = `0190902686f10b27`) and differ across a second boundary (`bca4ef83b9a17147`), because the workbook's `created` / `modified` properties are stamped at
  second precision (read back: `…:17.000Z` vs `…:18.000Z`). The request hash is `sha256(file bytes | location | date)`, so the contract is "same FILE" — which the real retry satisfies —
  and the test builds the file twice. Not a product defect; the idempotency semantics are right. **Done:** the `post` helper accepts a prebuilt `Buffer`; the DOUBLE SUBMIT test and the concurrent-submits test (three builds raced the same way) build the workbook once and send those exact bytes (the first also asserts the
  hash is unchanged); the deliberately different file stays a separate build. Verified: 9/9 three times, and with a 1.2 s pause forced between the two submissions (a temporary copy, deleted) the test still passes — it no
  longer depends on crossing a second boundary. The idempotency assertions are untouched; production untouched.
- **Status:** `closed-with-evidence` for order / return references; the points above stay pending.

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
- **Resolution (D-8E.3, 2026-10-29):** confirmed by reproducing it for the single file; the cause was the test, not production code — the "Generar QR" test clicked a card with inventory access enabled while the `apiFetch` mock returned `undefined`, so `.then` ran on `undefined`. Fixed with `mockResolvedValueOnce({ data: [] })` in that test. Local: `products-mobile.test.tsx` 15/15 with no unhandled error; full `apps/web` suite 138 files / 1010 tests, exit 0 (D-8E.15). Not separately observed in CI beyond the green run `40975871156`.
- **Status:** `closed` (locally verified; see `CI-WEB-INTERMITTENT-TESTS` for the other web test issues).

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
- **Update 2026-10-29 — the exposure assessment above is outdated.** The repository has since been pushed to GitHub with its whole
  history and made public by the owner, so the literal in `1283de8` and later commits is now **publicly readable**, not
  confined to this machine. It is still unknown whether that password was ever used for anything real (it was not tested).
  Treat it as exposed: rotate it if it was reused anywhere, and rotate the local QA account's password regardless. The
  history was **not** rewritten and rewriting a now-public history needs an explicit decision (it would not un-publish what
  was already fetched). Other secrets in history were not searched for in this pass.
- Not rewritten: Git history (needs explicit authorization). Informational: `tools/pg-verify` seeds
  use fixed, documented dev-only passwords for throwaway instances (`DevPassword123!` in
  `seed-qa-data.ts` / `dev-server.ts`) — not changed.
- **Status:** `fixed-pending-validation` (working tree clean of the literal; history untouched).

### Unit-test baseline (verified 2026-10-26)

| Suite | Result |
| --- | --- |
| `apps/api` unit | 72 files, **790 passed**, exit 0 (was 70 / 778; +12 = UUID guard, filter, DTO) |
| `apps/web` unit | 138 files, **1010 passed**, 1 unhandled error, exit non-zero (`DEFECT-WEB-TEST-UNHANDLED`, still open **at that date** — fixed on 2026-10-29, D-8E.3: 138 files / 1010 tests, exit 0) |
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

### MIG-IDENTITY-HISTORY *(new, 2026-10-28 — S3 adopted; deliveries 2a and 2b implemented and run on disposable 16.15 clusters)*

- **Description:** `migrate.ts` runs as whatever role `MIGRATOR_DATABASE_URL` authenticates as (the compose files use the image's
  superuser), never sets a role or checks `current_user`, and relies on Drizzle, which reads only the registry row with the highest
  `created_at` and never compares the hash of an applied migration. Consequences observed on synthetic clusters: an incremental run
  by a superuser login creates objects owned by that login; a missing/reordered/altered history ends in a silent no-op "success".
  [ADR-0041](../decisions/0041-migration-identity-and-history-integrity.md) records the approved direction (privileged bootstrap +
  limited incremental login with `SET ROLE`, manifest of privileged migrations `0000`/`0019`, no `CREATEROLE` on the incremental
  login, `drizzle` kept under the bootstrap owner with reduced grants, abort without repair on an inconsistent state).
- **Evidence:** *static* — `migrate.ts`, `0000` (l.42, 78, 83, 98–108), `0019`, `drizzle-orm@0.45.2` `dialect.js` l.44–71.
  *runtime (synthetic, not in the repository)* — PostgreSQL 16.15 disposable clusters: 39 scenarios passed (identity, `RESET ROLE`,
  `0019` with the role missing/existing, 11 inconsistent-history states, `drizzle` grants, RLS contract, `lock_timeout`), plus the
  repository's own `migrate.ts` and three integration files (56 tests) on a fresh 16.15 cluster.
- **Severity / risk:** P2 (integrity of the deployment path; no cross-tenant exposure is claimed).
- **Dependencies:** owner approval of each delivery; a way to run PostgreSQL 16.15 from the repository (see `MIG-PG16-HARNESS`); a
  configuration change for development setups whose migrator login is a superuser (names and compatibility rules documented in
  [migration-integrity.md](../architecture/migration-integrity.md) §9, not implemented). The permanent `GRANT CREATE ON DATABASE` to
  `app_migrator` is approved only as an implementation proposal, applied exclusively by the bootstrap procedure; scope and risk are in
  §8 of that document, and it is applied nowhere. No production database exists.
- **Acceptance:** a fresh install and an incremental update both leave every `public` object owned by `app_migrator`; a wrong
  identity, a pending privileged migration and each inconsistent state abort before any statement that changes anything and leave
  the catalog identical; a limited session cannot escalate with `RESET ROLE`; the narrowed `drizzle` grants complete an update and
  forbid `UPDATE`/`DELETE`/`TRUNCATE` of the history; all of it reproducible from the repository on 16.15.
- **Progress (delivery 2a, 2026-10-28):** pure checks of the journal, the registry-vs-journal state (exact prefix, forged `created_at`,
  skipped/unrecorded privileged migrations), the mode and the identity facts; `history-manifest.json` and `privileged-manifest.json` (`0000`,
  `0019`); a generator/check CLI that only appends.
- **Progress (delivery 2b, D-7.2, 2026-10-28):** the wrapper is wired into `migrate.ts` (`migration-runner/`): configuration contract
  (`MIGRATOR_*` variables, `--mode`, `--provision-only`), read-only fact gathering, `SET ROLE app_migrator`, Drizzle runs only after every check,
  final verification, and the bootstrap procedure for the incremental login (`NOINHERIT`, `SET`-only membership, `CREATE ON DATABASE`, narrowed
  `drizzle` grants). The history manifest is version 2 with an explicit `classification` and `reviewedIn` per migration (existing entries:
  `retroactive-review:D-7.2:2026-10-28`, no historic approval claimed); the generator plans and validates before writing; `.gitattributes` pins
  migrations to LF; `rls-window.ts` provides the checked `NO FORCE`/`FORCE` window for new data migrations. Verified on PostgreSQL **16.15**
  disposable clusters only: the harness `test:migration-harness` (37 tests, exit 0, cluster removed) and `tools/pg-verify` on a 16.15 server built with `initdb`/`pg_ctl` (bootstrap from empty, bootstrap again, incremental as the limited login: all exit 0; then the existing integration suite, 784 + 31 serial tests, 0 failed; "All checks PASSED", exit 0). Unit suite 1021 tests / 83 files,
  `tsc` and `eslint` pass. Details and observed behaviour: [migration-integrity.md](../architecture/migration-integrity.md) §6b, §8, §10.
- **Progress (D-8A, 2026-10-28):** audit findings H1, H2, H8, H9, H10 addressed. One contract for every consumer (`MIGRATOR_BOOTSTRAP_DATABASE_URL`, shared rule in
  `@saas-inventory/config`; `.env.example` copyable as it is, checked by `env-contract.spec.ts`); the deprecated `MIGRATOR_DATABASE_URL` documented as bootstrap-only with its exact
  scope (it cannot apply ordinary migrations to an existing database); strict argument parsing before any read or connection (pnpm 9.15 delivery of `--` measured); explicit
  `--provision-only` preconditions (`PROVISION_PRECONDITION_FAILED`); an actionable `TEMPLATE`/adoption diagnostic; and a new refusal found by the harness: bootstrap mode on a
  never-provisioned existing database. H3 (post-run owner/RLS invariants), H6 (concurrency lock), the linter and CI remain open (D-8B…E). H5 stays a separate analysis.
- **Progress (D-8B, 2026-10-28) — H3:** owner and RLS invariants. A pre-commit hook runs inside Drizzle's own transaction (`current_user`, registry = journal, owners of `public` objects,
  RLS enabled ⇒ FORCEd, RLS not disabled, history not owned by `app_migrator`) and rolls the whole batch back; a post-commit audit re-checks and reports what cannot be undone. Limits, stated
  once: (1) only violations the batch introduces are blocking — pre-existing ones are warned about; (2) after a post-commit finding the violation is committed and becomes baseline, only a
  corrective migration fixes it; (3) Drizzle's pre-transaction `CREATE SCHEMA/TABLE IF NOT EXISTS drizzle` and the provisioning step are outside the guarded transaction; (4) the hook relies on
  `drizzle-orm@0.45.2` calling `client.begin` once (`INVARIANT_GUARD_NOT_INVOKED` otherwise); (5) privileges, policies and function bodies are not audited. H5 stays separate.
- **Progress (D-8C, 2026-10-28) — H6:** mutual exclusion. A session-level advisory lock (`pg_try_advisory_lock`, key `(0x53494d47, 1)`, per database) is taken after the connection and database check and held through the
  identity re-read, the history/baseline evaluation, the batch, the final checks, the post-commit audit and the provisioning transaction; configurable timeout (`MIGRATOR_LOCK_TIMEOUT_SECONDS`, default 60) with the stable
  `LOCK_NOT_ACQUIRED`. Proven on 16.15 with two independent OS processes (second waits and then sees `pending=0`; timeout; zero; provision-only; release after success and failure; SIGKILL of the holder). Limits:
  runs outside the wrapper (`drizzle-kit migrate`/`push`, hand-written `migrate()`, the test globalSetup, `psql`) do not take it; untested through a pooler; after a client crash the server keeps the lock until its
  current statement ends; waiters are not ordered.
- **Progress (D-8D.1, 2026-10-29):** the parser-unavailable path is tested (refuses before Drizzle, lock released, next run succeeds); the exceptions file is defined (schema v1), loaded by the wrapper before Drizzle and validated in two layers, shipped empty — no
  exception for the 51 historical migrations; the PL/pgSQL policy (ordinary = ERROR, privileged = WARNING, never "validated", low certainty reported apart) is documented in ADR-0041 decision 14 and pinned by tests. Still open: PL/pgSQL and dynamic SQL remain unanalysable;
  the paths that bypass the wrapper (`drizzle-kit migrate`/`push`, hand-written `migrate()`, the test globalSetup, `psql`); H5; CI (D-8E: implemented, awaiting a first real run).
- **Progress (D-8E, 2026-10-29):** an obsolete exception is no longer ignored when nothing is pending or under `--provision-only` (found by new harness tests, fixed in `run-migrations.ts`); CI added (see `MIG-PG16-HARNESS`).
- **Progress (D-8D, 2026-10-28):** the SQL/RLS linter (see `MIG-SQL-RLS-LINTER`), wired as step 6b of the wrapper. New runtime dependency: `libpg-query@16.8.1` (+ `@pgsql/types`, types only). Open decisions: the exceptions file
  format; whether a PL/pgSQL-aware tool (none exists in this ecosystem as WebAssembly) is worth adding; whether new migrations may use PL/pgSQL at all (today: only if declared privileged).
- **Status:** `open` (P2) — **implemented, not closed**. Remaining: the SQL/RLS linter (`MIG-SQL-RLS-LINTER`); the ownership audit
  (`MIG-OWNERSHIP-AUDIT`, independent); the Docker/CI path pinned to 16.15; moving `bootstrap-dev-roles`, the seeds and `reset-demo` off the legacy
  variable; the `ALTER ROLE … SET role` experiment (not run); validation against any database that really exists (none was touched).
  Developers must add `MIGRATOR_EXPECTED_DATABASE` to their environment (a clear `CONFIG_VARIABLE_MISSING` otherwise).

### MIG-SQL-RLS-LINTER *(new, D-7.2 — implemented in D-8D with documented limits)*

- **Description:** the wrapper does not understand the SQL it runs. Its text scan only finds `CREATE/ALTER/DROP ROLE`, `CREATE EXTENSION`,
  `RESET ROLE`, `SET [LOCAL|SESSION] ROLE` and `SET SESSION AUTHORIZATION`, and an explicit `ordinary` classification only records who decided.
  Observed in the harness: a migration with `GRANT ALL ON ALL TABLES IN SCHEMA public TO app_tenant` and another with `ALTER TABLE warehouses
  DISABLE ROW LEVEL SECURITY`, both classified `ordinary`, are executed by an incremental run, and RLS is left disabled.
- **After D-8B:** `DISABLE ROW LEVEL SECURITY` on a table that had RLS enabled, an unforced RLS table and a wrong owner are now refused before the commit by the owner / RLS invariants (a catalogue check of the RESULT, not of the SQL). `GRANT`/`REVOKE`, `SECURITY DEFINER`, `ALTER DEFAULT PRIVILEGES`, `CREATE DATABASE`, `COPY … PROGRAM`, dynamic SQL and the rest are still not seen; the harness still shows a `GRANT ALL … TO app_tenant` being executed.
- **D-8D (2026-10-28):** implemented — a linter over the PostgreSQL 16 grammar (`libpg-query@16.8.1`, WebAssembly, pinned), 45 rules with stable ids and severities by migration context, run by the wrapper on pending
  migrations before Drizzle and as a CLI. On the 51 existing migrations: 0 ERROR, 181 WARNING, 168 INFO, every file parses. **Not closed**: the parser has no PL/pgSQL support, so DO blocks and function bodies are reported as
  unanalysed (ERROR if ordinary, WARNING if declared privileged), dynamic SQL cannot be analysed at all, and a GRANT to a project role is only a WARNING. The exceptions file (`database/migrations/sql-lint-exceptions.json`, schema version 1) is now loaded and strictly validated by the wrapper and ships EMPTY (D-8D.1); the PL/pgSQL policy is fixed and tested. Details: [migration-integrity.md](../architecture/migration-integrity.md) §6e.
- **Owner decision (D-7.2):** this risk is accepted temporarily; the wrapper must not be presented as complete protection against privileged or
  RLS-affecting SQL.
- **Acceptance (minimum scope of the linter delivery):** it evaluates `GRANT`, `REVOKE`, `ALTER … OWNER`, `DISABLE ROW LEVEL SECURITY`, `NO FORCE ROW
  LEVEL SECURITY` (unrestored), `SECURITY DEFINER`, `ALTER DEFAULT PRIVILEGES`, `CREATE DATABASE` and `COPY … PROGRAM`, with a parser rather than a text
  scan, an explicit exception list for the twelve existing migrations with windows, and tests that fail on each of the nine; it runs in the
  history-manifest check and in `assessExecution`.
- **Status:** `open`.

### MIG-RLS-CONTRACT-NOT-ENFORCED *(new)*

- **Description:** a data migration run by an identity subject to RLS over `FORCE ROW LEVEL SECURITY` tables changes nothing and
  raises nothing, and is recorded as applied (observed; also described in `database.md`). Twelve applied migrations open a
  `NO FORCE` window (`0029`, `0035`, `0037`, `0041`–`0047`, `0049`, `0050`); none uses `row_security_active` or a raising guard.
  `0032` has no window. The contract in ADR-0041 (declared window, guards, set-based postcondition, explicit `FORCE`
  restoration and verification, `lock_timeout` with `RESET`) is documented only; no linter or test enforces it in the repository.
- **Evidence:** *static* — grep of `database/migrations/*.sql`. *runtime (synthetic, 16.15)* — contract scenarios R1–R10 and two
  controls (a naive migration is recorded with zero effect; an unrestored `FORCE` is committed).
- **Severity / risk:** P2 for future data migrations; the earlier twelve are applied and are not rewritten.
- **Acceptance:** a linter flags `NO FORCE` without a verified `FORCE`, `DISABLE ROW LEVEL SECURITY`, `row_security` changes,
  `SET SESSION AUTHORIZATION`, `SET/RESET ROLE` outside the manifest, top-level `BEGIN`/`COMMIT`, ownership changes, undeclared
  privileged statements and DML on forced tables outside a declared window, with an explicit exception list for the twelve; R1–R10
  run as integration tests.
- **Progress (D-7.2):** `migration-runner/rls-window.ts` implements the checked window (identity, initial `FORCE` state, `row_security_active`, caller's
  DML, independent postcondition, `FORCE` restored and verified, rollback on any failure) and is tested on 16.15, including the zero-effect trap. It is
  not applied to any existing migration, and no linter enforces its use.
- **Status:** `open`.

### MIG-0032-HISTORY-INCONCLUSIVE *(new)*

- **Description:** whether `0032_core_roles_manage_permission` (two `INSERT`s, no window) took effect in any particular existing
  database was never verified. A synthetic run shows that, under an identity subject to RLS, it inserts zero `role_permissions`
  rows without error; that observation does not show it happened anywhere real, and no existing database was inspected.
- **Evidence:** *runtime (synthetic)* only. No claim about any real environment is made or implied.
- **Status:** `to-verify` — would need an expressly approved, read-only inspection of the target database. Nothing is corrected.

### MIG-OWNERSHIP-AUDIT *(new)*

- **Description:** in a synthetic incremental run by a superuser login, four tables (`order_payments`,
  `platform_support_sessions`, `tenant_admin_invitations`, `tenant_logos`) ended up owned by that login instead of `app_migrator`.
  Whether any existing database has mixed owners is unknown. ADR-0041 forbids correcting ownership of an existing database before
  an expressly approved audit; any fix would be a **new** migration, never an edit of an applied one.
- **Audit scope (specification, not run):** owner of every relation, function, type and schema in `public`; the `drizzle` schema,
  its table and sequence; extension objects excluded; expected owner `app_migrator` (and the bootstrap owner for `drizzle`).
- **Independence:** a separate activity that does **not** block defining or building the new environment. It needs the owner's express
  authorisation naming a concrete database, read-only access (catalog queries only, no tenant data) and its result is a report; no
  existing database is marked as audited today, and none is connected to.
- **Status:** `to-verify`.

### MIG-EOL-HASH *(new)*

- **Description:** the repository has no `.gitattributes` and a Windows clone with `core.autocrlf=true` (set on the development
  machine) checks migrations out with CRLF line endings. That changes the raw SHA-256 Drizzle registers for each migration, and feeds
  Drizzle different text (for example newlines inside dollar-quoted function bodies). The migration-integrity manifests hold
  CRLF-normalised hashes and the registry is compared against raw/LF/CRLF variants, so the *checks* do not depend on the checkout; the
  text Drizzle executes still can.
- **Evidence:** *static* — no `.gitattributes`; `git ls-files --eol` shows the index and the working copy as LF on this machine;
  `git config core.autocrlf` is `true`.
- **Decision and change (D-7.2):** `database/migrations/** text eol=lf` added to a new `.gitattributes` (owner decision). It rewrites no history
  and changed no existing file here (100 tracked files already `i/lf w/lf`).
- **Severity / risk:** P3.
- **Status:** `resolved-pending-verification` — not yet checked on a Linux checkout or a fresh Windows clone with `core.autocrlf=true`; the
  canonical hash and the raw/LF/CRLF candidate set stay, because files can still travel outside git.

### MIG-PG16-HARNESS *(new — decision pending)*

- **Description:** the repository's real-PostgreSQL harness (`tools/pg-verify`) starts `embedded-postgres` **18.4.0-beta.17** on a
  fixed default port, while the compose files pin `postgres:16-alpine`. ADR-0041 takes 16.15 as the reference; the repository has no
  supported way to run its integration suite on 16.15. The 16.15 binaries used so far came from the EDB zip; their executables are
  not Authenticode-signed (they are byte-identical to those installed by the signed, hash-matched EDB installer).
- **Recommendation approved for design (2026-10-28):** two disposable paths kept **apart** from `tools/pg-verify` until parity is shown —
  local `initdb`/`pg_ctl` from a configurable 16.15 `bin` directory, and a Docker image pinned to 16.15 for CI (the compose files use
  the floating `postgres:16-alpine`). `embedded-postgres` is not a 16.15 source: the npm registry lists only betas for 16.x (newest
  seen `16.14.0-beta.17`). Docker is not installed on the development machine. Nothing is built yet.
- **Progress (D-7.2):** the local path exists: `apps/api/test/migration-harness/` (`MIGRATION_HARNESS_PG_BIN`) and `tools/pg-verify`
  (`PG_VERIFY_PG_BIN` + `PG_VERIFY_PORT`) build a disposable cluster with `initdb`/`pg_ctl` in a new temp directory (found and fixed: `pg_ctl start`
  with piped stdio never returns on Windows). The Docker image pinned to 16.15 for CI is **not** built.
- **Progress (D-8E, 2026-10-29):** `.github/workflows/ci.yml` has two new jobs (`migration-harness`, `pg-verify`), each with its own container `postgres:16.15@sha256:1beaa308...c61c` on 127.0.0.1, a per-run masked password and a mandatory `server_version_num = 160015` check; the harness and pg-verify attach to it by URL (`MIGRATION_HARNESS_SERVER_URL`, `PG_VERIFY_SERVER_URL`) after proving it fresh and loopback. Validated locally against a disposable 16.15 server (harness 141/141, pg-verify 59 checks and 815 integration tests). **Not observed:** a real GitHub Actions run, Docker, Node 20. See migration-integrity.md 10b.
- **Progress (2026-10-29, run finished 2026-10-30 00:06 UTC):** first completely green run on GitHub Actions — run `40975871156`, commit `9a53cc5`, push to `develop`: `ci` PASS (lint, typecheck, `Test` and, for the first time in CI, `Build`), `migration-harness` PASS, `pg-verify` PASS. This validates the container steps, the `server_version_num = 160015` check, the harness and `pg-verify` on a real Linux runner with Node 20. It is a **single** run (job/step statuses only; the logs were not readable, HTTP 403). The earlier runs of `2734363`, `1eec094` and `5d3ca26` failed or were cancelled for the reasons in `CI-TYPES-NODE`, `CI-WEB-INTERMITTENT-TESTS` and `MIG-CI-PGVERIFY-HANG`. See migration-integrity.md 10b.
- **Status:** `open` — implemented, locally validated and observed **once** fully green on a real runner; stability over several runs is not established. `tools/pg-verify` still defaults to the embedded 18.x beta when neither `PG_VERIFY_PG_BIN` nor `PG_VERIFY_SERVER_URL` is set.

### CI-TYPES-NODE *(new — fixed, 2026-10-29)*

- **Description:** `tsc` in `apps/api` failed on the first CI runs with TS2345 in `common/export/tabular-export.service.ts`, `reports/kardex/kardex-export.service.ts` and `reports/payments/payments-export.service.ts` (`doc.on('data'|'end'|'error', …)` "not assignable to parameter of type `'limit'`"). The failure pre-dates D-8E (the run of `2734363` failed at `Typecheck`).
- **Evidence:** *reproduced locally* in a clean clone by pointing the hoisted `.pnpm/node_modules/@types/node` at 20.17.6 (9 errors, identical message; 22.20.1 and 26.2.0 give 0). `apps/api` declared no `@types/node`; `@fastify/busboy` declares the only `'limit'` overload on `stream.Readable`. **Not observed:** the hoisting that the original runner really used (the logs were not readable), so that part is an inference.
- **Fix:** D-8E.11, commit `5d3ca26` — `@types/node@^22.10.0` declared in `apps/api` (lockfile 22.20.1, the clone typechecks even with the 20.17.6 link). Confirmed green in run `40975871156` (one run).
- **Status:** `closed` for the observed failure; watch the typecheck in later runs.

### CI-WEB-INTERMITTENT-TESTS *(new — fixed, stability not demonstrated)*

- **Description:** the `ci` job's `Test` step failed with a different `apps/web` test in two consecutive runs: `product-cart-modal.test.tsx › increments/decrements quantity via PATCH` (run of `5d3ca26`) and `kardex-explorer.test.tsx › clicking a row in "Ver todos" jumps…` (run of `8d55547`).
- **Evidence:** cause **from code analysis, not reproduced** (13 sequential and 16 parallel local runs of the two files, all passing, before the fix). Kardex: the heading "Todos los movimientos" renders at once while the rows arrive after two awaited calls, but the test read the row synchronously. Cart: the quantity buttons are `disabled` while a PATCH is in flight (`busy`), but the test clicked again as soon as the PATCH had been *called*.
- **Fix:** D-8E.15, commit `9a53cc5` — `findByText` / `waitFor(…toBeEnabled())`; tests only, no production code. Local: full `apps/web` suite 138 files / 1010 tests green. CI: green in run `40975871156`.
- **Status:** `open` (monitoring) — **one** green run does not show the flakiness is gone. Other tests with the same "wait for the heading, read the content synchronously" pattern were not searched for.

### MIG-CI-PGVERIFY-HANG *(new — open, root cause unknown)*

- **Description:** the `pg-verify` job stalled in step 10 (`db:reset-demo`), after the script printed `Demo tenant reset complete`, so `[PASS] "db:reset-demo" exited 0` never appeared. It happened in the runs of `1eec094` and `5d3ca26` (both ended `cancelled`, after about 46 minutes and 1 h 18 min). The runs of `8d55547` and `9a53cc5` finished (about 16 minutes each).
- **Evidence:** job/step statuses and a log excerpt pasted by the owner; the job logs themselves were not readable (HTTP 403). In local runs on Windows/Node 24 the same step always returned. **Cause not determined**: it could be a client or handle that does not close on Linux/Node 20, an intermittent condition, or something in PostgreSQL; none was shown.
- **Done (commit `8d55547`):** a time budget per `pg-verify` step (`PG_VERIFY_STEP_TIMEOUT_MINUTES`, default 15; `PG_VERIFY_INTEGRATION_TIMEOUT_MINUTES`, default 60) — a timeout is a FAIL that aborts the run; the diagnostic steps also run on `cancelled()`; temporary `[debug]` lines in `database/scripts/reset-demo-tenant.ts` activated by `RESET_DEMO_DEBUG_ACTIVE_RESOURCES=1` (`closing`, `returned`, and `process.getActiveResourcesInfo()` if the process is still alive 15 s later).
- **Open:** the `[debug]` output of the green runs was **not checked** (no log access), so it is unknown whether `closing` and `returned` appeared. **Do not remove the instrumentation yet** and do not declare the hang resolved: two stalls and two completions do not establish a cause or a fix.
- **Follow-up needed:** more runs of `pg-verify`, and the `[debug]` lines from the step log (readable in the browser), before deciding whether to remove the instrumentation or fix a real defect.
- **Status:** `open`.

### MIG-R1-SNAPSHOT *(new — closed 2026-10-28)*

- **Description:** the snapshot chain ended at `0048` while the schema (`price_approvals.approval_number`) had moved on with the
  hand-written `0050`, so `db:generate` would have proposed a duplicate `ADD COLUMN`.
- **Resolution:** (1) `database/migrations/meta/0050_snapshot.json` added (content generated by `drizzle-kit`, which named it
  `0051_snapshot.json`; `prevId` = `id` of `0048`). (2) The unique constraint `price_approvals_tenant_approval_number_key
  (tenant_id, approval_number)`, which the SQL of `0050` creates but neither the TypeScript schema nor the snapshots modelled
  (unlike its siblings `orders_tenant_id_order_number_key` and `sales_returns_tenant_return_number_key`), was added to
  `apps/api/src/database/schema/09-sales.ts` and to `0050_snapshot.json` **together** (a TypeScript-only change would make
  `db:generate` propose a duplicate `ADD CONSTRAINT`). Journal, SQL files (including `0050`) and other snapshots untouched.
- **Evidence:** *runtime* — on a temporary copy of the resulting state: the previous files unchanged by hash, no duplicated
  snapshot `id`, `drizzle-kit generate` reports "No schema changes, nothing to migrate" and creates no file; `git diff --check`
  clean. No database was involved.
- **Application checks (2026-10-28, no database):** with the changed `09-sales.ts` in place, the full API unit suite passes (951 tests
  in 80 files), `tsc --noEmit` (src and test projects) passes and `eslint .` is clean. Integration tests were **not** run for this
  change.
- **Status:** `closed-with-evidence` — **schema/snapshot synchronisation only**. Not covered by this closure: the integration suite
  against a real database for the changed schema file, and everything under `MIG-IDENTITY-HISTORY`, which is unrelated to this item.

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
