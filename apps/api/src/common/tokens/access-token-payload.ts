/**
 * Shape of the signed access-token JWT (security.md#authentication). Shared between the auth
 * module (issues it) and the common guards (verify it) so neither side depends on the other for
 * this type — auth/ depends on common/, never the reverse.
 *
 * Two, structurally distinct variants share one JWT signing secret (JwtAuthGuard verifies both
 * with the same call) but are never confusable with each other at the type level: a tenant
 * payload always carries `tenantId`/`tenantSlug`; a platform (SuperAdmin) payload never does, and
 * instead carries `context: 'global'` — multi-tenancy.md#superadmin-vs-tenant's "distinct token
 * type/claim... does not grant blanket access to every tenant's data." This is what lets
 * TenantGuard route a request to either the ordinary tenant-scoped path or the
 * @PlatformOnly()-gated path without ever needing to trust a client-supplied flag.
 */
export interface TenantAccessTokenPayload {
  /** Subject — the authenticated **tenant-scoped user's** id (`users.id`). Deliberately unchanged
   * by 016-C / ADR-0033: every guard, `@CurrentUser()`, and `audit_log.actor_id` keeps reading
   * `sub` as the user id. The global identity is a separate claim, below. */
  sub: string;
  /** The global `identities.id` this session's user belongs to (016-C). Lets a request resolve
   * the identity (e.g. its other memberships) and lets TenantGuard live-check identity/membership
   * status — never used as the RLS key, which is always `tenantId`. */
  identityId: string;
  tenantId: string;
  /** Not sensitive (a tenant's slug is effectively public, like a company name) — embedded so
   * GET /auth/me can return it without an extra app_platform round trip. */
  tenantSlug: string;
  /** Unique token id (defense-in-depth identifier for log correlation; this phase does not
   * implement access-token blacklisting — access tokens are short-lived by design instead). */
  jti: string;
}

/** Subject is a `platform_admins.id`, never a tenant `users.id` — the two id spaces are never
 * compared against each other anywhere in this codebase. */
export interface PlatformAccessTokenPayload {
  sub: string;
  context: 'global';
  jti: string;
}

/**
 * The short-lived, permission-less token issued by `POST /auth/login` when an identity has more
 * than one active membership (016-C). It proves only "these credentials were validated" and
 * carries just enough to complete `POST /auth/select-tenant`; it is NOT an access token and every
 * guard must refuse it as a session. Signed with the same `JWT_SECRET` — the `purpose` claim is
 * the discriminator, exactly as `context: 'global'` discriminates the platform payload.
 */
export interface SelectionTokenPayload {
  /** Subject — the global `identities.id`. Never a `users.id`. */
  sub: string;
  purpose: 'tenant-selection';
  jti: string;
}

export type AccessTokenPayload = TenantAccessTokenPayload | PlatformAccessTokenPayload;

/** Any verified JWT the auth surface issues — access tokens plus the interim selection token. */
export type AnyIssuedTokenPayload = AccessTokenPayload | SelectionTokenPayload;

export function isPlatformAccessTokenPayload(payload: AnyIssuedTokenPayload): payload is PlatformAccessTokenPayload {
  return (payload as PlatformAccessTokenPayload).context === 'global';
}

export function isSelectionTokenPayload(payload: AnyIssuedTokenPayload): payload is SelectionTokenPayload {
  return (payload as SelectionTokenPayload).purpose === 'tenant-selection';
}
