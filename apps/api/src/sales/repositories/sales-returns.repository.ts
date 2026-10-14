import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { salesReturns } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface SalesReturnRow {
  id: string;
  tenantId: string;
  returnNumber: string;
  orderId: string;
  locationId: string;
  status: string;
  requestedBy: string;
  receivedBy: string | null;
  reason: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSalesReturnValues {
  id: string;
  tenantId: string;
  returnNumber: string;
  orderId: string;
  locationId: string;
  status: string;
  requestedBy: string;
  reason: string;
}

/**
 * `sales_returns` — SALES owns this table (modules.md#sales, database.md#sales-returns-and-disposition).
 * No hard delete, no `deleted_at`: `status` governs the lifecycle
 * (`requested` → `inspecting` → `resolved`, or → `cancelled`). Every transition goes through an
 * explicit command in the service (never `PATCH { status }`), and the two that matter for
 * concurrency (`resolve`, `cancel`) begin with `lockById` — the `SELECT ... FOR UPDATE` on this one
 * row is the serialization point, the same shape `orders`/`inventory_transfers` transitions use.
 */
@Injectable()
export class SalesReturnsRepository {
  async create(tx: TenantTransaction, values: CreateSalesReturnValues): Promise<SalesReturnRow> {
    const [row] = await tx.insert(salesReturns).values(values).returning();
    if (!row) {
      throw new Error('Sales return insert did not return a row.');
    }
    return row;
  }

  /** Concurrency-safe, tenant-scoped numbering — same shape as `OrdersRepository.nextOrderNumber`:
   * a transaction-scoped advisory lock serializes concurrent creates before the count; returns are
   * never hard-deleted, so `count(*) + 1` is monotonic per tenant. Three digits is a minimum
   * (`DEV-001` … `DEV-999`, then `DEV-1000`), never a cap. */
  async nextReturnNumber(tx: TenantTransaction, tenantId: string): Promise<string> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sales.return_number:${tenantId}`}))`);
    const [row] = await tx.select({ total: count() }).from(salesReturns).where(eq(salesReturns.tenantId, tenantId));
    const next = (row?.total ?? 0) + 1;
    return `DEV-${String(next).padStart(3, '0')}`;
  }

  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<SalesReturnRow | undefined> {
    const [row] = await tx
      .select()
      .from(salesReturns)
      .where(and(eq(salesReturns.tenantId, tenantId), eq(salesReturns.id, id)));
    return row;
  }

  async lockById(tx: TenantTransaction, tenantId: string, id: string): Promise<SalesReturnRow | undefined> {
    const [row] = await tx
      .select()
      .from(salesReturns)
      .where(and(eq(salesReturns.tenantId, tenantId), eq(salesReturns.id, id)))
      .for('update');
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: {
      page: number;
      pageSize: number;
      status?: string | undefined;
      orderId?: string | undefined;
      locationId?: string | undefined;
      locationIds?: string[] | undefined;
      /** Half-open business-day range already resolved to UTC instants (`localDayRangeToUtc`). */
      dayRange?: { gte: Date; lt: Date } | undefined;
    },
  ): Promise<{ rows: SalesReturnRow[]; total: number }> {
    const conditions: SQL[] = [eq(salesReturns.tenantId, tenantId)];
    if (params.status) {
      conditions.push(eq(salesReturns.status, params.status));
    }
    if (params.orderId) {
      conditions.push(eq(salesReturns.orderId, params.orderId));
    }
    if (params.locationId) {
      conditions.push(eq(salesReturns.locationId, params.locationId));
    }
    // Read scope of a restricted caller (ADR-0024/0035): only their assigned locations; none = nothing.
    if (params.locationIds) {
      conditions.push(params.locationIds.length > 0 ? inArray(salesReturns.locationId, params.locationIds) : sql`false`);
    }
    if (params.dayRange) {
      conditions.push(gte(salesReturns.createdAt, params.dayRange.gte));
      conditions.push(lt(salesReturns.createdAt, params.dayRange.lt));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(salesReturns).where(where);
    const rows = await tx
      .select()
      .from(salesReturns)
      .where(where)
      .orderBy(desc(salesReturns.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    return { rows, total: totalRow?.total ?? 0 };
  }

  async updateStatus(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { status: string; receivedBy?: string | undefined },
  ): Promise<SalesReturnRow | undefined> {
    const [row] = await tx
      .update(salesReturns)
      .set({
        status: values.status,
        ...(values.receivedBy !== undefined ? { receivedBy: values.receivedBy } : {}),
      })
      .where(and(eq(salesReturns.tenantId, tenantId), eq(salesReturns.id, id)))
      .returning();
    return row;
  }
}
