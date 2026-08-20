import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { locations } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface LocationRow {
  id: string;
  tenantId: string;
  warehouseId: string;
  parentLocationId: string | null;
  name: string;
  code: string;
  isSellable: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `locations` — same convention as
 * catalog/repositories/categories.repository.ts.
 */
@Injectable()
export class LocationsRepository {
  async findById(tx: TenantTransaction, tenantId: string, locationId: string): Promise<LocationRow | undefined> {
    const [row] = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), isNull(locations.deletedAt)));
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; warehouseId?: string | undefined; status?: string | undefined },
  ): Promise<{ rows: LocationRow[]; total: number }> {
    const conditions = [eq(locations.tenantId, tenantId), isNull(locations.deletedAt)];
    if (params.warehouseId) {
      conditions.push(eq(locations.warehouseId, params.warehouseId));
    }
    if (params.status) {
      conditions.push(eq(locations.status, params.status));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(locations).where(where);

    const rows = await tx
      .select()
      .from(locations)
      .where(where)
      .orderBy(locations.name)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  async create(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      warehouseId: string;
      parentLocationId?: string | undefined;
      name: string;
      code: string;
      isSellable?: boolean | undefined;
    },
  ): Promise<LocationRow> {
    const [row] = await tx.insert(locations).values(values).returning();
    if (!row) {
      throw new Error('Location insert did not return a row.');
    }
    return row;
  }

  /** Undefined fields are left untouched — the caller (service layer) only includes keys it
   * actually wants to change, matching CategoriesRepository.update's convention. */
  async update(
    tx: TenantTransaction,
    tenantId: string,
    locationId: string,
    values: { name?: string; code?: string; parentLocationId?: string; isSellable?: boolean; status?: string },
  ): Promise<LocationRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, locationId);
    }
    const [row] = await tx
      .update(locations)
      .set(values)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), isNull(locations.deletedAt)))
      .returning();
    return row;
  }
}
