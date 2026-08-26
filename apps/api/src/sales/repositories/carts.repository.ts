import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { carts } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface CartRow {
  id: string;
  tenantId: string;
  locationId: string;
  userId: string;
  customerId: string | null;
  orderId: string | null;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

/**
 * `carts` is owned by a user (database.md#cart: `user_id` = "the vendor operating this cart"). The
 * "one open cart per vendor" flow is enforced in the service via `findOpenByUser` +
 * a `pg_advisory_xact_lock` on (tenant, user) in the get-or-create path — the approved schema's
 * `carts_tenant_user_open_idx` is deliberately a plain (non-unique) lookup index, not changed here.
 * A cart is ephemeral pre-transactional data — hard-deletable, no `deleted_at`.
 */
@Injectable()
export class CartsRepository {
  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<CartRow | undefined> {
    const [row] = await tx.select().from(carts).where(and(eq(carts.tenantId, tenantId), eq(carts.id, id)));
    return row;
  }

  /** Locks the cart header row first — serializes concurrent mutations on the *same* cart
   * (double add-to-cart, an edit racing checkout), same posture as
   * inventory/transfers TransfersRepository.lockById. */
  async lockById(tx: TenantTransaction, tenantId: string, id: string): Promise<CartRow | undefined> {
    const [row] = await tx
      .select()
      .from(carts)
      .where(and(eq(carts.tenantId, tenantId), eq(carts.id, id)))
      .for('update');
    return row;
  }

  async findOpenByUser(tx: TenantTransaction, tenantId: string, userId: string): Promise<CartRow | undefined> {
    const [row] = await tx
      .select()
      .from(carts)
      .where(and(eq(carts.tenantId, tenantId), eq(carts.userId, userId), eq(carts.status, 'open')))
      .orderBy(desc(carts.createdAt));
    return row;
  }

  /** Transaction-scoped advisory lock keyed on (tenant, user) — makes get-or-create race-free
   * without adding a partial unique index to the approved schema. Released automatically at
   * COMMIT/ROLLBACK. */
  async acquireUserCartLock(tx: TenantTransaction, tenantId: string, userId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sales.cart:${tenantId}:${userId}`}))`);
  }

  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; locationId: string; userId: string; customerId?: string | null | undefined },
  ): Promise<CartRow> {
    const [row] = await tx.insert(carts).values(values).returning();
    if (!row) {
      throw new Error('Cart insert did not return a row.');
    }
    return row;
  }

  async update(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { locationId?: string; customerId?: string | null; status?: string; orderId?: string | null },
  ): Promise<CartRow | undefined> {
    const [row] = await tx
      .update(carts)
      .set({ ...values, version: sql`${carts.version} + 1` })
      .where(and(eq(carts.tenantId, tenantId), eq(carts.id, id)))
      .returning();
    return row;
  }
}
