# ADR-0010: Transactional Outbox Pattern for Domain Events

## Status

Accepted

## Context

Business operations (e.g. creating an order, adjusting inventory) need to trigger downstream
notifications, but must never fail, block, or become inconsistent because of a downstream system
(n8n) being slow or unavailable. See [events.md](../architecture/events.md).

## Decision

Domain events are written to an `event_outbox` table in the **same database transaction** as the
business operation that produced them. A separate Event Processor asynchronously delivers
undelivered events to n8n via webhook, with retry and eventual dead-lettering. Full detail and
diagram in [events.md#why-outbox](../architecture/events.md#why-outbox).

## Alternatives considered

- **Call n8n directly from the request handler.** Rejected: couples business-operation success to
  notification-system availability/latency, and risks the "saved but not notified" or "notified
  but not saved" inconsistency the outbox pattern specifically avoids — see
  [events.md#why-outbox](../architecture/events.md#why-outbox) for the failure-mode walkthrough.
- **A message broker (e.g. RabbitMQ/Kafka) instead of a database outbox table.** Provides similar
  guarantees but adds an entirely new piece of infrastructure to operate for a platform at this
  stage — Redis (already part of the stack) plus a Postgres-backed outbox table achieves the same
  at-least-once, transactionally-safe delivery without a new system to run and back up. Revisit if
  event volume/throughput ever genuinely outgrows this (see
  [scalability.md](../architecture/scalability.md)).
- **Fire-and-forget with no durable record.** Rejected: an n8n outage would silently drop
  notifications with no way to know it happened or replay them.

## Consequences

- Every module that emits an event writes to the outbox as part of its existing transaction, not as
  a separate step that could be skipped or fail independently.
- The Event Processor is a logically (and possibly eventually physically) separate component,
  making it a natural first candidate for extraction if the platform ever needs to scale it
  independently — see [scalability.md#when-to-split-a-module-out](../architecture/scalability.md#when-to-split-a-module-out).
- Delivery is at-least-once, not exactly-once — consumers (n8n workflows) are expected to be
  idempotent with respect to `event_id`, per
  [events.md#idempotency-and-retries](../architecture/events.md#idempotency-and-retries).
