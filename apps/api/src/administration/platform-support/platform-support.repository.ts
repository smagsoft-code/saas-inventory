import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { roles, userRoles, users, warehouses } from '../../database/schema';

export interface SupportUserRow {
  id: string;
  email: string;
  fullName: string;
  status: string;
  roleNames: string[];
  createdAt: Date;
}

export interface SupportWarehouseRow {
  id: string;
  name: string;
  code: string;
  status: string;
}

/**
 * ADR-0036 §9 — the curated SUPPORT_READ surface (tenant users, tenant warehouses) plus the one
 * curated SUPPORT_WRITE action this block ships (warehouse status toggle). Deliberately NOT a
 * reuse of the tenant-scoped repositories (`UsersRepository`, `WarehousesRepository`) — those run
 * inside `withTenantTransaction` (`app_tenant`, RLS-scoped, expect a real tenant actor for
 * audit/FK purposes); this repository runs on `app_platform` (BYPASSRLS, already granted the exact
 * columns it touches — migrations 0002/0005/0033), explicitly filtered by `tenantId` in every
 * WHERE clause as defense-in-depth even though RLS does not apply to this connection at all.
 *
 * This is intentionally a NARROW, bounded surface — not a reimplementation of the tenant API. See
 * ADR-0036's "Tenant Support — scope of this block" for the explicit list of what is deliberately
 * NOT included yet (products, inventory movements, sales, customer data), tracked as
 * `GAP-SUPPORT-READ-SCOPE` for a deliberate, later, one-at-a-time expansion — never grown silently
 * by widening this repository without updating that list.
 */
@Injectable()
export class PlatformSupportRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async listUsers(tenantId: string): Promise<SupportUserRow[]> {
    const rows = await this.platformDb
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
        createdAt: users.createdAt,
        roleName: roles.name,
      })
      .from(users)
      .leftJoin(userRoles, and(eq(userRoles.userId, users.id), eq(userRoles.tenantId, tenantId)))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt)))
      .orderBy(users.createdAt);

    const byUser = new Map<string, SupportUserRow>();
    for (const row of rows) {
      const existing = byUser.get(row.id);
      if (existing) {
        if (row.roleName) existing.roleNames.push(row.roleName);
        continue;
      }
      byUser.set(row.id, {
        id: row.id,
        email: row.email,
        fullName: row.fullName,
        status: row.status,
        createdAt: row.createdAt,
        roleNames: row.roleName ? [row.roleName] : [],
      });
    }
    return [...byUser.values()];
  }

  async listWarehouses(tenantId: string): Promise<SupportWarehouseRow[]> {
    return this.platformDb
      .select({ id: warehouses.id, name: warehouses.name, code: warehouses.code, status: warehouses.status })
      .from(warehouses)
      .where(and(eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
      .orderBy(warehouses.name);
  }

  /** The one curated SUPPORT_WRITE action (ADR-0036 §9's worked example). Column-level UPDATE
   * grant (migration 0033) means this is the ONLY column this connection can ever write on this
   * table, at the database level — not merely by this query's own discipline. */
  async setWarehouseStatus(tenantId: string, warehouseId: string, status: 'active' | 'inactive'): Promise<SupportWarehouseRow | undefined> {
    const [row] = await this.platformDb
      .update(warehouses)
      .set({ status })
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)))
      .returning({ id: warehouses.id, name: warehouses.name, code: warehouses.code, status: warehouses.status });
    return row;
  }

  async findWarehouseStatus(tenantId: string, warehouseId: string): Promise<string | undefined> {
    const [row] = await this.platformDb
      .select({ status: warehouses.status })
      .from(warehouses)
      .where(and(eq(warehouses.id, warehouseId), eq(warehouses.tenantId, tenantId), isNull(warehouses.deletedAt)));
    return row?.status;
  }
}
