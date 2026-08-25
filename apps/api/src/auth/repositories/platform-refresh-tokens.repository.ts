import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { platformAdminRefreshTokens } from '../../database/schema';

export interface PlatformRefreshTokenRow {
  id: string;
  platformAdminId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/**
 * Server-side session store for platform-admin (SuperAdmin) refresh tokens — mirrors
 * RefreshTokensRepository's shape exactly, but reads/writes via the `app_platform` connection
 * (BYPASSRLS) since `platform_admin_refresh_tokens` has no tenant dimension to filter by, same
 * posture as PlatformAdminsRepository. No `withTenantTransaction()` here — there is no tenant to
 * `SET LOCAL app.tenant_id` to.
 */
@Injectable()
export class PlatformRefreshTokensRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async create(values: {
    id: string;
    platformAdminId: string;
    tokenHash: string;
    expiresAt: Date;
    rotatedFromId?: string | undefined;
    userAgent?: string | undefined;
    ipAddress?: string | undefined;
  }): Promise<void> {
    await this.platformDb.insert(platformAdminRefreshTokens).values(values);
  }

  async findByHash(tokenHash: string): Promise<PlatformRefreshTokenRow | undefined> {
    const [row] = await this.platformDb
      .select()
      .from(platformAdminRefreshTokens)
      .where(eq(platformAdminRefreshTokens.tokenHash, tokenHash));
    return row;
  }

  async revoke(id: string): Promise<void> {
    await this.platformDb
      .update(platformAdminRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(platformAdminRefreshTokens.id, id));
  }

  /** "Log out everywhere" / reuse-detection primitive — mirrors
   * RefreshTokensRepository.revokeAllForUser (threat-model.md's "Stolen / replayed JWT" reuse
   * mitigation), applied to the higher-value platform-admin credential. */
  async revokeAllForAdmin(platformAdminId: string): Promise<void> {
    await this.platformDb
      .update(platformAdminRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(platformAdminRefreshTokens.platformAdminId, platformAdminId));
  }
}
