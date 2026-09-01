import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AUTH_CONFIG, type AuthConfig } from '../../common/config/auth-config';
import type {
  PlatformAccessTokenPayload,
  SelectionTokenPayload,
  TenantAccessTokenPayload,
} from '../../common/tokens/access-token-payload';

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

  async issue(userId: string, identityId: string, tenantId: string, tenantSlug: string): Promise<IssuedAccessToken> {
    const payload: TenantAccessTokenPayload = { sub: userId, identityId, tenantId, tenantSlug, jti: randomUUID() };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.authConfig.jwtSecret,
      expiresIn: this.authConfig.accessTokenTtlSeconds,
    });
    return { token, expiresInSeconds: this.authConfig.accessTokenTtlSeconds };
  }

  /**
   * The interim, permission-less tenant-selection token (016-C). Same signing secret; the
   * `purpose` claim keeps it structurally distinct — `JwtAuthGuard` rejects it as a session, only
   * `POST /auth/select-tenant` accepts it. Short TTL from `SELECTION_TOKEN_TTL_SECONDS`.
   */
  async issueSelection(identityId: string): Promise<IssuedAccessToken> {
    const payload: SelectionTokenPayload = { sub: identityId, purpose: 'tenant-selection', jti: randomUUID() };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.authConfig.jwtSecret,
      expiresIn: this.authConfig.selectionTokenTtlSeconds,
    });
    return { token, expiresInSeconds: this.authConfig.selectionTokenTtlSeconds };
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
