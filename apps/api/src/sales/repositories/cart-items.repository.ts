import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { cartItems } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface CartItemRow {
  id: string;
  tenantId: string;
  cartId: string;
  productVariantId: string;
  quantity: string;
  negotiatedUnitPrice: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `cart_items` — one row per variant per cart (UNIQUE (tenant_id, cart_id, product_variant_id),
 * database.md#cart). "Add this variant again" resolves to one row with an updated quantity via the
 * upsert below, never two rows.
 */
@Injectable()
export class CartItemsRepository {
  async listByCart(tx: TenantTransaction, tenantId: string, cartId: string): Promise<CartItemRow[]> {
    return tx
      .select()
      .from(cartItems)
      .where(and(eq(cartItems.tenantId, tenantId), eq(cartItems.cartId, cartId)))
      .orderBy(cartItems.createdAt);
  }

  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<CartItemRow | undefined> {
    const [row] = await tx.select().from(cartItems).where(and(eq(cartItems.tenantId, tenantId), eq(cartItems.id, id)));
    return row;
  }

  /** database.md#cart's documented upsert: adding the same variant again increments quantity on the
   * single existing row rather than creating a duplicate. `negotiatedUnitPrice` is overwritten only
   * when the caller supplies one (a fresh negotiation), left as-is otherwise. */
  async upsert(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; cartId: string; productVariantId: string; quantityDelta: number; negotiatedUnitPrice: number | null | undefined },
  ): Promise<CartItemRow> {
    const [row] = await tx
      .insert(cartItems)
      .values({
        id: values.id,
        tenantId: values.tenantId,
        cartId: values.cartId,
        productVariantId: values.productVariantId,
        quantity: String(values.quantityDelta),
        negotiatedUnitPrice: values.negotiatedUnitPrice === undefined || values.negotiatedUnitPrice === null ? null : String(values.negotiatedUnitPrice),
      })
      .onConflictDoUpdate({
        target: [cartItems.tenantId, cartItems.cartId, cartItems.productVariantId],
        set: {
          quantity: sql`${cartItems.quantity} + ${String(values.quantityDelta)}`,
          ...(values.negotiatedUnitPrice === undefined
            ? {}
            : { negotiatedUnitPrice: values.negotiatedUnitPrice === null ? null : String(values.negotiatedUnitPrice) }),
          updatedAt: sql`now()`,
        },
      })
      .returning();
    if (!row) {
      throw new Error('Cart item upsert did not return a row.');
    }
    return row;
  }

  async update(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: { quantity?: number; negotiatedUnitPrice?: number | null },
  ): Promise<CartItemRow | undefined> {
    const set: Record<string, unknown> = { updatedAt: sql`now()` };
    if (values.quantity !== undefined) {
      set['quantity'] = String(values.quantity);
    }
    if (values.negotiatedUnitPrice !== undefined) {
      set['negotiatedUnitPrice'] = values.negotiatedUnitPrice === null ? null : String(values.negotiatedUnitPrice);
    }
    const [row] = await tx
      .update(cartItems)
      .set(set)
      .where(and(eq(cartItems.tenantId, tenantId), eq(cartItems.id, id)))
      .returning();
    return row;
  }

  async delete(tx: TenantTransaction, tenantId: string, id: string): Promise<boolean> {
    const rows = await tx
      .delete(cartItems)
      .where(and(eq(cartItems.tenantId, tenantId), eq(cartItems.id, id)))
      .returning({ id: cartItems.id });
    return rows.length > 0;
  }
}
