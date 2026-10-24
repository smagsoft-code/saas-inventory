import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenantLogos } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface TenantLogoRow {
  id: string;
  tenantId: string;
  storageKey: string;
  mimeType: string;
  createdAt: Date;
  updatedAt: Date;
}

/** `tenant_logos` — at most one row per tenant (`UNIQUE (tenant_id)`). Never the image bytes:
 * `storageKey` is an opaque pointer resolved by the service only when streaming the logo back. */
@Injectable()
export class TenantLogoRepository {
  async find(tx: TenantTransaction, tenantId: string): Promise<TenantLogoRow | undefined> {
    const [row] = await tx.select().from(tenantLogos).where(eq(tenantLogos.tenantId, tenantId));
    return row;
  }

  /** `INSERT ... ON CONFLICT (tenant_id) DO UPDATE` — two concurrent first uploads can never make
   * two rows. */
  async upsert(tx: TenantTransaction, tenantId: string, values: { storageKey: string; mimeType: string }): Promise<TenantLogoRow> {
    const [row] = await tx
      .insert(tenantLogos)
      .values({ tenantId, storageKey: values.storageKey, mimeType: values.mimeType })
      .onConflictDoUpdate({ target: tenantLogos.tenantId, set: { storageKey: values.storageKey, mimeType: values.mimeType } })
      .returning();
    if (!row) {
      throw new Error(`Failed to upsert tenant_logos for tenant ${tenantId}.`);
    }
    return row;
  }

  async delete(tx: TenantTransaction, tenantId: string): Promise<void> {
    await tx.delete(tenantLogos).where(eq(tenantLogos.tenantId, tenantId));
  }
}
