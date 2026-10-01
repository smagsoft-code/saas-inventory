import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { tenantSettings } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface TransferWorkflowConfig {
  requireApproval: boolean;
  requirePreparation: boolean;
}

/** Matches the schema column defaults exactly (`13-administration.ts`) and
 * `tenant-settings.service.ts`'s own `DEFAULT_TRANSFERS_REQUIRE_*` — a tenant with no
 * `tenant_settings` row yet gets today's full flow, same as one that has a row but never touched
 * these two fields. */
const DEFAULT_CONFIG: TransferWorkflowConfig = { requireApproval: true, requirePreparation: true };

/**
 * INVENTORY --> ADMINISTRATION has no edge in modules.md (only `Inventory --> Core`/`Inventory -->
 * Catalog`) — reads `tenant_settings` directly rather than importing AdministrationModule's
 * `TenantSettingsRepository`, the same "read the schema table directly, don't cross a module
 * boundary that doesn't exist" convention `product-variants-lookup.repository.ts` already
 * documents for the Inventory-->Catalog edge. Read-only: nothing under inventory/ ever writes
 * `tenant_settings` — that stays Administration's alone (`PATCH /administration/tenant-settings`).
 */
@Injectable()
export class TransferWorkflowConfigRepository {
  async get(tx: TenantTransaction, tenantId: string): Promise<TransferWorkflowConfig> {
    const [row] = await tx
      .select({
        requireApproval: tenantSettings.transfersRequireApproval,
        requirePreparation: tenantSettings.transfersRequirePreparation,
      })
      .from(tenantSettings)
      .where(eq(tenantSettings.tenantId, tenantId));
    return row ?? DEFAULT_CONFIG;
  }
}
