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
 * database.md#idempotency's general `idempotency_keys` table — "genuinely repeatable user actions"
 * (transfer receiving, `scope = 'transfer.receive'`, is the one FASE 8 consumer). Never used for
 * dispatch (that uses a deterministic key directly on `inventory_movements.idempotency_key` instead
 * — see StockLedgerService/TransfersService.dispatch).
 */
@Injectable()
export class IdempotencyKeysRepository {
  async find(tx: TenantTransaction, tenantId: string, scope: string, idempotencyKey: string): Promise<IdempotencyKeyRow | undefined> {
    const [row] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.tenantId, tenantId), eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.idempotencyKey, idempotencyKey)));
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
