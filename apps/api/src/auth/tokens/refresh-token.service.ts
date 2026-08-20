import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AUTH_CONFIG, type AuthConfig } from '../../common/config/auth-config';

export interface GeneratedRefreshToken {
  /** The raw, high-entropy token — returned to the caller exactly once (set in the httpOnly
   * cookie) and never stored; only its hash is persisted. */
  token: string;
  /** HMAC-SHA256(token, JWT_REFRESH_SECRET) — what's actually stored in
   * auth_refresh_tokens.token_hash, so a database read alone can never recover a usable token. */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Refresh tokens are opaque (not JWTs) and tracked server-side (security.md#authentication) so a
 * specific session can be revoked — logout, "log out everywhere" (out of this phase's scope but
 * the storage shape supports it), and reuse detection on rotation (threat-model.md's "Stolen /
 * replayed JWT"). 256 bits of randomness is the actual secret; hashing before storage means a
 * database leak alone never yields a usable token (same reasoning as a password hash, applied to
 * a high-entropy secret instead of a human-chosen one).
 */
@Injectable()
export class RefreshTokenService {
  constructor(@Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig) {}

  generate(): GeneratedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.authConfig.refreshTokenTtlSeconds * 1000);
    return { token, tokenHash: this.hash(token), expiresAt };
  }

  hash(token: string): string {
    return createHmac('sha256', this.authConfig.refreshTokenPepper).update(token).digest('hex');
  }
}
