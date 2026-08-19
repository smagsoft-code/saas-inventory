# ADR-0028: Field-Level Authorization for `cost` and `min_price`

## Status

Accepted

## Context

The 02-C audit (finding H3) identified a real gap: the QR public resolver's protection of `cost`/
`min_price`/`base_price` ([database.md#qr-codes](../architecture/database.md#qr-codes), a Postgres
column-level `GRANT`) only covers the **unauthenticated** scanning path. Nothing in the architecture
defined how an **authenticated** endpoint (used by both Web and the Flutter mobile app,
[mobile.md#qr-on-mobile--a-clarified-resolution-path-not-a-new-rule](../architecture/mobile.md#qr-on-mobile--a-clarified-resolution-path-not-a-new-rule)) should decide which of `cost`,
`min_price`, and `max_price` a given caller is allowed to receive. Without an explicit mechanism, any
authenticated user holding the basic catalog-view permission would, by default, receive all three —
including `cost` (margin data) and `min_price` (the negotiation floor), both of which a tenant may
legitimately want restricted to specific roles. "The frontend doesn't display it" is not sufficient —
CLAUDE.md and every prior security section in this docs set already treat that as a non-answer; the
restriction must be enforced server-side.

## Decision

**Two independent layers, both server-side, mirroring the pattern already used for tenant isolation
(RLS + composite FKs) — not a single point of enforcement:**

1. **Query projection (repository layer).** The repository method that reads `product_variants`
   accepts the caller's resolved permission set and conditionally includes `cost`/`min_price` in its
   `SELECT` list — a caller lacking `pricing.cost.view` never causes those columns to be fetched at
   all, and a caller lacking `pricing.floor.view` never causes `min_price` to be fetched. This is the
   authenticated-path analogue of the QR resolver's column-level `GRANT`: the value simply never enters
   application memory for an unauthorized caller, so a bug in a *later* layer cannot leak it.
2. **Response DTO (service layer), built by inclusion, not exclusion.** The service constructs the
   response object field-by-field from what the (permission-aware) repository call actually returned —
   never `{...entity}` spread, never a strip-after-the-fact decorator. A field that wasn't fetched
   simply cannot appear; there is no separate "remember to exclude it" step that could be forgotten.

**Visibility rules:** `max_price`/`base_price` require only the existing basic catalog-view permission
(`products.view`) — both are already meant to be shown to a vendor negotiating a sale, and `max_price`
is already the value the *public* QR resolver shows. `min_price` requires `pricing.floor.view` (a
vendor negotiating legitimately needs to know their own floor — see
[database.md#new-permission-codes-for-prompt-02-a02-b-capabilities-prompt-02-d](../architecture/database.md#new-permission-codes-for-prompt-02-a02-b-capabilities-prompt-02-d)).
`cost` requires the separate, more restricted `pricing.cost.view` (margin data, not needed to
negotiate, typically withheld from a base Vendedor role). An unauthorized field is **omitted entirely**
from the response — never `null`, never masked (e.g. `"***"`) — omission doesn't distinguish "hidden"
from "genuinely absent," which is the point: it reveals nothing about whether a value exists.

**Web and Mobile are identical.** Both call the same authenticated endpoint and receive the same
DTO shape for the same caller — there is no client-specific filtering logic anywhere; this is a direct
consequence of [mobile.md#backend-as-the-sole-authority](../architecture/mobile.md#backend-as-the-sole-authority),
not a new rule invented here.

**Any future endpoint reusing the same repository method automatically inherits the restriction** —
this is the concrete reason the query-projection layer exists, not just the DTO layer: a DTO-only
approach means every *new* endpoint must remember to use the restricted DTO, whereas a
permission-aware repository method makes the restriction the default, not an opt-in a future developer
could forget.

**Testing strategy** (not implemented now — this ADR fixes the design, Prompt 03+ implements it),
modeled after the existing [database.md#testing-rls](../architecture/database.md#testing-rls) three-tier
shape: (1) a permission-matrix test — for each of
`{no pricing.cost.view, has pricing.cost.view} × {no pricing.floor.view, has pricing.floor.view}`,
assert the exact field set present/absent in the response for the same underlying record; (2) a
query-level test asserting the repository call itself never requests the restricted columns when the
caller lacks the permission — catching a regression before it ever reaches the DTO layer.

## Alternatives considered

- **DTO/serializer-only filtering** (e.g. `class-transformer`'s `@Exclude()`/`@Expose()` with
  `ClassSerializerInterceptor`, decorator-driven). Rejected as the *sole* mechanism: a decorator-based
  exclude-list is a "remember to mark it" pattern — a new field added to the entity is visible by
  default unless someone remembers to annotate it, the opposite of the allow-by-construction principle
  this ADR chooses. Not rejected as a possible *implementation detail* for layer 2 in Prompt 03 if it
  turns out to fit the existing NestJS/DTO conventions better than hand-built objects — either
  implementation satisfies this ADR's two-layer *architecture*, which is the actual decision being
  recorded here.
- **DTO-layer filtering only, no query projection.** Rejected: fetches the sensitive value into
  application memory (and potentially into logs, error messages, or a debugger) even for a caller who
  will never see it in the response — the query-projection layer is cheap and closes that exposure
  window entirely, consistent with "never fetch what you can't return" already established for the QR
  resolver.
- **A single `pricing.cost.view` permission covering both `cost` and `min_price`.** Considered and
  rejected: a vendor legitimately needs `min_price` to negotiate (already established by the Prompt
  02-A design) but not necessarily `cost` (margin, commonly kept confidential from sales staff even
  when the sales staff sets prices) — collapsing them into one permission would force a tenant to choose
  between "vendor can't negotiate confidently" and "vendor sees the company's margin," a false choice
  the two-permission split avoids.
- **Introducing a new technology** (a policy engine, an attribute-based access control library).
  Rejected per this prompt's explicit instruction not to introduce new technology to solve this — the
  two-layer mechanism above is built entirely from patterns (permission-gated repository calls,
  explicit DTO construction) already implied by the existing NestJS/Drizzle layering in
  [backend.md](../architecture/backend.md#layering-inside-each-module).

## Consequences

- Every repository method returning `product_variants` (or any future table with a similarly sensitive
  field) needs to accept and honor the caller's permission context — a new, explicit requirement for
  Prompt 03's repository layer, not just a service-layer concern.
- `pricing.floor.view` and `pricing.cost.view` (from the [permission
  catalog](../architecture/database.md#new-permission-codes-for-prompt-02-a02-b-capabilities-prompt-02-d))
  need to be assigned to the appropriate default role templates (Vendedor gets `pricing.floor.view`,
  not necessarily `pricing.cost.view`) when tenant provisioning is built.
- This pattern (query projection + allow-list DTO construction) is the template for any future
  sensitive-field problem this schema encounters — it does not need to be redesigned per field.
