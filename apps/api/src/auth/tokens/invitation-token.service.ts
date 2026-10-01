import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from '../../common/config/auth-config';

export interface GeneratedInvitationToken {
  /** The raw, high-entropy token — returned to the caller (the SuperAdmin, to copy into the link
   * they hand the new admin) exactly once, at creation/resend; never stored. */
  token: string;
  /** HMAC-SHA256(token, JWT_REFRESH_SECRET) — same pepper and shape as
   * `RefreshTokenService`/`auth_refresh_tokens.token_hash`, what's actually persisted in
   * `tenant_admin_invitations.token_hash`, so a database leak alone never yields a usable
   * invitation link (ADR-0036 §5: "no almacenar el token en texto plano"). */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * ADR-0036 — an invitation token is the same shape of secret a refresh token already is (opaque,
 * high-entropy, hashed-at-rest), so this mirrors `RefreshTokenService` exactly rather than
 * inventing a second convention. Deliberately its own service, not a reuse of
 * `RefreshTokenService` itself: that class's name/config field (`refreshTokenTtlSeconds`) is
 * refresh-token-specific, and an invitation token is a different kind of secret with its own TTL
 * (`invitationTokenTtlSeconds`) — sharing the *pepper* (both read `authConfig.refreshTokenPepper`,
 * i.e. `JWT_REFRESH_SECRET`) is intentional reuse of the one HMAC key this codebase already
 * provisions for hashing opaque tokens; sharing the *class* would not be.
 */
@Injectable()
export class InvitationTokenService {
  constructor(@Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig) {}

  generate(): GeneratedInvitationToken {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.authConfig.invitationTokenTtlSeconds * 1000);
    return { token, tokenHash: this.hash(token), expiresAt };
  }

  hash(token: string): string {
    return createHmac('sha256', this.authConfig.refreshTokenPepper).update(token).digest('hex');
  }
}
