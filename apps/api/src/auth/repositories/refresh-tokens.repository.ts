import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { authRefreshTokens } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface RefreshTokenRow {
  id: string;
  tenantId: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedFromId: string | null;
}

@Injectable()
export class RefreshTokensRepository {
  async create(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      userId: string;
      tokenHash: string;
      expiresAt: Date;
      rotatedFromId?: string | undefined;
      userAgent?: string | undefined;
      ipAddress?: string | undefined;
    },
  ): Promise<void> {
    await tx.insert(authRefreshTokens).values(values);
  }

  async findByHash(tx: TenantTransaction, tenantId: string, tokenHash: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await tx
      .select()
      .from(authRefreshTokens)
      .where(and(eq(authRefreshTokens.tenantId, tenantId), eq(authRefreshTokens.tokenHash, tokenHash)));
    return row;
  }

  async revoke(tx: TenantTransaction, tenantId: string, id: string): Promise<void> {
    await tx
      .update(authRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(authRefreshTokens.tenantId, tenantId), eq(authRefreshTokens.id, id)));
  }

  /** "Log out everywhere" primitive — revokes every currently-active token for a user. Used when
   * a rotated-and-already-used token is presented again (threat-model.md's reuse-detection
   * mitigation for a stolen refresh token: assume compromise, kill every session). */
  async revokeAllForUser(tx: TenantTransaction, tenantId: string, userId: string): Promise<void> {
    await tx
      .update(authRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(authRefreshTokens.tenantId, tenantId), eq(authRefreshTokens.userId, userId)));
  }
}
