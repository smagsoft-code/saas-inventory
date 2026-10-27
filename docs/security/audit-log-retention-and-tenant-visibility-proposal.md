# Audit log: retention policy and tenant visibility — PROPOSAL (not approved, nothing implemented)

Status: **proposal for review.** No row is deleted, no job exists, no endpoint exposes the audit log to a tenant. Every figure below is an engineering
judgement, not a legal requirement: nothing here claims that a given retention period is mandatory. Items marked **[human validation]** need a
legal / data-protection / commercial decision before they are implemented.

Context: FASE 19 added two read-audit events — `support.tenant_read` (every `GET` under a support session, ADR-0036 amendment) and `platform.read`
(tenant detail and admin-invitation reads, option B of `PLATFORM-READS-NOT-AUDITED`). They are high-volume compared with the write audits, which is
why retention and visibility are decided now. See [ADR-0015](../decisions/0015-audit-log.md), [ADR-0032](../decisions/0032-platform-admin-authentication.md),
[ADR-0036](../decisions/0036-tenant-onboarding-and-support.md).

## 1. What `audit_log` holds today (read from the schema, migrations and code)

Table: `id, tenant_id (nullable, FK → tenants ON DELETE RESTRICT), actor_type ('user' | 'platform_admin' | 'system'), actor_id, action_code,
entity_type, entity_id, before_state / after_state (jsonb), correlation_id, ip_address (inet), created_at`.

Integrity and access facts that constrain any retention design:

- **Append-only by grants.** `app_tenant` has `SELECT, INSERT` only; `app_platform` has `SELECT, INSERT` only (migrations 0002, 0022). **No role can
  `UPDATE` or `DELETE`** — except the migrator/superuser, used by migrations (0047 deliberately did `NO FORCE ROW LEVEL SECURITY` to backfill rows).
  A trigger forbids changing `tenant_id` on update. ADR-0015 and CLAUDE.md §7.7: history is never removed without an *explicit, documented decision*.
- **RLS on `tenant_id`**, `FORCE ROW LEVEL SECURITY`, policy `tenant_id = nullif(current_setting('app.tenant_id'), '')::uuid`. Rows with
  `tenant_id IS NULL` (platform actions without a single target) are invisible to every tenant.
- **Indexes:** `(tenant_id, entity_type, entity_id)`, `(tenant_id, created_at)`, `(action_code, created_at)`. No partitioning.
- **No retention, archive or purge exists** anywhere in code or docs (ADR-0015 calls it "indefinite, or explicitly-decided"). Tenants are never deleted.

Event families (from the code; the list is not closed):

| Family | Examples of `action_code` | Written by | Personal data / sensitive content |
| --- | --- | --- | --- |
| Tenant write audits | `order.*`, `customer.*`, `user.*`, `role.*`, `inventory.adjustment.created`, `inventory_transfer.*`, `sales_return.*`, `price_approval.*`, `product.*`, `qr.*`, `tenant_settings.updated`, `cart.*` | `AuditLogService` (tenant tx) | `before_state/after_state` can hold customer names, e-mail, phone, tax id (`customer.*`), user e-mail / full name (`user.*`); `actor_id` = a user; `ip_address` |
| Platform lifecycle writes | `tenant.suspended`, `tenant.activated`, `tenant_admin.invitation_*` | `PlatformAuditLogService` | `actor_id` = platform admin; `ip_address`; invitation state (no token, no e-mail) |
| Support session | `support_session.started/ended`, `support.warehouse_status_changed` | `PlatformAuditLogService` | session `reason` (free text written by platform staff), mode, expiry; platform admin id; IP |
| **Support reads** | `support.tenant_read` | `SupportReadAuditInterceptor` | platform admin id, route template, outcome/status, mode, query-parameter **names**, addressed resource uuid, correlation id, IP. No values, no bodies. |
| **Platform reads** | `platform.read` | `PlatformReadAuditInterceptor` | same shape; `entity_id` = tenant uuid; `tenant_id` NULL for an unknown uuid |
| Migration backfill | `order.confirmed.date_backfill` | migration 0047 | order dates |

Personal data worth flagging **[human validation]**: `ip_address` (of tenant users and of platform staff), `actor_id` (links an action to a person),
and the PII snapshots inside write-audit `before_state/after_state`. The two read-audit families carry **no** customer data — only platform-staff
identity, IP and request metadata.

## 2. Growth

Estimate (not measured on a production workload): one audit row ≈ 0.3–0.5 KB of heap plus three indexes ≈ **~1 KB per row in total**.
`support.tenant_read` is one row per `GET`; a screen is ~3–10 `GET`s, so a 30-minute support session is on the order of 10²–10³ rows (≈ 0.1–1 MB).
Even a pessimistic 10⁴ rows/day is ≈ 10 MB/day ≈ 3–4 GB/year, concentrated in few tenants. `platform.read` is a handful of rows per SuperAdmin
visit to a tenant page. Growth is not alarming for years, but it is unbounded and write-heavy during incidents, and it is the family with the least
long-term evidentiary value per row.

## 3. Retention proposal

Principles: do not weaken what protects investigations; treat the high-volume read trail differently from the write trail; never let retention
touch business tables; make every deletion itself auditable.

**Scope A — write audits and session audits (everything except the two read families): keep indefinitely, as ADR-0015 states today.** They are
low volume, they are the evidence for "who changed what", and the PII inside them is a separate question (data-subject requests, anonymisation of
`before_state/after_state`) that should be designed on its own **[human validation]**. No change proposed.

**Scope B — `support.tenant_read` and `platform.read`: proposed 24 months online, then archive, then delete.**

Why 24 months (judgement): long enough to cover a normal yearly security/compliance review plus the delay with which an access complaint or an
incident is usually discovered; short enough that the table does not carry years of per-request rows. The `support_session.started/ended` rows
(Scope A, kept) still record **that** a session happened, with mode, reason, admin and duration, after the per-request detail is gone.

Alternatives:

| Option | Retention of Scope B | Consequence |
| --- | --- | --- |
| A | 12 months online, then archive/delete | Smallest table; a complaint older than a year can only be answered from the archive and the kept session rows |
| **B (proposed)** | **24 months online, then archive/delete** | Balanced; one extra year of searchable detail |
| C | 36 months | More detail for long investigations; ~50 % more rows retained |
| D | Indefinite, partition by month | Maximum evidence; unbounded storage and a standing PII/IP footprint for platform staff |

Procedure (proposed, **to be built only after approval**):

1. **Archive first, then delete, verified.** A platform-side batch job exports Scope B rows older than the cutoff, grouped by month, to compressed
   JSON Lines in immutable object storage with a SHA-256 manifest. Deletion only for months whose archive and checksum were verified.
2. **A dedicated database role** (new migration, justified because no role may delete today): e.g. `app_audit_retention`, `SELECT, DELETE` on
   `audit_log`, no other table, not usable by the API request path, credentials separate from `app_tenant` / `app_platform`.
3. **Predicate is hard-coded:** `action_code IN ('support.tenant_read','platform.read') AND created_at < cutoff`, deleted in small batches
   (e.g. 5 000) so autovacuum and locks stay calm. Never a free-form SQL, never configurable by a tenant.
4. **Dry-run by default** (counts only); a real run needs an explicit flag. Each run writes its own audit row (`audit_log.retention_run`,
   `actor_type = 'system'`, cutoff, counts per month, archive manifest hash).
5. **Legal hold:** an operator-set hold (per tenant, or global) that makes the job skip the affected rows **[human validation]**.
6. **Trace and permission:** the job runs as a scheduled platform process, not from an HTTP route; changing the retention window is a code/config
   change reviewed like a migration, not a tenant or SuperAdmin runtime setting.

Risks and open questions **[human validation]**: whether any customer contract or applicable data-protection law sets a minimum or a maximum for
access logs of this kind; whether the archive itself must be deletable on request; where the archive lives and who can read it; time-zone of the
cutoff (use UTC); a mistaken predicate is irreversible on the live table (hence archive-first and dry-run); partitioning by month
(`DROP PARTITION`) is faster but is a larger migration of a table with a foreign key and RLS — not proposed for the first step.

## 4. Tenant visibility proposal

Goal: a tenant can see **only** the support/access activity on **its own** company. Proposal for a read-only endpoint, e.g.
`GET /api/v1/administration/support-access-log` (final path to be chosen with the administration module owners).

Authorisation
- A **new explicit permission**, e.g. `audit.support_access.view`, in the permission catalogue and `DEFAULT_ROLE_TEMPLATES` — granted by default to
  the founding **Administrador** only, backfilled for existing tenants by a migration (same pattern as `core.roles.manage`, migration 0032). It must
  **not** reuse `inventory.view`, `sales.orders.view_all` or any general read permission: those would silently grant sight of platform-staff activity.
- `@RequirePermissions` plus the normal guard chain; support sessions and `@PlatformOnly()` tokens must **not** reach it (a platform admin cannot
  read it through the read-through — it is an ordinary tenant route that needs a tenant principal; keep it that way and test it).

Tenant scoping (defence in depth)
- The tenant is **only** `@CurrentTenant()` (the validated context). The DTO is `whitelist + forbidNonWhitelisted`, so `tenantId`, `tenantSlug` or any
  unknown parameter is a 400; path and header steering are ignored (as in `ISO-SUP-10`). No body.
- The query runs in `withTenantTransaction` as `app_tenant`: `FORCE RLS` on `tenant_id` is the second layer, and rows with `tenant_id IS NULL`
  (platform-wide actions) are invisible by construction. `app_tenant` already has `SELECT` on `audit_log`: **no new grant is needed.**
- A fixed predicate on top of RLS: `actor_type = 'platform_admin' AND action_code IN (<whitelist below>)`.

What is shown (whitelist of event kinds) and what is not

| Event | Shown to the tenant? | Notes |
| --- | --- | --- |
| `support_session.started` / `ended` | **Yes** | when, mode (read / intervention), duration, the stated **reason** (free text written by platform staff — decide whether it may be shown, or only a category **[human validation]**) |
| `support.tenant_read` | **Yes** | when, area (a human label mapped from the route template, e.g. "Inventario › Movimientos"), outcome, addressed resource id (the tenant's own uuid) |
| `support.warehouse_status_changed` | **Yes** | it changed the tenant's data; shown with before/after status |
| `platform.read` | **Not in v1** (option) | a platform read of the company record / invitation status; low sensitivity; can be added later as "ficha de empresa consultada" |
| `tenant.suspended` / `activated`, `tenant_admin.invitation_*` | Not in v1 | platform lifecycle, not support access (the tenant sees the effect directly) |
| Tenant users' own write audits (`order.*`, `user.*`, …) | **Out of scope** | a different feature (a general tenant audit trail) with its own permission and PII design |
| `system` events, backfills (`*.date_backfill`) | **No** | internal |

Fields: `occurredAt`, `kind`, `mode`, `area` (label), `outcome`, `statusCode`, `resourceId`, `sessionId` (opaque, to group a session),
`correlationId` (opaque, so the tenant can quote it to support), and for the session rows `reason`/`expiresAt`.
**Never returned:** the platform admin's id or e-mail (show a neutral "Soporte de la plataforma", optionally a stable per-tenant pseudonym such as
"Agente #3" so repeated access by the same person is visible without naming them **[human validation]**), `ip_address`, `before_state/after_state`
verbatim, route templates with internal names, query-parameter names, tokens, cookies, headers, anything from `platform.read`.

Query surface: `from` / `to` (default last 30 days, maximum span 180 days), `kind` (one of the whitelist), `sessionId`, `page` / `pageSize`
(default 25, max 100), fixed order `created_at DESC, id DESC` (`created_at ASC` optional). Reuses `(tenant_id, created_at)`; the action filter is
cheap after it. Total count for pagination is computed over the same bounded window.

Errors and abuse: no permission → 403; unauthenticated → 401; unknown parameter, malformed uuid, inverted or oversized range → 400; no existence
oracle (an unknown `sessionId` of another tenant behaves exactly like a non-existent one: empty page). Rate limiting as other tenant reads.

Self-audit: reading the log writes a tenant-side `audit.support_access_viewed` row (actor = the user, no filters stored beyond the kinds), so the
viewing of the access log is itself traceable; that event is **not** in the whitelist above (no recursion).

Interaction with retention: the endpoint can only show what is still online; after Scope B is archived the tenant sees the kept
`support_session.*` rows and the online window of reads. State this window in the UI.

Tests required when approved (mirroring the existing suites): permission matrix (Administrador, other roles, no permission, anonymous, platform
token / support session), cross-tenant (query / path / header / body steering, a second tenant with its own rows, `tenant_id IS NULL` rows), field
whitelist (no admin id, no IP, no params), pagination and range limits, an attempt to read `platform.read` / write audits, self-audit row, and a
real RLS check as `app_tenant`.

## 5. Decisions requested

1. Retention of Scope B: option A / **B** / C / D, and whether the archive step is acceptable.
2. Whether the Scope A PII inside write audits needs its own minimisation/anonymisation workstream.
3. Approve a new migration for the retention role (`app_audit_retention`) — only after (1).
4. Approve the new permission and the default grant to the founding Administrador; the final endpoint path.
5. Whether the support-session **reason** may be shown to the tenant verbatim, and whether platform staff appear as a neutral label or a pseudonym.
6. Whether `platform.read` should become visible later.
