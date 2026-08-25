import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenantSettings } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface TenantSettingsRow {
  id: string;
  tenantId: string;
  timezone: string;
  businessHours: unknown;
  updatedAt: Date;
}

/**
 * `tenant_settings` is a singleton row per tenant (§7/§10) — this repository always operates on
 * "the caller's tenant's one row", never a list, mirroring the shape of the pre-existing (but
 * still unimplemented-at-the-application-layer) `tenant_price_policies` table it sits alongside.
 */
@Injectable()
export class TenantSettingsRepository {
  async find(tx: TenantTransaction, tenantId: string): Promise<TenantSettingsRow | undefined> {
    const [row] = await tx.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId));
    return row;
  }

  /** Lazily creates the row on first write (no eager provisioning-time insert — see this phase's
   * final report for why) and updates it on every subsequent write — `ON CONFLICT (tenant_id) DO
   * UPDATE`, not SELECT-then-branch, so a concurrent first PATCH from two requests can never
   * produce two rows or a lost update (§27). Always writes both columns: the service resolves
   * "unchanged" fields against the effective value before calling this, so a partial PATCH never
   * has to become a partial SQL SET. */
  async upsert(
    tx: TenantTransaction,
    tenantId: string,
    values: { timezone: string; businessHours: unknown },
  ): Promise<TenantSettingsRow> {
    const [row] = await tx
      .insert(tenantSettings)
      .values({ tenantId, timezone: values.timezone, businessHours: values.businessHours })
      .onConflictDoUpdate({
        target: tenantSettings.tenantId,
        set: { timezone: values.timezone, businessHours: values.businessHours },
      })
      .returning();
    if (!row) {
      throw new Error(`Failed to upsert tenant_settings for tenant ${tenantId}.`);
    }
    return row;
  }
}
