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
- **Status:** `open` (static) — reproduce first.

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
- **Status:** `to-verify`.

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
- **Status:** `to-verify`.

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
- **Status:** `open` (confirmed by validator contents).

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
- **Status:** `to-verify`.
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
- **Status:** `open`.

### DEFECT-API-TEST-TYPECHECK *(new)*

- **Description:** `tsc --noEmit -p test/tsconfig.json` reports 2 errors in files this work did not
  touch: `test/inventory/bulk-receipts.integration.test.ts(65)` (`body` is not a known option of the
  inject helper) and `test/sales/sales-order-transitions.integration.test.ts(203)` (`import.meta`
  needs a newer `module` setting). `pnpm --filter … typecheck` therefore cannot pass.
- **Evidence:** *runtime*, 2026-10-26. **Severity:** P3 (CI hygiene). **Phase:** before FASE 19.
- **Acceptance:** the API `typecheck` script exits 0. **Status:** `open`.

### OBS-DEV-CREDENTIAL-IN-SPEC *(new, informational)*

- `docs/ui-ux/UI-UX-SPEC-001.md` (committed) contains a local QA login and password for the
  development tenant. It belongs to a throwaway local database, not production, but CLAUDE.md §7.4
  forbids committing credentials. **Not changed here** (removing it is an owner call and the value may
  still be needed locally); recommended to move it out of the repository. **Status:** `open`.

### Unit-test baseline (verified 2026-10-26)

| Suite | Result |
| --- | --- |
| `apps/api` | 70 files, **778 passed**, exit 0 |
| `apps/web` | 138 files, **1009 passed**, 1 unhandled error, exit non-zero (`DEFECT-WEB-TEST-UNHANDLED`) |

Lint, typecheck and the web build were not run in this documentation-only pass.

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
