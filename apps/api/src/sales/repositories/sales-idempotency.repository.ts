import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { idempotencyKeys } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface IdempotencyKeyRow {
  id: string;
  tenantId: string;
  scope: string;
  idempotencyKey: string;
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * database.md#idempotency's general `idempotency_keys` table (`scope = 'orders.create'`) — the
 * mechanism the order-flow diagram (modules.md#order-flow-conceptual--sales-not-implemented-yet)
 * and api.md#idempotency both name for order creation. Same shape as
 * inventory/repositories/idempotency-keys.repository.ts (`scope = 'transfer.receive'`), kept as its
 * own SALES-owned class rather than reaching into another module's repository.
 *
 * The `UNIQUE (tenant_id, scope, idempotency_key)` constraint (migration 0011) is what makes two
 * *concurrent* requests with the same key safe: the second INSERT blocks on the first's
 * uncommitted row, then fails with 23505 once it commits — see `create`'s caller
 * (OrdersService.checkout), which converts that into "return the now-committed original result".
 */
@Injectable()
export class SalesIdempotencyRepository {
  async find(tx: TenantTransaction, tenantId: string, scope: string, idempotencyKey: string): Promise<IdempotencyKeyRow | undefined> {
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.tenantId, tenantId),
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.idempotencyKey, idempotencyKey),
        ),
      );
    return row;
  }

  async create(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      scope: string;
      idempotencyKey: string;
      requestHash: string;
      responseStatus: number;
      responseBody: unknown;
      expiresAt: Date;
    },
  ): Promise<IdempotencyKeyRow> {
    const [row] = await tx.insert(idempotencyKeys).values(values).returning();
    if (!row) {
      throw new Error('Idempotency key insert did not return a row.');
    }
    return row;
  }
}
