import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { warehouses } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface WarehouseRow {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  address: unknown;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `warehouses` — same convention as
 * catalog/repositories/categories.repository.ts: every method takes the caller's already-open
 * tenant transaction, filters explicitly by tenantId on top of (never instead of) RLS.
 */
@Injectable()
export class WarehousesRepository {
  async findById(tx: TenantTransaction, tenantId: string, warehouseId: string): Promise<WarehouseRow | undefined> {
    const [row] = await tx
      .select()
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, warehouseId), isNull(warehouses.deletedAt)));
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; status?: string | undefined },
  ): Promise<{ rows: WarehouseRow[]; total: number }> {
    const conditions = [eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)];
    if (params.status) {
      conditions.push(eq(warehouses.status, params.status));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(warehouses).where(where);

    const rows = await tx
      .select()
      .from(warehouses)
      .where(where)
      .orderBy(warehouses.name)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; name: string; code: string; address?: Record<string, unknown> | undefined },
  ): Promise<WarehouseRow> {
    const [row] = await tx.insert(warehouses).values(values).returning();
    if (!row) {
      throw new Error('Warehouse insert did not return a row.');
    }
    return row;
  }

  /** Undefined fields are left untouched — the caller (service layer) only includes keys it
   * actually wants to change, matching CategoriesRepository.update's convention. */
  async update(
    tx: TenantTransaction,
    tenantId: string,
    warehouseId: string,
    values: { name?: string; code?: string; address?: Record<string, unknown>; status?: string },
  ): Promise<WarehouseRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, warehouseId);
    }
    const [row] = await tx
      .update(warehouses)
      .set(values)
      .where(and(eq(warehouses.tenantId, tenantId), eq(warehouses.id, warehouseId), isNull(warehouses.deletedAt)))
      .returning();
    return row;
  }
}
