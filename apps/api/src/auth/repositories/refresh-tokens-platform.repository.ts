import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { authRefreshTokens, tenants } from '../../database/schema';

export interface RefreshTokenLookup {
  id: string;
  tenantId: string;
  tenantSlug: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * The one read a refresh token needs before its tenant is known: `token_hash` is globally unique
 * (migration 0013), so a single cross-tenant SELECT via app_platform (read-only — see
 * migration 0013's GRANT) resolves which tenant a presented opaque token belongs to. Every
 * subsequent mutation (revoke, rotate) then goes through the normal app_tenant /
 * withTenantTransaction path with that now-known tenantId — this repository only ever reads.
 *
 * This is the same sanctioned pattern multi-tenancy.md describes for
 * administrative/cross-tenant reads: narrow, explicit, and never a substitute for the tenant-
 * scoped write path.
 */
@Injectable()
export class RefreshTokensPlatformRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async findByHash(tokenHash: string): Promise<RefreshTokenLookup | undefined> {
    const [row] = await this.platformDb
      .select({
        id: authRefreshTokens.id,
        tenantId: authRefreshTokens.tenantId,
        tenantSlug: tenants.slug,
        userId: authRefreshTokens.userId,
        expiresAt: authRefreshTokens.expiresAt,
        revokedAt: authRefreshTokens.revokedAt,
      })
      .from(authRefreshTokens)
      .innerJoin(tenants, eq(tenants.id, authRefreshTokens.tenantId))
      .where(eq(authRefreshTokens.tokenHash, tokenHash));
    return row;
  }
}
