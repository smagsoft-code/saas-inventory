# Events and the Outbox

Related: [ADR-0010](../decisions/0010-outbox-pattern.md),
[ADR-0011](../decisions/0011-n8n-external-automation.md),
[ADR-0012](../decisions/0012-telegram-through-n8n.md),
[ADR-0029](../decisions/0029-import-worker-separation.md).

> **Status:** implemented in **FASE 14** (the transactional write path `DomainEventPublisher` →
> `event_outbox`, and the **Event Processor** deployable — claim / retry / backoff / stale recovery /
> dead-letter) and **FASE 15** (the **n8n delivery adapter** — the Event Processor now registers a
> production handler that `POST`s each claimed envelope to a generic n8n webhook over authenticated
> HTTPS; n8n owns routing / message composition / the Telegram credential). With
> `N8N_EVENTS_ENABLED=false` the registry is still empty and no event is claimed. See
> [integrations/n8n.md](../integrations/n8n.md) for the full webhook contract.

## Four distinct things — never conflated

| | Audit log | Domain event (outbox) | Application log | External notification |
| --- | --- | --- | --- | --- |
| **What** | "who did what", compliance record | a business fact that already happened | operational debug line | a Telegram/e-mail message |
| **Where** | `audit_log` table | `event_outbox` table | stdout / aggregator | n8n → Telegram |
| **Owner** | CORE | NOTIFICATIONS | ops | n8n (FASE 15) |
| **Write semantics** | best-effort (a failure never blocks the operation) | **transactional** — commits or rolls back with the business mutation | fire-and-forget | asynchronous, at-least-once |
| **Consumer** | a human running a query | the Event Processor, once | a log search | the tenant's staff |

The Event Processor **never** reads `audit_log`, `orders`, `inventory_movements`, or any domain
table to "discover what happened" — the producing module writes a self-describing event and the
processor works only from that.

## Why Outbox

Notifications are never sent as a side effect *inside* the code path that performs a business
operation. If "confirm order" called out to n8n before returning, a slow/down n8n would make order
confirmation slow or fail, and a crash between "the sale committed" and "the notification was sent"
would lose the notification (or notify about a sale that then rolled back).

The **transactional outbox pattern** removes both failure modes: the domain event is written to
`event_outbox` **in the same database transaction** as the business change. Either both commit or
neither does — there is no window where one exists without the other. Delivery is then a completely
separate, asynchronous concern.

```mermaid
flowchart TB
    subgraph tx["Single DB transaction (withTenantTransaction)"]
        Op["Business mutation\n(order pending → confirmed)"]
        Inv["Inventory effect\n(RESERVATION_RELEASE + SALE)"]
        Aud["audit_log row"]
        Evt["event_outbox row\n(DomainEventPublisher.append)"]
    end
    Op --> Inv --> Aud --> Evt
    Evt -->|COMMIT| DB[("PostgreSQL\nevent_outbox")]
    DB -.->|"FOR UPDATE SKIP LOCKED\n(polling)"| EP["Event Processor\n(separate deployable,\napp_event_processor role)"]
    EP -->|"dispatch"| Port["Delivery Port\n(EventHandler registry)"]
    Port -.->|"FASE 15"| N8N["n8n adapter → n8n → Telegram"]
    EP -->|"repeated failure"| DL["status = 'dead_letter'\n(kept, never deleted)"]
```

If the delivery target is down, the sale still happened — it was committed. The event waits in the
outbox until the Event Processor can deliver it. Business operations never block on, or fail because
of, notification delivery.

## Event envelope

The `event_outbox.payload` column holds a **self-describing, versioned, JSON-serialisable
envelope** — the exact object that will be delivered to a consumer once FASE 15 exists. The row's
own columns (`event_type`, `aggregate_type`, `aggregate_id`, `correlation_id`, `tenant_id`,
`created_at`) are denormalised copies of envelope fields, kept for claiming and indexing.

| Field | Notes |
| --- | --- |
| `eventId` | `= event_outbox.id`. Generated once (UUIDv7, application-side), **never regenerated on retry**. A consumer dedupes on this. |
| `eventType` | `module.aggregate.action`, past tense — e.g. `sales.order.confirmed`. |
| `eventVersion` | integer, starts at `1`. A payload shape change **must** bump this (see [versioning](#event-versioning)). |
| `occurredAt` | ISO-8601 UTC — when the business fact happened. ≈ `created_at` (same transaction), semantically distinct. |
| `tenantId` | present for every tenant-scoped fact; `null` only for a platform-global event (none in FASE 14). |
| `aggregateType` / `aggregateId` | `order` / `price_approval` / `sales_return` and its id. |
| `correlationId` | the originating request's `Correlation-Id` (api.md#correlation-id), UUID-validated — `null` if the header was not UUID-shaped. |
| `actor` | `{ type: 'user' \| 'system', id }` — captured at the moment of the fact, never resolved later from `users`. |
| `data` | the typed, event-specific payload (below). |

Typed contracts live in
[`apps/api/src/common/events/domain-event.contracts.ts`](../../apps/api/src/common/events/domain-event.contracts.ts);
the catalog constants + current versions in
[`event-types.ts`](../../apps/api/src/common/events/event-types.ts). `Record<string, any>` is not a
contract.

## Event catalog

FASE 14 publishes only the SALES facts a known future integration needs. Other modules'
events (`INVENTORY_ADJUSTED`, `LOW_STOCK`, `TENANT_CREATED`, `USER_CREATED` — named in earlier
drafts of this doc as conceptual examples) are added to this table by the phase that has a real
consumer for them, not speculatively.

| `eventType` | v | Producer | Aggregate | Business transition | `data` (data-minimised — ADR-0028) |
| --- | --- | --- | --- | --- | --- |
| `sales.order.confirmed` | 1 | `OrdersService.confirm` | `order` | `pending → confirmed` (the physical sale commit) | order id/number, document type, invoice status, currency, subtotal/discountTotal/taxTotal/total, location id, placed-by user, `hasExceptionalDiscount`, customer snapshot (name/taxId/email/phone/address), lines (variant id, sku, name, qty, **unitPrice**, discountAmount, lineTotal) |
| `sales.order.cancelled` | 1 | `OrdersService.cancel` | `order` | `draft/pending → cancelled` | order id/number, document type |
| `sales.price_approval.requested` | 1 | `PriceApprovalsService.request` | `price_approval` | new `pending` request | approval/order/orderItem ids, order number, variant id, sku, name, qty, requestedPrice, **maxPriceAtRequest**, discountAmount, reason, requested-by user |
| `sales.price_approval.approved` | 1 | `PriceApprovalsService.resolve` | `price_approval` | `pending → approved` (CAS win) | approval/order/orderItem ids, status, resolved-by user, requested-by user |
| `sales.price_approval.rejected` | 1 | `PriceApprovalsService.resolve` | `price_approval` | `pending → rejected` (CAS win) | (as above) |
| `sales.return.requested` | 1 | `ReturnsService.create` | `sales_return` | new `→ requested` | return/order ids, order number, location id, reason, requested-by user, lines (orderItem id, variant id, sku, qtyReturned) |
| `sales.return.resolved` | 1 | `ReturnsService.resolve` | `sales_return` | `inspecting → resolved` (RETURN movements written) | return/order ids, location id, lines (orderItem id, variant id, qtyReturned, disposition, dispositionLocationId) |
| `sales.return.cancelled` | 1 | `ReturnsService.cancel` | `sales_return` | `requested/inspecting → cancelled` | return/order ids, status |

**Deliberately not events:** `return.inspected` (an internal re-inspection, no external meaning);
a `pending` order's creation (not a completed-sale fact — the meaningful event is
`sales.order.confirmed`).

### Data minimisation and PII

- `data` carries only what an approved consumer needs. **Never included:** `unit_cost` /
  `min_price` / `base_price` / `max_price` snapshots (ADR-0028 field-level pricing), password
  hashes, session tokens, JWTs, CSRF tokens, secrets, binary blobs, whole catalog/inventory
  snapshots.
- `sales.price_approval.requested` carries `maxPriceAtRequest` and `discountAmount` (both computed
  against the list ceiling) but **not** `minPriceAtRequest` — the notification's job is "there is a
  request to act on"; the approver opens the app, where their own `pricing.floor.view` decides what
  they see. The event is Telegram-agnostic and a Telegram channel is not an authorization boundary.
- `sales.order.confirmed` carries the customer snapshot (name/taxId/email/phone/address) — the
  minimum a "new sale" notification needs. That is PII; it is not logged (see
  [observability](#observability)).

## Event versioning

`eventType` + `eventVersion` together identify a contract. Bumping a payload's shape **must** bump
`eventVersion` and add a matching handler branch downstream — never silently change a v1 payload.
The Event Processor treats an event whose version it does not recognise as **terminal**
(`dead_letter`), not as something to retry or mis-process.

## Event Processor

A separate process/deployable (`apps/api/src/event-processor/main.ts`,
`pnpm --filter @saas-inventory/api worker:events:start`) — **not** the API, and **not** the Import
Worker (ADR-0029). It starts via `NestFactory.createApplicationContext(AppModule)` (no HTTP
listener, no port), connects as the dedicated `app_event_processor` Postgres role, and runs
`EventProcessorService.runOnce()` in a poll loop with graceful SIGTERM/SIGINT shutdown.

### Claiming

One atomic statement — a CTE with `FOR UPDATE SKIP LOCKED` feeding an `UPDATE ... RETURNING`
(`event-claim.repository.ts`):

```sql
WITH claimable AS (
  SELECT id, status FROM event_outbox
  WHERE event_type = ANY(:supportedTypes)        -- only types with a registered handler
    AND attempts < :maxAttempts
    AND (
      (status = 'pending' AND (claimed_at IS NULL
        OR claimed_at < now() - LEAST(:retryMaxMs, :retryBaseMs * power(:retryFactor, attempts))
                                * interval '1 ms'))
      OR (status = 'processing' AND claimed_at < now() - :staleClaimMs * interval '1 ms')
    )
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT :batchSize
)
UPDATE event_outbox e
SET status = 'processing', claimed_at = now(), claimed_by = :workerId,
    attempts = e.attempts + (CASE WHEN c.status = 'processing' THEN 1 ELSE 0 END)
FROM claimable c WHERE e.id = c.id
RETURNING e.id, e.tenant_id, e.event_type, e.attempts, e.created_at, e.payload;
```

- `FOR UPDATE SKIP LOCKED` is what makes multiple Event Processor instances safe: each skips rows
  another instance already locked. Horizontal scaling needs no separate distributed lock.
- **`event_type = ANY(:supportedTypes)`** — `supportedTypes` is the dispatcher's registered-handler
  set. In FASE 14 production that set is **empty**, so nothing is ever claimed and no event can be
  marked delivered before FASE 15.
- `claimed_at` doubles as the *last-attempt timestamp* — backoff is `claimed_at + delay(attempts)`,
  computed in SQL. **No schema column** is needed for retry scheduling (see
  [database.md#outbox](database.md#outbox)).
- The claim transaction is short; dispatch (and, from FASE 15, the webhook call) happens **after**
  it commits — a row lock is never held across a delivery.

### Retry / backoff / terminal

| Outcome | Effect |
| --- | --- |
| handler returned success | `status = 'delivered'`, `processed_at = now()`, `last_error = NULL` |
| handler threw (transient) | `attempts += 1`, `last_error` = sanitized message, `claimed_at = now()`; `status = 'pending'` unless `attempts ≥ maxAttempts` → `'dead_letter'` |
| unknown version / malformed envelope | `status = 'dead_letter'` immediately — retrying cannot help |
| worker crashed mid-dispatch | row stays `processing`; a later poll reclaims it once `claimed_at` is stale, incrementing `attempts`; `reapStale()` dead-letters it once `attempts ≥ maxAttempts` |

Backoff: `delay(attempts) = min(retryMaxMs, retryBaseMs · retryFactor^attempts)` — exponential,
capped, configurable (`EVENT_PROCESSOR_RETRY_*`). A `dead_letter` event is **never deleted**
(retention is an operational question for a later phase); it can be inspected and replayed manually
later.

### Configuration

`getOptionalEnvVar` + defaults, same convention as `IMPORT_WORKER_*` (see `.env.example`):
`APP_EVENT_PROCESSOR_DATABASE_URL`, `EVENT_PROCESSOR_POLL_INTERVAL_MS` (2000),
`EVENT_PROCESSOR_CLAIM_BATCH_SIZE` (50), `EVENT_PROCESSOR_STALE_CLAIM_MS` (300000),
`EVENT_PROCESSOR_MAX_ATTEMPTS` (10), `EVENT_PROCESSOR_RETRY_BASE_MS` (1000),
`EVENT_PROCESSOR_RETRY_MAX_MS` (3600000), `EVENT_PROCESSOR_RETRY_FACTOR` (2),
`EVENT_PROCESSOR_ID` (optional).

## Delivery semantics: at-least-once

The classic window: a handler succeeds, then the process crashes **before** the DB is marked
`delivered`. On restart the row is still `processing`; stale reclaim redelivers it — **with the same
`eventId`**.

- **Business side effects are exactly-once** — guaranteed by the transaction, the `SELECT … FOR
  UPDATE` state locks, and `idempotency_keys`. One `pending → confirmed` transition, one `SALE`, one
  `sales.order.confirmed` event, no matter how many times the client retries `POST
  /orders/:id/confirm` or how many requests race.
- **Outbox delivery is at-least-once** — never exactly-once. FASE 15 consumers **must** dedupe on
  `eventId`. This is documented here now so FASE 15 builds on it.

## Delivery Port

`EventHandler` (`event-delivery.port.ts`) is the abstraction between the Event Processor and
whatever forwards an event outward — `{ eventType, eventVersion, deliver(envelope) }`. `deliver`
throws on failure; the dispatcher maps a thrown `PermanentDeliveryError` to `terminal`
(dead-letter now) and anything else to `retry`.

**FASE 15 — n8n delivery adapter** (`apps/api/src/event-processor/n8n/`). `EventProcessorModule`
now binds `EVENT_HANDLERS` from configuration:

- `N8N_EVENTS_ENABLED=false` (default) → `[]`: no handler, `supportedTypes()` empty, nothing
  claimed, every event stays `pending` — exactly the FASE 14 behaviour.
- `N8N_EVENTS_ENABLED=true` → one `EventHandler` per known event type (the 8 SALES events, each
  pinned to `eventVersion = 1` — **no `sales.*` wildcard**, §19), all sharing one `N8nWebhookClient`.
  `loadN8nDeliveryConfig()` throws in the module factory if the URL/secret is missing or the URL is
  an insecure remote endpoint, so a misconfigured processor **fails at startup** rather than
  running without delivering (fail closed).

`N8nWebhookClient.post(envelope)`: `POST` the unchanged envelope as JSON to
`N8N_EVENTS_WEBHOOK_URL`; `Authorization: Bearer <N8N_EVENTS_AUTH_TOKEN>` (never in the body/URL) +
non-secret `X-Event-*` trace headers; `AbortController` timeout (`N8N_EVENTS_TIMEOUT_MS`);
`redirect: 'manual'` (a 3xx is never followed — the token is never resent to another host); only
`2xx` is success. Failures are classified `retryable` (408/425/429/5xx, network/DNS/TLS/timeout) or
`permanent` (other 4xx, redirect → `PermanentDeliveryError` → dead-letter). Error-response bodies
are sanitised + truncated before they can reach `last_error`/logs. The adapter does **no** domain
lookups — the envelope is self-sufficient (§38), preserving `app_event_processor`'s
`event_outbox`-only least privilege.

Tests register in-memory fakes; those are never production adapters.

### HTTP failure classification

| n8n responds / connection | Outcome | Row effect |
| --- | --- | --- |
| `2xx` | success | `delivered` |
| `408` / `425` / `429` / `5xx` | retryable | backoff + retry → `dead_letter` after `maxAttempts` |
| network / DNS / TLS error, timeout (abort) | retryable | as above |
| `400` / `401` / `403` / `404` / `405` / `410` / `422` / other `4xx` | permanent | `dead_letter` now |
| `3xx` redirect | permanent | `dead_letter` now (never followed) |

## Tenant suspension

The Event Processor processes **facts that already committed**. Unlike the Import Worker (which
runs *new* business mutations and therefore excludes suspended tenants from its claim query,
PROMPT 011-B), the Event Processor's claim query **does not** join `tenants` or filter on
`tenants.status`.

**FASE 15 decision:** an already-committed event **is delivered to n8n regardless of the tenant's
current suspension status**. Suspension gates *new* tenant business operations; it does not
invalidate or suppress domain events that were transactionally committed before the suspension.
The n8n adapter therefore adds **no** `tenants` query, **no** `JOIN tenants`, and **no** new grant
— `app_event_processor` keeps its `event_outbox`-only least privilege. A future explicit
security-quarantine policy could override external delivery, but that is out of scope here.

## Ordering

There is **no global ordering guarantee**. `ORDER BY created_at` in the claim query is
best-effort fairness (roughly oldest-first, UUIDv7-friendly), not a contract. With `SKIP LOCKED`,
multiple workers, and per-event retry/backoff, events for one aggregate can be delivered out of
order. Consumers must be idempotent and state-aware (which the `eventId` + the event's own
`status`/transition data allow).

## Security model

| Concern | Mechanism |
| --- | --- |
| **Producer authorization** | the business route's own guard chain (JwtAuthGuard → TenantGuard → CsrfGuard → PermissionsGuard). An event is only ever written as a side effect of an authorized mutation; there is no public outbox API. |
| **Outbox tenant isolation** | RLS. `app_tenant` (the producer's connection) has `SELECT, INSERT` on `event_outbox` filtered to its own `tenant_id`; a `prevent_tenant_id_change` trigger blocks re-homing a row. |
| **Processor authorization** | the dedicated `app_event_processor` role: `SELECT, UPDATE` on `event_outbox` only (one permissive cross-tenant policy), **no grant on any other table** — a compromised Event Processor cannot read `orders`/`customers`/`inventory`. It is not `BYPASSRLS` and cannot `SET ROLE`. |
| **Error sanitisation** | `last_error`, n8n error-response bodies, and every log line pass through `sanitizeError` — bearer tokens, API keys, passwords, URL credentials and JWTs redacted, truncated to ~500 chars. |
| **External recipient authorization** | n8n. The adapter POSTs the envelope to one operator-configured webhook authenticated by `Authorization: Bearer` (`N8N_EVENTS_AUTH_TOKEN`, runtime-only); which Telegram chat/channel a tenant's alerts reach — and the Telegram bot token — live entirely inside n8n (ADR-0012). The backend does no recipient routing. |

## Import Worker vs Event Processor

Same technical pattern (`FOR UPDATE SKIP LOCKED`, stale-claim recovery, polling), **never the same
deployable** (ADR-0029): different entry point, different Postgres role, different claim
repository, different table (`import_jobs` vs `event_outbox`). Neither reads the other's table; no
shared in-process state. A large import can never delay notification delivery and vice versa.

## n8n and Telegram (FASE 15 — implemented)

n8n is external infrastructure the backend's domain logic knows nothing about — the Event Processor
calls **one generic webhook URL** with the generic envelope above; no n8n-specific or
Telegram-specific code, no bot token in the database or anywhere else. **Topology decision:** a
single shared webhook (`N8N_EVENTS_WEBHOOK_URL`), with per-`eventType` / per-tenant routing done
*inside* n8n keyed by the `tenantId` / `eventType` already in every envelope — **not** per-tenant
URLs, and **not** a backend `notification_preferences` model. FASE 15 deliberately does **not**
build tenant notification-preference schema or endpoints (the `PENDING DECISION` FASE 11 deferred
here): routing lives entirely in n8n. The full webhook contract, the n8n workflow responsibilities
(auth, envelope validation, `eventVersion` check, durable `eventId` dedupe, `Switch(eventType)`,
Telegram composition, response-after-completion), secret handling, and the at-least-once /
not-exactly-once semantics are in [integrations/n8n.md](../integrations/n8n.md).

### Still out of scope (later phases)

Incoming Telegram commands / approval via Telegram / any `n8n → SaaS` mutation path (would need its
own security ADR), a SaaS DB connection from n8n, tenant-configurable notification preferences,
message templates in the backend, a manual retry/replay admin tool, event-outbox retention/purge,
delivery dashboards/reporting, electronic invoicing. Selling serialized / lot-tracked variants
remains deferred (no approved `order_items` ↔ `product_serials`/`product_lots` model).
