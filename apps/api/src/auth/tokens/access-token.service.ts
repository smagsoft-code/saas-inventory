import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_CONFIG, type AuthConfig } from '../../common/config/auth-config';
import type { AccessTokenPayload, PlatformAccessTokenPayload } from '../../common/tokens/access-token-payload';

export interface IssuedAccessToken {
  token: string;
  expiresInSeconds: number;
}

/**
 * Issues short-lived access tokens (security.md#authentication) — a signed JWT, never persisted
 * server-side (verification is stateless; revocation happens at the refresh-token layer, which is
 * what forces re-authentication once the short access-token TTL expires).
 */
@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwtService: JwtService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  async issue(userId: string, tenantId: string, tenantSlug: string): Promise<IssuedAccessToken> {
    const payload: AccessTokenPayload = { sub: userId, tenantId, tenantSlug, jti: randomUUID() };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.authConfig.jwtSecret,
      expiresIn: this.authConfig.accessTokenTtlSeconds,
    });
    return { token, expiresInSeconds: this.authConfig.accessTokenTtlSeconds };
  }

  /** Issues a platform (SuperAdmin) access token — same secret/TTL, structurally distinct payload
   * (no `tenantId`, `context: 'global'`) — see access-token-payload.ts. */
  async issuePlatform(platformAdminId: string): Promise<IssuedAccessToken> {
    const payload: PlatformAccessTokenPayload = { sub: platformAdminId, context: 'global', jti: randomUUID() };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.authConfig.jwtSecret,
      expiresIn: this.authConfig.accessTokenTtlSeconds,
    });
    return { token, expiresInSeconds: this.authConfig.accessTokenTtlSeconds };
  }
}
