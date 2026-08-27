# n8n Event Delivery & Telegram Notifications (FASE 15)

Related: [ADR-0010](../decisions/0010-outbox-pattern.md),
[ADR-0011](../decisions/0011-n8n-external-automation.md),
[ADR-0012](../decisions/0012-telegram-through-n8n.md),
[ADR-0028](../decisions/0028-field-level-price-authorization.md),
[events.md](../architecture/events.md), [security.md](../architecture/security.md#events-and-the-outbox-fase-14--fase-15-delivery).

> **Status:** implemented in **FASE 15** and **validated end-to-end against a real n8n + Telegram
> test destination in PROMPT 015-A** (see [Real validation](#real-validation--prompt-015-a) below).
> The Event Processor forwards each claimed `event_outbox` envelope to a single generic n8n webhook
> over authenticated HTTPS. n8n owns all routing, message composition, and the Telegram credential.
> The backend stores **no** Telegram bot token and makes **no** direct Telegram call (ADR-0012).

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

## REAL VALIDATION — PROMPT 015-A

End-to-end validated against the operator's real n8n instance with a dedicated test workflow and a
test-only Telegram destination. No production SaaS database, no real customer data (throwaway
embedded PostgreSQL, synthetic events, wiped after the run).

| | |
| --- | --- |
| validation date | 2026-08-27 |
| n8n version | 2.36.7 |
| production n8n instance used | yes (a **dedicated** workflow created for this validation; no existing workflow touched, no credential rotated, n8n not upgraded) |
| workflow | `SaaS Inventory — Event Notifications` — Webhook → Validate envelope → `eventVersion == 1` check → Data Table dedupe lookup → Switch(route) → Data Table Upsert (`processing`) → Switch(`eventType`) → build message (n8n) → Telegram (test chat) → Data Table Update (`completed`) → Respond 200 |
| webhook transport | HTTPS |
| authentication | n8n **Header Auth** on `Authorization: Bearer <secret>` (the secret = `N8N_EVENTS_AUTH_TOKEN`; same value both sides, runtime-env only) |
| supported contract | the 8 SALES events, `eventVersion = 1`; an unknown `eventType` → `422`, an unknown version → not routed |
| Telegram credential | stored **only** in n8n's credential store; the backend holds no bot token |
| messages | prefixed `[TEST SaaS Inventory]`; composed in n8n from the v1 payload only |

### Durable dedupe — as actually implemented

| property | value |
| --- | --- |
| mechanism | n8n **Data Table** `saas_event_dedupe`; **custom** columns `eventId`, `status` (`processing`\|`completed`), `eventType`, `processingUpdatedAt` (ISO-8601). n8n Data Tables also keep their own internal `id` / `createdAt` / `updatedAt` fields; the workflow does **not** use those for dedupe or stale detection — the custom `processingUpdatedAt` column is authoritative and is written by the workflow on every claim and on completion. |
| key | `eventId` (= `event_outbox.id`) |
| durable | **yes** — persisted in the Data Table store; survives executions and n8n restarts |
| atomic / unique-insert guarantee | **no.** The lookup (Get Row) and the claim write (Upsert on `eventId`) are separate node operations; the Upsert narrows the window to one call but n8n does not document it as an atomic insert-if-absent and no unique constraint on `eventId` was established. Two executions receiving the *same* `eventId` in the same sub-millisecond window before either upserts could both proceed. |
| why that race is not reached in practice | the Event Processor dispatches one `event_outbox` row at a time and only retries seconds later after recording an outcome; `FOR UPDATE SKIP LOCKED` prevents two workers claiming the same row at once. The realistic concurrent case — a retry arriving while a slow first execution still runs — is handled by the **in-flight (HTTP 425)** path, not by the upsert. |
| `Claim Processing` (new or stale event) | Upsert by `eventId` → `status = processing`, `processingUpdatedAt = now`, **before** any Telegram send |
| `Dedupe Decide` age check | `age = now − processingUpdatedAt` of the existing row |
| `Mark Completed` | **only after** the Telegram send succeeds → `status = completed`, `processingUpdatedAt = now` → Respond 200 |
| duplicate + `completed` | workflow responds **HTTP 200** `{"status":"duplicate-ignored"}`, **no** Telegram |
| recent `processing` (`age < STALE_MS = 120000`) | workflow responds **HTTP 425**; the Event Processor classifies 425 as retryable and retries after backoff; **no** Telegram |
| stale `processing` (`age ≥ 120 s`) | reclaimed (Upsert refreshes `processingUpdatedAt`) and reprocessed — recovery from a crashed execution |
| remaining crash window | Telegram send succeeds → n8n dies before the `Mark Completed` update → row stays `processing` → after 120 s a retry reprocesses → **Telegram re-sent**. Hence: **at-least-once-safe, not exactly-once.** |

> `STALE_MS = 120000` (120 s): comfortably above one execution's real duration (Telegram call + 2
> Data Table writes, normally < 10 s) and below the Event Processor's later retry intervals, so a
> genuinely-dead execution is recovered without undue delay. Tune if n8n executions can legitimately
> run longer.

### Smoke results

| scenario | path | result |
| --- | --- | --- |
| **S1** `sales.order.confirmed` v1 (synthetic) | seeded `event_outbox` → **real `dist/event-processor/main.js`** → HTTPS n8n → Telegram test chat | `event_outbox.status = delivered`, `processed_at` set, `attempts = 0`, `eventId` unchanged; **one** `[TEST] Venta confirmada` received (order number, document type, total/currency, customer name/id/email/phone/address, product line) |
| **S2** `sales.price_approval.requested` v1 (synthetic) | same | `delivered`; **one** `[TEST] Solicitud de descuento excepcional` received (order, product, SKU, qty, `requestedPrice`, `maxPriceAtRequest`, `discountAmount`, `reason`); **no** `minPrice` / `minPriceAtRequest` / `cost` / `unitCost` / `basePrice` present |
| **S3** duplicate `eventId` | re-POST S1's exact envelope (same `eventId`) to the webhook | HTTP **200** `{"status":"duplicate-ignored"}`; Data Table shows a single row for that `eventId`; **no** second Telegram |
| in-flight duplicate | (verified manually by the operator) | HTTP **425**, no Telegram |

Event Processor logs during the run: `n8n delivery: ENABLED`, `8 event type(s) registered (secret
redacted)`, `… delivered` — **no** secret, token, or webhook URL in any log line.

### n8n execution history

n8n's execution history may retain the delivered event payload — which, for
`sales.order.confirmed`, contains customer PII by business requirement. Retention policy is an
operator concern; PROMPT 015-A did not change it.

## Not in FASE 15

Incoming Telegram commands (`/approve`, inline buttons), approval via Telegram, any `n8n → SaaS`
mutation path, a SaaS DB connection from n8n, tenant-configurable notification preferences /
recipient tables, a manual dead-letter replay UI, outbox retention/purge, delivery dashboards,
electronic invoicing. Selling serialized / lot-tracked variants remains deferred.

**Future frontend requirement (FASE 17, not built here):** the sales history / order detail view
should surface a friendly notification status (`sent` / `pending` / `not sent`) derived from the
event's `event_outbox` state, and let an authorized administrator **retry a failed notification**
without recreating the sale, its inventory movements, or the domain event — i.e. a re-enqueue /
re-deliver action over the existing `event_outbox` row, never a new business transaction.
