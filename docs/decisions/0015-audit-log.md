# ADR-0015: Audit Log

## Status

Accepted

## Context

Both regulatory/trust expectations for a business inventory system and the platform's own
incident-response needs (e.g. investigating a suspected cross-tenant access bug — see the
[threat model](../security/threat-model.md)) require being able to answer who did what, when,
where, and with what before/after effect — not just current-state data.

## Decision

A dedicated, append-only `AuditLog` in the CORE module (see
[modules.md#core](../architecture/modules.md#core) and
[database.md#audit-log-vs-domain-events-vs-application-logs](../architecture/database.md#audit-log-vs-domain-events-vs-application-logs)),
separate from operational application logs (see
[security.md#logging-and-audit](../architecture/security.md#logging-and-audit)). Every entry
captures actor (user or platform admin, with type), tenant_id (nullable for global/SuperAdmin
actions), action code, entity type + id, before/after state (JSONB), correlation id, and
timestamp. Initial set of audited actions listed in
[modules.md#audit](../architecture/modules.md#audit) — auth events, permission changes, tenant
lifecycle, inventory adjustments, and any SuperAdmin action touching a tenant, extended as new
modules are built.

## Alternatives considered

- **Rely on operational/application logs instead of a dedicated audit table.** Rejected: operational
  logs are typically retained for a shorter window, are not necessarily queryable in a
  structured, per-entity way, and are more likely to be reconfigured/rotated for operational
  reasons that have nothing to do with audit retention requirements. A dedicated table with its
  own (indefinite, or explicitly-decided) retention policy keeps audit history independent of
  operational log lifecycle.
- **Database-level audit via triggers on every table instead of application-level writes.**
  Not rejected as a future *addition* (it would catch changes even from a path that forgot to
  write an audit entry), but not the primary mechanism now — trigger-based audit tends to capture
  raw row diffs without the higher-level "why"/action-code context (e.g. distinguishing
  `INVENTORY_ADJUSTED` from `INVENTORY_TRANSFERRED` when both change the same columns), which
  matters more for this platform's actual audit use cases than a generic column diff would.
  `PENDING DECISION` on whether triggers are added later as a defense-in-depth backstop, similar in
  spirit to RLS for tenant isolation.

## Consequences

- Every module that mutates tenant data writes an audit entry as part of the same use case (see
  [backend.md](../architecture/backend.md#layering-inside-each-module)) — this is a
  per-service-method responsibility, checked in review, not automatic.
- The audit log itself is never updated or deleted (per
  [CLAUDE.md §7.7](../../CLAUDE.md#77-database) — historical data is never removed without an
  explicit, documented decision), so its own storage growth is a long-term operational
  consideration, not addressed by this ADR.
- SuperAdmin actions are audited identically to tenant actions, closing a gap that would otherwise
  make the highest-privilege identity in the system the least observable one.
