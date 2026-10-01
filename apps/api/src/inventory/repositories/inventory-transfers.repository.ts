import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, sql } from 'drizzle-orm';
import { inventoryTransfers } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface InventoryTransferRow {
  id: string;
  tenantId: string;
  code: string;
  sourceLocationId: string;
  destinationLocationId: string;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  dispatchedBy: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  approvedAt: Date | null;
  dispatchedAt: Date | null;
  receivedAt: Date | null;
  cancelledAt: Date | null;
}

export interface CreateTransferValues {
  id: string;
  tenantId: string;
  code: string;
  sourceLocationId: string;
  destinationLocationId: string;
  requestedBy: string;
  notes?: string | undefined;
}

export interface UpdateTransferValues {
  status?: string;
  approvedBy?: string | null;
  dispatchedBy?: string | null;
  approvedAt?: Date | null;
  dispatchedAt?: Date | null;
  receivedAt?: Date | null;
  cancelledAt?: Date | null;
}

/**
 * `inventory_transfers` — database.md#inventory-transfers-and-in-transit-stock, ADR-0020. State
 * transitions (approve/prepare/dispatch/receive/cancel) always go through `lockById` first — a
 * `SELECT ... FOR UPDATE` on the transfer header row itself, serializing two concurrent transition
 * attempts on the *same* transfer (double-dispatch, double-cancel-after-receive, etc.), independent
 * of and in addition to StockLedgerService's per-balance-row locking.
 */
@Injectable()
export class InventoryTransfersRepository {
  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<InventoryTransferRow | undefined> {
    const [row] = await tx.select().from(inventoryTransfers).where(and(eq(inventoryTransfers.tenantId, tenantId), eq(inventoryTransfers.id, id)));
    return row;
  }

  /** Row-locks the transfer header — call this, not findById, at the start of every state-transition
   * method, before reading `status` to decide whether the transition is legal. */
  async lockById(tx: TenantTransaction, tenantId: string, id: string): Promise<InventoryTransferRow | undefined> {
    const [row] = await tx
      .select()
      .from(inventoryTransfers)
      .where(and(eq(inventoryTransfers.tenantId, tenantId), eq(inventoryTransfers.id, id)))
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
      sourceLocationId?: string | undefined;
      destinationLocationId?: string | undefined;
    },
  ): Promise<{ rows: InventoryTransferRow[]; total: number }> {
    const conditions = [eq(inventoryTransfers.tenantId, tenantId)];
    if (params.status) {
      conditions.push(eq(inventoryTransfers.status, params.status));
    }
    if (params.sourceLocationId) {
      conditions.push(eq(inventoryTransfers.sourceLocationId, params.sourceLocationId));
    }
    if (params.destinationLocationId) {
      conditions.push(eq(inventoryTransfers.destinationLocationId, params.destinationLocationId));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(inventoryTransfers).where(where);
    const rows = await tx
      .select()
      .from(inventoryTransfers)
      .where(where)
      .orderBy(desc(inventoryTransfers.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Concurrency-safe, (tenant, source location)-scoped transfer numbering — same
   * `pg_advisory_xact_lock(hashtext(...))` + `count(*)` pattern as
   * `orders.repository.ts`'s `nextOrderNumber()`: the advisory lock serializes concurrent creates
   * from the same source location before the count, and transfers are never hard-deleted, so
   * `count(*) + 1` stays monotonic per location. Scoped narrower than orders (per source location,
   * not per tenant) per the spec's `CODIGO_SUCURSAL-CODIGO_ALMACEN-NNN` format — see migration
   * 0035's header for the backfill that seeded this same scope for pre-existing rows. */
  async nextTransferCode(
    tx: TenantTransaction,
    tenantId: string,
    sourceLocationId: string,
    warehouseCode: string,
    locationCode: string,
  ): Promise<string> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`inventory.transfer_code:${tenantId}:${sourceLocationId}`}))`);
    const [row] = await tx
      .select({ total: count() })
      .from(inventoryTransfers)
      .where(and(eq(inventoryTransfers.tenantId, tenantId), eq(inventoryTransfers.sourceLocationId, sourceLocationId)));
    const next = (row?.total ?? 0) + 1;
    return `${warehouseCode}-${locationCode}-${String(next).padStart(3, '0')}`;
  }

  async create(tx: TenantTransaction, values: CreateTransferValues): Promise<InventoryTransferRow> {
    const [row] = await tx
      .insert(inventoryTransfers)
      .values({
        id: values.id,
        tenantId: values.tenantId,
        code: values.code,
        sourceLocationId: values.sourceLocationId,
        destinationLocationId: values.destinationLocationId,
        requestedBy: values.requestedBy,
        notes: values.notes,
      })
      .returning();
    if (!row) {
      throw new Error('Transfer insert did not return a row.');
    }
    return row;
  }

  /** Caller must already hold the row lock (via lockById) before calling this. */
  async update(tx: TenantTransaction, tenantId: string, id: string, values: UpdateTransferValues): Promise<InventoryTransferRow | undefined> {
    const [row] = await tx
      .update(inventoryTransfers)
      .set(values)
      .where(and(eq(inventoryTransfers.tenantId, tenantId), eq(inventoryTransfers.id, id)))
      .returning();
    return row;
  }
}
