import { Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { inventoryBalances } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface InventoryBalanceRow {
  id: string;
  tenantId: string;
  productVariantId: string;
  locationId: string;
  quantityPhysical: string;
  quantityReserved: string;
  quantityCommitted: string;
  quantityAvailable: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Read-only access to `inventory_balances` — database.md#inventory-warehouses-locations-balance-ledger's
 * MATERIALIZED READ MODEL. All writes go through StockLedgerService's locking convoy, never through
 * this repository, same "repository doesn't do business logic" posture as every other repository in
 * this codebase.
 */
@Injectable()
export class InventoryBalancesRepository {
  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<InventoryBalanceRow | undefined> {
    const [row] = await tx.select().from(inventoryBalances).where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.id, id)));
    return row;
  }

  async findByVariantAndLocation(
    tx: TenantTransaction,
    tenantId: string,
    productVariantId: string,
    locationId: string,
  ): Promise<InventoryBalanceRow | undefined> {
    const [row] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.productVariantId, productVariantId),
          eq(inventoryBalances.locationId, locationId),
        ),
      );
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; productVariantId?: string | undefined; locationId?: string | undefined },
  ): Promise<{ rows: InventoryBalanceRow[]; total: number }> {
    const conditions = [eq(inventoryBalances.tenantId, tenantId)];
    if (params.productVariantId) {
      conditions.push(eq(inventoryBalances.productVariantId, params.productVariantId));
    }
    if (params.locationId) {
      conditions.push(eq(inventoryBalances.locationId, params.locationId));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(inventoryBalances).where(where);

    const rows = await tx
      .select()
      .from(inventoryBalances)
      .where(where)
      .orderBy(inventoryBalances.updatedAt)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }
}
