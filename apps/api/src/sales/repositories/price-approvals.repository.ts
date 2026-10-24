import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { orders, priceApprovals } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface PriceApprovalRow {
  id: string;
  tenantId: string;
  orderId: string;
  orderItemId: string;
  approvalNumber: string;
  requestedPrice: string;
  minPriceAtRequest: string;
  basePriceAtRequest: string;
  maxPriceAtRequest: string;
  discountAmount: string;
  reason: string;
  requestedBy: string;
  approvedBy: string | null;
  status: string;
  requestedAt: Date;
  resolvedAt: Date | null;
}

export interface CreatePriceApprovalValues {
  id: string;
  tenantId: string;
  orderId: string;
  orderItemId: string;
  approvalNumber: string;
  requestedPrice: string;
  minPriceAtRequest: string;
  basePriceAtRequest: string;
  maxPriceAtRequest: string;
  discountAmount: string;
  reason: string;
  requestedBy: string;
}

/**
 * `price_approvals` — SALES owns this table (modules.md#sales, database.md#pricing). No hard delete,
 * no `deleted_at`: `status` governs the lifecycle (`pending` → `approved`/`rejected`/`cancelled`,
 * terminal). The only `UPDATE` this repository issues is the controlled `resolve` transition, always
 * guarded by `WHERE status = 'pending'` — a double-click / retried resolution affects 0 rows the
 * second time (database.md#concurrency-strategy). The partial unique index
 * `(tenant_id, order_item_id) WHERE status = 'pending'` (migration 0009) is the structural guard
 * against two open requests for the same line — the caller catches the 23505 and maps it to 409.
 */
@Injectable()
export class PriceApprovalsRepository {
  /** Next per-tenant sequential number ("APR-001"), same convention as return/order numbers. */
  async nextApprovalNumber(tx: TenantTransaction, tenantId: string): Promise<string> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sales.approval_number:${tenantId}`}))`);
    const [row] = await tx.select({ total: count() }).from(priceApprovals).where(eq(priceApprovals.tenantId, tenantId));
    return `APR-${String((row?.total ?? 0) + 1).padStart(3, '0')}`;
  }

  async create(tx: TenantTransaction, values: CreatePriceApprovalValues): Promise<PriceApprovalRow> {
    const [row] = await tx.insert(priceApprovals).values(values).returning();
    if (!row) {
      throw new Error('Price approval insert did not return a row.');
    }
    return row;
  }

  /** The single still-`pending` approval for a line, if any — the partial unique index
   * `(tenant_id, order_item_id) WHERE status = 'pending'` guarantees at most one. Read under the
   * `orders` row lock the request path already holds, so two concurrent requests for the same line
   * serialize and the second sees the first. */
  async findPendingByOrderItem(
    tx: TenantTransaction,
    tenantId: string,
    orderItemId: string,
  ): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .select()
      .from(priceApprovals)
      .where(
        and(
          eq(priceApprovals.tenantId, tenantId),
          eq(priceApprovals.orderItemId, orderItemId),
          eq(priceApprovals.status, 'pending'),
        ),
      );
    return row;
  }

  /** Cancels every still-`pending` approval attached to an order — used when the order itself is
   * cancelled (a pending exceptional-discount request has nothing left to authorize). */
  async cancelPendingByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<number> {
    const rows = await tx
      .update(priceApprovals)
      .set({ status: 'cancelled', resolvedAt: sql`now()` })
      .where(
        and(
          eq(priceApprovals.tenantId, tenantId),
          eq(priceApprovals.orderId, orderId),
          eq(priceApprovals.status, 'pending'),
        ),
      )
      .returning({ id: priceApprovals.id });
    return rows.length;
  }

  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .select()
      .from(priceApprovals)
      .where(and(eq(priceApprovals.tenantId, tenantId), eq(priceApprovals.id, id)));
    return row;
  }

  async lockById(tx: TenantTransaction, tenantId: string, id: string): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .select()
      .from(priceApprovals)
      .where(and(eq(priceApprovals.tenantId, tenantId), eq(priceApprovals.id, id)))
      .for('update');
    return row;
  }

  /** Every approval attached to one order, locked FOR UPDATE — the confirm gate reads this inside
   * the same transaction that already holds the `orders` row lock, so a concurrent
   * approve/reject on one of these rows serializes against confirmation. */
  async lockByOrder(tx: TenantTransaction, tenantId: string, orderId: string): Promise<PriceApprovalRow[]> {
    return tx
      .select()
      .from(priceApprovals)
      .where(and(eq(priceApprovals.tenantId, tenantId), eq(priceApprovals.orderId, orderId)))
      .for('update');
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: {
      page: number;
      pageSize: number;
      status?: string | undefined;
      orderId?: string | undefined;
      /** The parent order's location (Almacén) — `price_approvals` has no location of its own. */
      locationId?: string | undefined;
      locationIds?: string[] | undefined;
      /** Half-open business-day range on `requested_at`, already resolved to UTC instants. */
      dayRange?: { gte: Date; lt: Date } | undefined;
    },
  ): Promise<{ rows: PriceApprovalRow[]; total: number }> {
    const conditions: SQL[] = [eq(priceApprovals.tenantId, tenantId)];
    if (params.status) {
      conditions.push(eq(priceApprovals.status, params.status));
    }
    if (params.orderId) {
      conditions.push(eq(priceApprovals.orderId, params.orderId));
    }
    if (params.locationId) {
      // Semi-join, never a real join: no fan-out, one row per approval.
      conditions.push(
        sql`exists (select 1 from ${orders} where ${orders.tenantId} = ${priceApprovals.tenantId} and ${orders.id} = ${priceApprovals.orderId} and ${orders.locationId} = ${params.locationId})`,
      );
    }
    // Read scope of a restricted caller (ADR-0024/0035): only their assigned locations; none = nothing.
    if (params.locationIds) {
      conditions.push(
        params.locationIds.length > 0
          ? sql`exists (select 1 from ${orders} where ${orders.tenantId} = ${priceApprovals.tenantId} and ${orders.id} = ${priceApprovals.orderId} and ${inArray(orders.locationId, params.locationIds)})`
          : sql`false`,
      );
    }
    if (params.dayRange) {
      conditions.push(gte(priceApprovals.requestedAt, params.dayRange.gte));
      conditions.push(lt(priceApprovals.requestedAt, params.dayRange.lt));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(priceApprovals).where(where);
    // Newest-first — the owner's explicit call after trying the opposite: the queue should
    // surface the most recent activity first, not the oldest-filed request.
    const rows = await tx
      .select()
      .from(priceApprovals)
      .where(where)
      .orderBy(desc(priceApprovals.requestedAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);
    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Conditional resolution — only a still-`pending` row is transitioned. Returns `undefined` when
   * the row was already resolved (0 rows updated), which the caller maps to a 409.
   * `requestedPrice`/`discountAmount` are optional — owner redesign: an administrator approving
   * with an edited price passes the recomputed pair so this row stays in sync with the
   * `order_items` snapshot `OrdersService.confirm`'s gate compares it against. */
  async resolveIfPending(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { status: 'approved' | 'rejected'; approvedBy: string; requestedPrice?: string; discountAmount?: string },
  ): Promise<PriceApprovalRow | undefined> {
    const [row] = await tx
      .update(priceApprovals)
      .set({
        status: values.status,
        approvedBy: values.approvedBy,
        resolvedAt: sql`now()`,
        ...(values.requestedPrice !== undefined ? { requestedPrice: values.requestedPrice } : {}),
        ...(values.discountAmount !== undefined ? { discountAmount: values.discountAmount } : {}),
      })
      .where(
        and(
          eq(priceApprovals.tenantId, tenantId),
          eq(priceApprovals.id, id),
          eq(priceApprovals.status, 'pending'),
        ),
      )
      .returning();
    return row;
  }
}
