/**
 * Shape of the signed access-token JWT (security.md#authentication). Shared between the auth
 * module (issues it) and the common guards (verify it) so neither side depends on the other for
 * this type — auth/ depends on common/, never the reverse.
 */
export interface AccessTokenPayload {
  /** Subject — the authenticated user's id. */
  sub: string;
  tenantId: string;
  /** Not sensitive (a tenant's slug is effectively public, like a company name) — embedded so
   * GET /auth/me can return it without an extra app_platform round trip. */
  tenantSlug: string;
  /** Unique token id (defense-in-depth identifier for log correlation; this phase does not
   * implement access-token blacklisting — access tokens are short-lived by design instead). */
  jti: string;
}
