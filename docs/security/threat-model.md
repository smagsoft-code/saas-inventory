# Threat Model

This maps concrete threats to risk, impact, mitigation, and priority, at the architecture level
defined so far. It is a living document — revisited whenever a new module changes the attack
surface, and formally revisited wholesale in FASE 15 (Security Hardening) of the
[roadmap](../roadmap/roadmap.md). See also [../architecture/security.md](../architecture/security.md)
(the mitigations in more depth) and [SECURITY.md](../../SECURITY.md) (policy).

Priority: **P0** = must be prevented by design before any tenant data exists; **P1** = must be
mitigated before production launch; **P2** = mitigated, monitored, revisited as the platform
grows.

## Cross-tenant access

- **Risk:** a request authenticated as tenant A reads or writes tenant B's data.
- **Impact:** critical — this is the platform's core promise to every customer; a single incident
  is a trust-ending event, not just a bug.
- **Mitigation:** tenant context derived only from the verified token (never client input),
  enforced at the guard layer and the repository layer, with RLS (enabled from the first migration —
  see [database.md#row-level-security](../architecture/database.md#row-level-security)) and
  tenant-aware composite foreign keys (see
  [database.md#tenant-aware-referential-integrity](../architecture/database.md#tenant-aware-referential-integrity))
  as database-level backstops. See
  [multi-tenancy.md](../architecture/multi-tenancy.md#enforcement-layers-defense-in-depth).
- **Priority:** P0.

## Privilege escalation

- **Risk:** a user obtains permissions their role doesn't grant (e.g. a Vendedor performing an
  Administrator-only action), or a tenant user obtains SuperAdmin-shaped access.
- **Impact:** high — ranges from unauthorized data access to full platform compromise if
  SuperAdmin-shaped access is obtained.
- **Mitigation:** every non-public route declares a required permission, checked server-side per
  request (see [security.md#authorization-rbac--permissions](../architecture/security.md#authorization-rbac--permissions));
  SuperAdmin identity is structurally separate from tenant users, not a role flag (see
  [multi-tenancy.md#superadmin-vs-tenant](../architecture/multi-tenancy.md#superadmin-vs-tenant)),
  so there is no single bit to flip to gain it. Location-scoped authorization (Prompt 02-A) adds a
  narrower instance of this same class within a tenant — a user authorized for one location must not
  thereby act on another; see
  [database.md#location-scoped-authorization](../architecture/database.md#location-scoped-authorization).
- **Priority:** P0.

## Unauthorized exceptional discount

- **Risk:** a vendor sells below the authorized minimum price without the required approval — either
  by a client bypassing the approval gate directly, or by a compromised/careless server-side check
  failing to enforce it.
- **Impact:** medium — direct financial loss per occurrence, and if systematic, a real gap in the
  business's pricing controls; bounded (unlike cross-tenant access) to whatever a single sale's margin
  is.
- **Mitigation:** `order_items.unit_price_snapshot < min_price_snapshot` requires a resolved
  `price_approvals` row (`APPROVED`, not `PENDING`/`REJECTED`/`CANCELLED`) before the order can reach
  `confirmed` — a database-queryable gate (the `(tenant_id, order_id, status)` index), not a
  client-trusted flag; a request below the tenant's configured hard floor
  (`tenant_price_policies.max_discount_below_min_percent`) is rejected before an approval request can
  even be created, closing off "ask for approval on something that should never be approvable" as a
  bypass path. See
  [database.md#pricing-history-tenant-policy-and-exceptional-discount-approval](../architecture/database.md#pricing-history-tenant-policy-and-exceptional-discount-approval)
  and [ADR-0022](../decisions/0022-pricing-tiers-and-discount-approval.md).
- **Priority:** P2.

## Stolen / replayed JWT

- **Risk:** an access or refresh token is exfiltrated (XSS, network interception, log leakage,
  device compromise) and reused by an attacker.
- **Impact:** high — full impersonation of the token's holder for the token's lifetime.
- **Mitigation:** short-lived access tokens; refresh tokens tracked server-side and rotated on use
  (a reused, already-rotated refresh token is detectable and revocable); TLS everywhere in transit;
  tokens never logged; session-transport choice weighed partly on XSS exposure (see
  [security.md#authentication](../architecture/security.md#authentication)).
- **Priority:** P1.

## Compromised user account

- **Risk:** a legitimate user's credentials are phished/leaked/reused from another breach.
- **Impact:** medium–high, bounded by that user's actual permissions (another reason permissions
  should be as granular and minimal as the role genuinely needs, not broad by default).
- **Mitigation:** brute-force protection on login (see
  [security.md#rate-limiting-and-brute-force-protection](../architecture/security.md#rate-limiting-and-brute-force-protection)),
  password hashing that resists offline cracking if the hash itself ever leaked, audit logging of
  auth events so anomalous access is at least reviewable after the fact, "log out everywhere" via
  refresh-token revocation.
- **Priority:** P1.

## SQL injection

- **Risk:** attacker-controlled input alters an intended SQL query.
- **Impact:** high — potentially all data in the database, across tenants.
- **Mitigation:** all queries go through Drizzle's parameterized query builder; no string
  concatenation of user input into SQL. See
  [security.md#input-validation-sql-injection-xss](../architecture/security.md#input-validation-sql-injection-xss).
- **Priority:** P0 (prevented structurally by tooling choice, not by per-query discipline).

## XSS

- **Risk:** attacker-controlled content (a product name, a tenant setting, ...) executes as script
  in another user's browser.
- **Impact:** medium–high — can lead to token theft (see [Stolen JWT](#stolen--replayed-jwt) above)
  or acting as the victim user.
- **Mitigation:** React's default escaping; no unreviewed `dangerouslySetInnerHTML`-equivalent use
  on tenant-supplied content; a Content-Security-Policy header as defense-in-depth. See
  [security.md#input-validation-sql-injection-xss](../architecture/security.md#input-validation-sql-injection-xss).
- **Priority:** P1.

## CSRF

- **Risk:** if cookie-based session transport is chosen (see the
  [pending decision](../architecture/frontend.md#authentication-and-route-protection)), a
  malicious page triggers a state-changing request using the victim's ambient cookie.
- **Impact:** medium, bounded by what state-changing actions exist and what the victim's
  permissions allow.
- **Mitigation:** `SameSite` cookies plus a CSRF token on state-changing requests, if/when cookies
  are the chosen transport. See [security.md#csrf](../architecture/security.md#csrf).
- **Priority:** P1 (contingent on the transport decision).

## Malicious file upload

- **Risk:** an uploaded product image (or future upload) is actually an executable, a script, or
  crafted to exploit an image-processing library. For the Excel import pipeline (Prompt 02-B)
  specifically: a macro-enabled spreadsheet, a formula crafted to execute when opened
  (CSV/Excel formula injection), or a malformed/oversized `.xlsx` (a zip container) intended to exhaust
  parser memory/time.
- **Impact:** medium–high depending on where/how uploads are processed and served.
- **Mitigation:** content-type validated against actual content, size and extension limits, storage
  in object storage rather than the API's filesystem, served from an isolated origin. For Excel
  specifically: `.xlsx` only (macro-enabled `.xlsm` rejected outright), cell **values** read only,
  never live formula evaluation, and the generated error report sanitizes any echoed cell content
  before writing it into a downloadable file. See
  [security.md#file-upload-security](../architecture/security.md#file-upload-security) and
  [database.md#security-of-the-uploaded-file](../architecture/database.md#security-of-the-uploaded-file).
- **Priority:** P1.

## Webhook abuse (outbound to n8n) — FASE 15

- **Risk:** the outbox → n8n webhook call is coerced into hitting an unintended target (SSRF), or
  a malicious/compromised n8n endpoint is treated as trusted; the shared bearer secret leaks.
- **Impact:** medium — the webhook target is operator configuration (`N8N_EVENTS_WEBHOOK_URL`),
  never tenant-supplied (§121/§122), which limits this today; the risk grows if/when
  tenant-configurable webhook destinations are ever introduced.
- **Mitigation:** `N8N_EVENTS_AUTH_TOKEN` (sent only as `Authorization: Bearer`, never in the body
  or query string) authenticates the call; the URL is validated at startup (HTTPS required except
  `localhost` in dev, no embedded credentials, min-length secret) and the adapter uses
  `redirect: 'manual'` so a 3xx is never followed and the bearer token is never resent to another
  host. Error-response bodies are sanitised + truncated before reaching `last_error`/logs. Target
  URL validation against private/internal address ranges applies to any future feature accepting a
  tenant-supplied URL. See [security.md#ssrf](../architecture/security.md#ssrf),
  [events.md](../architecture/events.md#n8n-delivery-adapter-fase-15) and
  [integrations/n8n.md](../integrations/n8n.md).
- **Priority:** P2 today; revisit as P1 if tenant-configurable webhook targets are built.

## Replay attack

- **Risk:** a captured, legitimate request (e.g. a state-changing API call) is resent by an
  attacker to repeat its effect.
- **Impact:** medium, most concretely relevant to order creation (duplicate orders) once SALES
  exists.
- **Mitigation:** TLS prevents on-path capture in the common case; `Idempotency-Key` on
  effect-sensitive endpoints means even a legitimately retried (or replayed) request doesn't
  duplicate the effect. See [api.md#idempotency](../architecture/api.md#idempotency) for the API
  contract and [database.md#idempotency](../architecture/database.md#idempotency) for the persistence
  design (the `idempotency_keys` table, plus the narrower ledger-level guard on
  `inventory_movements`).
- **Priority:** P2.

## Brute force

- **Risk:** automated credential guessing against login (or, later, the QR public resolver, or any
  other unauthenticated endpoint).
- **Impact:** medium, primarily against weak passwords.
- **Mitigation:** rate limiting keyed by IP + identifier with backoff; see
  [security.md#rate-limiting-and-brute-force-protection](../architecture/security.md#rate-limiting-and-brute-force-protection).
- **Priority:** P1.

## Leaked secrets

- **Risk:** a credential (DB password, JWT signing secret, n8n webhook secret) ends up in Git
  history, a log line, or a client bundle.
- **Impact:** critical — most of these secrets, if leaked, grant broad access.
- **Mitigation:** `.gitignore` excludes `.env*` (except `.env.example`, which has no real values);
  secrets are never logged; frontend never receives backend secrets; CI/PR review watches for
  accidental inclusion. See [SECURITY.md](../../SECURITY.md#secret-management).
- **Priority:** P0.

## Compromised container

- **Risk:** an attacker gains code execution inside the `api` or `web` container (via a dependency
  vulnerability, a misconfigured upload path, etc.).
- **Impact:** high if the container can then reach Postgres/Redis with broad credentials, or pivot
  to other containers.
- **Mitigation:** containers run non-root where the base image supports it; Postgres/Redis are
  unreachable from outside the internal Docker network, so a compromised `web` container in
  particular cannot reach the database directly (it was never given a path to); dependency
  scanning to reduce the odds of a known-vulnerable dependency being the entry point. See
  [security.md#docker-security](../architecture/security.md#docker-security) and
  [security.md#dependency-scanning](../architecture/security.md#dependency-scanning).
- **Priority:** P1.

## Summary table

| Threat | Priority |
| --- | --- |
| Cross-tenant access | P0 |
| Privilege escalation | P0 |
| SQL injection | P0 |
| Leaked secrets | P0 |
| Stolen / replayed JWT | P1 |
| Compromised user account | P1 |
| XSS | P1 |
| CSRF | P1 (contingent) |
| Malicious file upload | P1 |
| Brute force | P1 |
| Compromised container | P1 |
| Webhook abuse | P2 (today) |
| Replay attack | P2 |
| Unauthorized exceptional discount | P2 |

P0 items are addressed by the architecture itself (guard/repository tenant filtering, parameterized
queries, structurally separate SuperAdmin identity, gitignored secrets) rather than left as
per-feature discipline. P1 items are addressed as the relevant module (auth, uploads, containers)
is actually built, and re-verified in FASE 15.
