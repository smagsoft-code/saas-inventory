# n8n Event Delivery & Telegram Notifications (FASE 15)

Related: [ADR-0010](../decisions/0010-outbox-pattern.md),
[ADR-0011](../decisions/0011-n8n-external-automation.md),
[ADR-0012](../decisions/0012-telegram-through-n8n.md),
[ADR-0028](../decisions/0028-field-level-price-authorization.md),
[events.md](../architecture/events.md), [security.md](../architecture/security.md#events-and-the-outbox-fase-14--fase-15-delivery).

> **Status:** implemented in **FASE 15**. The Event Processor forwards each claimed `event_outbox`
> envelope to a single generic n8n webhook over authenticated HTTPS. n8n owns all routing, message
> composition, and the Telegram credential. The backend stores **no** Telegram bot token and makes
> **no** direct Telegram call (ADR-0012).

```text
Committed business event
      → event_outbox (transactional, FASE 14)
      → Event Processor  (app_event_processor role, FOR UPDATE SKIP LOCKED)
      → N8nWebhookClient  (POST envelope, Authorization: Bearer)
      → n8n webhook  (auth check → eventId dedupe → Switch(eventType) → workflow)
      → Telegram  (n8n credential store; chat/channel routing inside n8n)
```

The SaaS backend has **no** n8n-specific or Telegram-specific business logic — the domain modules
(`SALES`, `INVENTORY`, `CORE`) never import or call n8n / Telegram. The single outbound call lives
in `apps/api/src/event-processor/n8n/` and executes only inside the Event Processor deployable
(`pnpm --filter @saas-inventory/api worker:events:start`).

## Webhook contract (SaaS → n8n)

| Aspect | Value |
| --- | --- |
| Method | `POST` |
| URL | `N8N_EVENTS_WEBHOOK_URL` — one generic events webhook (not one per event type) |
| `Content-Type` | `application/json` |
| Body | the **exact** domain-event envelope v1, unchanged — the canonical source of truth |
| Auth | `Authorization: Bearer <N8N_EVENTS_AUTH_TOKEN>` — configure the same secret as the webhook's Header Auth credential in n8n |
| Trace headers (non-secret) | `X-Event-Id`, `X-Event-Type`, `X-Event-Version`, `X-Tenant-Id` (omitted when null), `X-Correlation-Id` (omitted when null) |
| Timeout | `N8N_EVENTS_TIMEOUT_MS` (default 10000) — a timeout is a **retryable** failure |
| Redirects | `redirect: 'manual'` — a 3xx is **never** followed; the bearer token is never resent to another host. Treated as a permanent misconfiguration. |
| TLS | HTTPS required in production; `http://localhost` / `http://127.0.0.1` allowed only in dev/test |

### Envelope (v1)

```jsonc
{
  "eventId": "0199...-uuidv7",          // = event_outbox.id — stable, never regenerated on retry
  "eventType": "sales.order.confirmed", // module.aggregate.action, past tense
  "eventVersion": 1,
  "occurredAt": "2026-08-26T10:00:00.000Z",
  "tenantId": "0199...",                // null only for a platform-global event (none yet)
  "aggregateType": "order",             // order | price_approval | sales_return
  "aggregateId": "0199...",
  "correlationId": "0199..." ,          // or null
  "actor": { "type": "user", "id": "0199..." },
  "data": { /* per-event, data-minimised — see events.md#event-catalog */ }
}
```

### Response classification (n8n → SaaS)

| n8n responds | Event Processor treats it as | Effect |
| --- | --- | --- |
| `2xx` | success | `event_outbox.status = 'delivered'` |
| `408`, `425`, `429`, `5xx` | retryable | exponential backoff, retried until `EVENT_PROCESSOR_MAX_ATTEMPTS` → then `dead_letter` |
| network / DNS / TLS error, timeout | retryable | as above |
| `400`, `401`, `403`, `404`, `405`, `410`, `422`, other `4xx` | permanent | `dead_letter` immediately — retrying cannot fix a contract/auth/config error |
| `3xx` redirect | permanent | not followed; `dead_letter` |

The Event Processor's FASE 14 retry / stale-claim / dead-letter machinery is unchanged — the n8n
adapter only adds the "permanent vs retryable" distinction via a typed `PermanentDeliveryError`.

## What the n8n workflow must do

The workflow (suggested name: **"SaaS Inventory — Event Notifications"**) should:

1. **Authenticate** the webhook (Header Auth on `Authorization: Bearer`). Invalid/missing → respond
   `401`/`403` **without** running the workflow.
2. **Validate the envelope** — require `eventId`, `eventType`, `eventVersion`, `tenantId`,
   `aggregateType`, `aggregateId`, `occurredAt`, `data`. Invalid → `4xx`, do not send Telegram.
3. **Check `eventVersion == 1`** for the current contracts. An unknown future version → controlled
   response/log, not a silent generic message.
4. **Deduplicate on `eventId`** using a **durable** store (n8n's static data / a DB node / a
   dedupe node) — **not** in-process memory, since delivery is at-least-once and n8n may run
   multiple workers. A duplicate `eventId` → respond `2xx` (the Event Processor already considers
   it accepted) **without** repeating the Telegram send.
5. **Route on `eventType`** (`Switch` node). Every event the backend declares as supported must
   have a defined route; an unknown type → controlled response/log.
6. **Compose and send** the Telegram message (see below), then **respond `2xx` only after** the
   critical step completed — so a Telegram failure makes n8n return non-2xx and the Event
   Processor retries.

### Event routing

| `eventType` | Telegram notification | Recipient (resolved in n8n) |
| --- | --- | --- |
| `sales.order.confirmed` | **yes** — new sale | supervisor / administrator channel |
| `sales.price_approval.requested` | **yes** — approval needed | supervisor / administrator channel |
| `sales.price_approval.approved` / `.rejected` | optional — result notice | requester's channel / admin channel |
| `sales.order.cancelled` | optional (workflow rule) | admin channel |
| `sales.return.requested` / `.resolved` / `.cancelled` | optional (not required by the business yet) | warehouse / admin channel |

The backend never decides a `chatId`, Telegram username, or group — that mapping lives entirely in
n8n (or a future explicitly-approved tenant-notification-settings model). FASE 15 deliberately does
**not** add `notification_preferences` / recipient tables (see events.md).

### `sales.order.confirmed` — minimum message content

Buildable entirely from `data` (no SALES API call): order number, document type (Factura / Nota de
venta), final total + currency, customer name / identification / email / phone / address, and a
product summary (first N lines + total line count for large orders — Telegram message-size limit).
The payload contains PII by business requirement → route only to authorized recipients, never a
generic debug channel. Escape user-supplied text (customer name, address, product name) for the
Telegram parse mode in use (MarkdownV2 / HTML).

### `sales.price_approval.requested` — minimum message content

Order number, product name, SKU, quantity, `requestedPrice`, `maxPriceAtRequest`, `discountAmount`,
`reason`, `requestedByUserId`. **`minPriceAtRequest` is not in the payload and must not be
inferred** (percent-below-min, difference-vs-min, floor value) — ADR-0028. No `cost` / `unitCost`.

## Idempotency & delivery semantics

- **`eventId` is the dedupe key** — never `orderId` (different events for one order are distinct
  facts).
- **At-least-once**: a handler success followed by an Event Processor crash before the DB ack
  redelivers the **same `eventId`**. Expected.
- Durable dedupe in n8n prevents duplicate Telegram messages for normal HTTP retries / backend
  timeout-then-retry / a webhook received twice.
- **Exactly-once Telegram is NOT guaranteed**: Telegram send succeeds → n8n crashes before writing
  its durable dedupe record / responding → redelivery re-sends. External notification delivery is
  documented as **at-least-once-safe**, not exactly-once.

## Secrets

| Secret | Lives in | Never in |
| --- | --- | --- |
| `N8N_EVENTS_AUTH_TOKEN` (Event Processor copy) | runtime env / secret store | Git, logs, payloads, tests, `.env.example`, query strings |
| Webhook Header Auth secret (n8n copy) | n8n credential store | — |
| Telegram bot token | **n8n credential store only** | the SaaS backend entirely (no env var, no DB row) |
| n8n management API key (if ever used) | operator's hands, ad hoc | the Event Processor's env — it is not a delivery credential |

### Rotating the webhook secret

1. Generate a new secret.
2. Update the n8n webhook's Header Auth credential.
3. Update `N8N_EVENTS_AUTH_TOKEN` in the Event Processor's environment/secret store.
4. Restart / redeploy the Event Processor.

No secret-manager integration is built in this phase (FASE 21).

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `N8N_EVENTS_ENABLED` | `false` | `false` → no handler registered, events stay `pending`, nothing claimed. `true` → URL + token mandatory (fail closed at startup). |
| `N8N_EVENTS_WEBHOOK_URL` | — | HTTPS (except localhost dev). No embedded credentials. |
| `N8N_EVENTS_AUTH_TOKEN` | — | ≥ 16 chars, not a trivial placeholder. |
| `N8N_EVENTS_TIMEOUT_MS` | `10000` | 1–120000. |

## n8n instance

The n8n instance is **separate infrastructure** — not a service in `docker-compose.*.yml`
(ADR-0011). FASE 15 does **not** upgrade or reconfigure n8n's version, reverse proxy, TLS, or any
unrelated workflow. Its execution-history retention (which may contain delivered PII payloads) is
an operator concern and was not changed by this phase.

## Not in FASE 15

Incoming Telegram commands (`/approve`, inline buttons), approval via Telegram, any `n8n → SaaS`
mutation path, a SaaS DB connection from n8n, tenant-configurable notification preferences /
recipient tables, a manual dead-letter replay UI, outbox retention/purge, delivery dashboards,
electronic invoicing. Selling serialized / lot-tracked variants remains deferred.
