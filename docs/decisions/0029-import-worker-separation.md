# ADR-0029: Import Worker as a Separate Process from the Event Processor

## Status

Accepted

## Context

The 02-C audit (finding M4) flagged that the Excel import pipeline's background-job execution model
([database.md#excel-import-pipeline](../architecture/database.md#excel-import-pipeline)) was described
only as reusing "the same architectural pattern already established for the Event Processor"
([events.md#event-processor](../architecture/events.md#event-processor)) without stating whether that
meant the *same physical process/deployable* or a *separate one polling a different table*. This needed
resolving before Prompt 03 could scaffold either worker without guessing.

## Decision

**Option B: a separate Import Worker process, not the same deployable as the Event Processor** — but
using the **identical mechanism**, not a new one: `FOR UPDATE SKIP LOCKED` claiming against Postgres,
no message broker, no new queue technology. The Import Worker claims rows from `import_jobs`/
`import_job_rows`; the Event Processor claims rows from `event_outbox`; neither reads the other's
table, and there is no shared in-process state between them. Full design:
[database.md#large-imports](../architecture/database.md#large-imports).

**Why separate, concretely — not "separate by default":** the two workloads have genuinely different
resource and latency profiles. The Event Processor is low-latency and I/O-bound (a webhook call per
event, expected to stay responsive so Telegram notifications arrive promptly). The Import Worker is
potentially long-running (minutes, for a 100,000-row file) and CPU/DB-bound (parsing, per-row
validation, batched writes). Sharing one process means a large import could delay notification
delivery, or a webhook outage's retry backoff could delay import processing — two workloads with no
reason to be coupled, coupled anyway. This is exactly the criterion
[scalability.md#when-to-split-a-module-out](../architecture/scalability.md#when-to-split-a-module-out)
already establishes for extracting something into its own deployable: "a different deployment cadence
or failure-isolation boundary" — the Import Worker crashing or being redeployed must never affect
notification delivery, and vice versa.

**Reclaiming/retries:** an Import Worker instance polls `import_jobs` where `status IN ('validating',
'importing')`, claims via `FOR UPDATE SKIP LOCKED` (safe with multiple instances). A crashed worker
simply stops claiming; **idempotency on retry** is the existing `import_job_rows.status` resumability
([database.md#committing-transactional-strategy-duplicates-rollback](../architecture/database.md#committing-transactional-strategy-duplicates-rollback))
— no new mechanism. **Observability** reuses the existing structured-logging convention
(`correlationId`/`tenantId`) unchanged.

## Alternatives considered

- **Option A: import processing runs inside the Event Processor's own polling loop** (as an additional
  job type it claims alongside `event_outbox` rows). Rejected for the resource-profile mismatch above —
  it would make the Event Processor's responsiveness (which the platform's Telegram-notification
  promise depends on) contingent on how busy the import workload happens to be at any given moment, an
  avoidable coupling.
- **A message broker (RabbitMQ, SQS, etc.) for import job dispatch.** Rejected per this prompt's
  explicit instruction not to introduce new queue technology, and independently for the same reasoning
  [ADR-0010](0010-outbox-pattern.md) already gives for not adopting one for the outbox: a Postgres-
  backed `FOR UPDATE SKIP LOCKED` claim achieves the needed at-least-once, safely-concurrent processing
  without a new system to operate and back up, at this platform's current scale.
- **No background worker at all — always process imports inline in the HTTP request.** Rejected: a
  100,000-row file cannot complete within a reasonable request/response cycle; this was already
  established in Prompt 02-B and is unchanged by this ADR, which only resolves *which* worker runs the
  background phase.

## Consequences

- Prompt 03+ infrastructure work provisions a second worker process/container (alongside the existing
  API, web, Postgres, Redis, n8n services) — a `docker-compose.yml` (or equivalent) change, explicitly
  out of scope for this design-only ADR.
- The Event Processor's code and deployment stay exactly as already designed in
  [events.md](../architecture/events.md) — this ADR adds a sibling process, it does not modify the
  Event Processor itself.
- If import volume ever justifies it, the Import Worker can be scaled independently (more instances)
  without any interaction with Event Processor scaling — the two are already decoupled by this
  decision, not something that needs revisiting later to achieve that.
