# ADR-0011: n8n as an External, Decoupled Automation Layer

## Status

Accepted — implemented in FASE 15 (`apps/api/src/event-processor/n8n/`, see
[integrations/n8n.md](../integrations/n8n.md)).

## Context

Notification/automation logic (starting with Telegram alerts, potentially expanding later) changes
faster and more experimentally than core business logic typically should, and the backend must not
be made fragile by, or blocked on, an external automation system's availability. See
[events.md#n8n-and-telegram](../architecture/events.md#n8n-and-telegram).

## Decision

n8n runs as separate infrastructure (not a service defined in `docker-compose.dev.yml` /
`docker-compose.prod.yml` — see [docker.md](../deployment/docker.md#n8n)) and is called only via
outbound webhook from the Event Processor, authenticated by a dedicated shared bearer secret
(`N8N_EVENTS_AUTH_TOKEN`, sent only as `Authorization: Bearer`, runtime-env only). The backend has
no n8n-specific code beyond "POST this event envelope to this one configured URL." If n8n is
unreachable, the business operation that produced the event has already committed successfully
(see [ADR-0010](0010-outbox-pattern.md)) — only notification delivery is delayed, and it is
retried automatically (permanent 4xx/redirect failures are dead-lettered rather than retried
forever). Topology (FASE 15): **one** generic events webhook, per-tenant/per-event routing done
inside n8n keyed by the envelope's `tenantId`/`eventType` — not per-tenant URLs, not a backend
`notification_preferences` model.

## Alternatives considered

- **Embed workflow/automation logic in the backend (e.g. a rules engine or direct integration
  code per notification type).** Rejected: couples business-logic deploys to
  notification-logic changes, and re-implements what n8n already provides as a visual workflow
  tool non-engineers (or engineers working faster) can iterate on independently.
- **Run n8n as a service inside the same compose stack, tightly coupled to backend deploys.**
  Rejected: n8n's lifecycle (workflow edits, its own credential store for Telegram, potential
  future integrations beyond Telegram) is intentionally independent of backend release cadence;
  coupling them in the same compose lifecycle would create unnecessary shared blast radius.

## Consequences

- The backend can be developed, tested, and deployed with zero knowledge of what n8n workflows
  currently exist or how they're configured — it only knows the webhook contract (event shape +
  `correlationId`/`tenantId`, see
  [events.md#event-catalog-initial--extended-as-modules-are-built](../architecture/events.md#event-catalog-initial--extended-as-modules-are-built)).
- n8n's own reliability/monitoring is out of this platform's operational scope beyond "is the
  webhook endpoint reachable," which the retry/dead-letter mechanism already tolerates failures of.
- Any new automation (a new event type, a new downstream integration beyond Telegram) is built as
  an n8n workflow change, not a backend code change, as long as it consumes an event already in the
  catalog.
