# Mobile Architecture

**Status: design only (Prompt 02-B).** No Flutter code, no dependencies installed, no project
scaffolded. This document fixes the *shape* mobile development follows once it starts — not before.
Related: [ADR-0025](../decisions/0025-flutter-for-mobile.md), [frontend.md](frontend.md) (the Next.js
web equivalent of this document), [api.md](api.md), [security.md](security.md),
[multi-tenancy.md](multi-tenancy.md), [database.md](database.md).

## Decision: Flutter, one codebase for Android and iOS

**Flutter + Dart**, per [ADR-0025](../decisions/0025-flutter-for-mobile.md). One codebase produces both
the Android and iOS apps — no separate native Android (Kotlin/Java) and native iOS (Swift) codebases
maintained in parallel, except for genuinely platform-specific integrations where no cross-platform
path exists (e.g. a specific hardware barcode-scanner SDK only offered as native modules) — these are
isolated behind Flutter's platform-channel mechanism, not a reason to fork the whole app.

## Mobile responsibilities

Prioritized for a field/warehouse/sales user, not an administrator:

- Login and tenant context establishment (never a manual tenant picker that trusts client input — see
  [Multi-tenant mobile](#multi-tenant-mobile) below).
- Inventory lookup and search (by name, SKU, category, or scan).
- QR/barcode scanning.
- Cart building and checkout (negotiated price, document type, customer capture — the same flow
  [database.md#cart](database.md#cart)/[database.md#orders-conceptual--sales-not-built-yet](database.md#orders-conceptual--sales-not-built-yet)
  already designs).
- Inventory transfers: requesting, dispatching, receiving (including partial receipt and incident
  recording) — [database.md#inventory-transfers-and-in-transit-stock](database.md#inventory-transfers-and-in-transit-stock).
- Sales returns: intake and (for authorized roles) disposition —
  [database.md#sales-returns-and-disposition](database.md#sales-returns-and-disposition).
- Push notifications for a vendor's own tasks (a transfer awaiting their receipt, a price-approval
  request awaiting their decision).

None of this is implemented in this prompt — this is the target responsibility list Prompt 03+ mobile
work is scoped against.

## Web vs. Mobile — no duplicated business rules

| | Web (Next.js) | Mobile (Flutter) |
| --- | --- | --- |
| Audience | Administrators, supervisors, back-office | Vendors, warehouse staff, field operation |
| Typical tasks | Tenant/user/role configuration, attribute & category setup, Excel import, reports, oversight | Scanning, selling, transferring, receiving, day-to-day operational tasks |
| Business logic | None — reflects what the API allows, same as today ([CLAUDE.md §7.6](../../CLAUDE.md#76-frontend)) | None — identical rule, extended explicitly to mobile by this document |

Both are thin clients over the same `/api/v1` contract ([api.md](api.md)) — there is exactly one
implementation of pricing rules, permission checks, inventory concurrency, and tenant isolation, and it
lives in the NestJS backend. Neither client recomputes or duplicates it; a rule enforced differently (or
inconsistently) between web and mobile would be a design defect, not an acceptable platform difference.
This is not a new principle — it is [CLAUDE.md §7.6](../../CLAUDE.md#76-frontend)'s existing "the API is
the only source of truth for business operations" rule, stated here explicitly for the client this
project didn't have when that section was written.

## Backend as the sole authority

Flutter contains **no** critical business logic for: permissions, prices (max/base/min, negotiated,
discount approval), inventory balances, transfer state, or tenant isolation. It calls `/api/v1`
endpoints and renders what they return; a permission the UI doesn't show is a UX convenience (don't
present a button the user can't use), never the actual enforcement — the API re-checks every request
server-side regardless of what the app displayed, identical to the web's existing rule
([CLAUDE.md §7.6](../../CLAUDE.md#76-frontend)).

## Auth on mobile

Token *issuance* rules ([security.md#authentication](security.md#authentication) — short-lived access
token, longer-lived refresh token, server-side revocation, rotation on refresh) are already
transport-independent and apply unchanged to mobile. What's mobile-specific is the *transport/storage*
answer, which this document states explicitly rather than leaving implicit:

**Mobile uses a bearer access token + refresh token, held in OS-level secure storage** (Android
Keystore-backed, iOS Keychain-backed — e.g. via Flutter's `flutter_secure_storage` or an equivalent
platform-channel wrapper), attached as an `Authorization` header on every request. This is **not** a
new decision reopening [frontend.md#authentication-and-route-protection](frontend.md#authentication-and-route-protection)'s
`PENDING DECISION` between an httpOnly cookie and a bearer token for the **browser** — that choice is
about the web session-transport mechanism specifically, made independently when FASE 4 builds auth.
Mobile's answer is simply not "a cookie" regardless of which way the web decision lands, since httpOnly
cookies are a browser mechanism a native app's HTTP client doesn't meaningfully participate in the same
way. Logout/revocation reuses the existing server-side refresh-token-revocation mechanism
([security.md#authentication](security.md#authentication)) — no separate mobile-only revocation path.

## Multi-tenant mobile

Unchanged from the platform-wide rule: the tenant is derived from the verified token's claims by the
Tenant Guard, server-side, on every request — never trusted from anything the mobile client sends
([multi-tenancy.md#tenant-context-where-it-comes-from](multi-tenancy.md#tenant-context-where-it-comes-from)).
Mobile never presents a "pick your tenant" control that the backend then trusts; if a future use case
needs a user to operate across more than one tenant (not designed now), that is resolved the same way
it would be for web — a fresh authenticated session scoped to one tenant at a time via the token, not a
client-supplied selector.

## QR on mobile — a clarified resolution path, not a new rule

The scanning flow is: Flutter camera → decode the QR's opaque code → resolve it → show the product.
**Which endpoint resolves it depends on whether the app is authenticated:**

- **Authenticated (the normal vendor-app case):** the scanned code is looked up via the same
  authenticated, permission-gated CATALOG endpoint any other product lookup uses — returning whatever
  pricing/stock detail the user's role is entitled to see, governed by the field-level mechanism closed
  in Prompt 02-D ([ADR-0028](../decisions/0028-field-level-price-authorization.md)): `min_price` needs
  `pricing.floor.view` (a vendor negotiating a sale legitimately holds it, to know their own floor) and
  `cost` needs the separate, more restricted `pricing.cost.view`. This is **not** a request to the
  public QR resolver, and it's the same permission-gated response Web would get for the same user —
  no mobile-specific pricing logic.
- **Unauthenticated (an anonymous scan — a customer's own phone, if that use case is ever built):** the
  public resolver (`GET /q/:code`, [api.md#public-endpoints](api.md#public-endpoints)) applies exactly
  as designed in Prompt 02-A — `max_price` only, via the column-level `GRANT` restricting
  `app_public_resolver`
  ([database.md#qr-codes](database.md#qr-codes)) — `min_price`/`base_price`/`cost` are never returned.

This is a clarification, not a new architectural decision: it resolves an apparent tension between "QR
shows `max_price`" (correct, for the *public/unauthenticated* case Prompt 02-A designed) and an
authenticated vendor's operational need to see their actual negotiation floor during a sale, which
would be a real usability gap if the mobile app's own authenticated flow were mistakenly routed through
the public-only resolver. The `qr_codes.target_id` lookup key is identical either way — only which
endpoint (and which role's permissions) resolves it differs.

## Offline

**Not implemented for MVP**, per this prompt's explicit instruction — no full offline-first
architecture is designed or built now. What *is* fixed now is which operations require connectivity and
which could eventually tolerate a cache, so this isn't re-litigated ad hoc per screen later:

**Requires an active connection, always:** checkout, cart-item stock verification, reservation,
transfer dispatch/receipt, sales-return disposition — every write that depends on the row-level-locked
concurrency convoy ([database.md#concurrency-strategy](database.md#concurrency-strategy)). None of
these can be meaningfully queued client-side and replayed later without either re-deriving the exact
same server-side locking guarantees on the client (not attempted) or risking exactly the double-sell/
lost-update problem that convoy exists to prevent.

**Could eventually tolerate a local cache, if/when built:** catalog browsing (products, categories,
images), reference data (attribute definitions/options, measurement units), and "last known" stock
levels shown with an explicit staleness indicator — read paths where a slightly stale view is a UX
inconvenience, not a correctness/financial risk.

**Retry, not offline queueing.** A dropped connection mid-checkout is handled by the *existing*
`Idempotency-Key` mechanism ([api.md#idempotency](api.md#idempotency),
[database.md#idempotency](database.md#idempotency)) — the mobile client retries the same request with
the same key once connectivity returns, and the server either completes the original attempt's result
or returns its already-recorded outcome. This is not a new, mobile-specific offline-queue system; it is
the mobile client correctly using the idempotency mechanism every other client already has available.

## What this phase does not decide

No Flutter project exists, no state-management library is chosen, no navigation/routing framework is
picked, no local-caching library (if/when the cache described above is built) is selected — these are
implementation choices made when mobile development actually starts, not fixed by this design pass.
