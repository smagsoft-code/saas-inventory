import { Injectable } from '@nestjs/common';
import { and, count, eq, exists, ilike, isNull, or, sql } from 'drizzle-orm';
import { brands, productPriceHistory, products, productVariants, suppliers } from '../../database/schema';
import { upperName } from '../upper-name';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ProductRow {
  id: string;
  tenantId: string;
  categoryId: string | null;
  brandId: string | null;
  supplierId: string | null;
  name: string;
  description: string | null;
  status: string;
  warrantyMonths: number | null;
  attributes: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** cost/minPrice are only present when the caller's permission set allows them (ADR-0028) — the
 * repository never fetches a column it isn't allowed to return, so a bug further up the stack
 * cannot leak it. Absent, never null/masked, when unauthorized. */
export interface VariantRow {
  id: string;
  tenantId: string;
  productId: string;
  sku: string;
  barcode: string | null;
  unit: string;
  maxPrice: string;
  basePrice: string;
  minPrice?: string;
  cost?: string | null;
  status: string;
  isSerialized: boolean;
  isLotTracked: boolean;
  attributes: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface VariantVisibility {
  canViewFloor: boolean;
  canViewCost: boolean;
}

const BASE_VARIANT_COLUMNS = {
  id: productVariants.id,
  tenantId: productVariants.tenantId,
  productId: productVariants.productId,
  sku: productVariants.sku,
  barcode: productVariants.barcode,
  unit: productVariants.unit,
  maxPrice: productVariants.maxPrice,
  basePrice: productVariants.basePrice,
  status: productVariants.status,
  isSerialized: productVariants.isSerialized,
  isLotTracked: productVariants.isLotTracked,
  attributes: productVariants.attributes,
  createdAt: productVariants.createdAt,
  updatedAt: productVariants.updatedAt,
};

/**
 * Tenant-scoped, RLS-backed reads/writes on `products`/`product_variants`/`product_price_history` —
 * same per-transaction convention as every other repository in this codebase. Variant reads accept
 * a VariantVisibility flag set (ADR-0028's field-level price authorization) and build the SELECT
 * list conditionally — a caller lacking `pricing.floor.view`/`pricing.cost.view` never causes
 * `min_price`/`cost` to be fetched at all.
 */
@Injectable()
export class ProductsRepository {
  async findById(tx: TenantTransaction, tenantId: string, productId: string): Promise<ProductRow | undefined> {
    const [row] = await tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)));
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; status?: string | undefined; categoryId?: string | undefined; q?: string | undefined },
  ): Promise<{ rows: ProductRow[]; total: number }> {
    const conditions = [eq(products.tenantId, tenantId), isNull(products.deletedAt)];
    if (params.status) {
      conditions.push(eq(products.status, params.status));
    }
    if (params.categoryId) {
      conditions.push(eq(products.categoryId, params.categoryId));
    }
    if (params.q) {
      const pattern = `%${params.q}%`;
      // Matches the product's own name, or any of its variants' SKU/barcode — the Kardex product
      // search (UI-UX-SPEC-001 §2) needs to find "the thing with this code" as readily as "the thing
      // with this name", and there is no separate global SKU-search endpoint to reuse instead.
      conditions.push(
        or(
          ilike(products.name, pattern),
          exists(
            tx
              .select({ one: productVariants.id })
              .from(productVariants)
              .where(and(eq(productVariants.tenantId, products.tenantId), eq(productVariants.productId, products.id), or(ilike(productVariants.sku, pattern), ilike(productVariants.barcode, pattern)))),
          ),
        )!,
      );
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(products).where(where);

    const rows = await tx
      .select()
      .from(products)
      .where(where)
      .orderBy(products.createdAt)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  async create(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      categoryId?: string | null | undefined;
      brandId?: string | null | undefined;
      supplierId?: string | null | undefined;
      name: string;
      description?: string | undefined;
      status?: string | undefined;
      warrantyMonths?: number | undefined;
      attributes: Record<string, unknown>;
    },
  ): Promise<ProductRow> {
    const [row] = await tx
      .insert(products)
      .values({ ...values, name: upperName(values.name) })
      .returning();
    if (!row) {
      throw new Error('Product insert did not return a row.');
    }
    return row;
  }

  async update(
    tx: TenantTransaction,
    tenantId: string,
    productId: string,
    values: {
      categoryId?: string | null;
      brandId?: string | null;
      supplierId?: string | null;
      name?: string;
      description?: string | null;
      status?: string;
      warrantyMonths?: number | null;
      attributes?: Record<string, unknown>;
    },
  ): Promise<ProductRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, productId);
    }
    const [row] = await tx
      .update(products)
      .set(values.name !== undefined ? { ...values, name: upperName(values.name) } : values)
      .where(and(eq(products.tenantId, tenantId), eq(products.id, productId), isNull(products.deletedAt)))
      .returning();
    return row;
  }

  async findVariantById(
    tx: TenantTransaction,
    tenantId: string,
    variantId: string,
    visibility: VariantVisibility,
  ): Promise<VariantRow | undefined> {
    const columns = this.selectColumns(visibility);
    const [row] = await tx
      .select(columns)
      .from(productVariants)
      .where(
        and(
          eq(productVariants.tenantId, tenantId),
          eq(productVariants.id, variantId),
          isNull(productVariants.deletedAt),
        ),
      );
    return row;
  }

  async listVariantsByProduct(
    tx: TenantTransaction,
    tenantId: string,
    productId: string,
    visibility: VariantVisibility,
  ): Promise<VariantRow[]> {
    const columns = this.selectColumns(visibility);
    return tx
      .select(columns)
      .from(productVariants)
      .where(
        and(
          eq(productVariants.tenantId, tenantId),
          eq(productVariants.productId, productId),
          isNull(productVariants.deletedAt),
        ),
      )
      .orderBy(productVariants.createdAt);
  }

  /**
   * The next free automatic product code (variant SKU) for a prefix: `ARM-001`, `ARM-002`, … The
   * prefix is the first three letters of the product's category, so several categories can share it
   * (`ARMARIO CON MALETERO`, `ARMARIO SIN MALETERO` → `ARM`); the **sequence is evaluated across the
   * whole tenant for that prefix** — every category and every variant with that prefix — so a number is
   * never repeated. Three digits is a minimum, never a cap (`ARM-1000` follows `ARM-999`). One more
   * than the highest `<PREFIX>-<number>` the tenant already has — counting every variant, so a code is
   * never reused — under a transaction-scoped advisory lock (per tenant + prefix) so two concurrent
   * creates cannot be handed the same one. A code the user typed in another shape is ignored.
   * `prefix` must be letters only (see `skuPrefixFromCategoryName`).
   */
  async nextSku(tx: TenantTransaction, tenantId: string, prefix: string): Promise<string> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`catalog.product_sku:${tenantId}:${prefix}`}))`);
    const pattern = `(?i)^${prefix}-([0-9]+)$`;
    const rows = await tx.execute<{ max: string | null }>(
      sql`select max(substring(sku from ${pattern})::bigint)::text as max from product_variants where tenant_id = ${tenantId}`,
    );
    const next = Number(rows[0]?.max ?? 0) + 1;
    return `${prefix}-${String(next).padStart(3, '0')}`;
  }

  async createVariant(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      productId: string;
      sku: string;
      barcode?: string | undefined;
      unit?: string | undefined;
      maxPrice: string;
      basePrice: string;
      minPrice: string;
      cost?: string | undefined;
      status?: string | undefined;
      isSerialized?: boolean | undefined;
      isLotTracked?: boolean | undefined;
      attributes: Record<string, unknown>;
    },
  ): Promise<VariantRow> {
    const [row] = await tx.insert(productVariants).values(values).returning();
    if (!row) {
      throw new Error('Product variant insert did not return a row.');
    }
    return row;
  }

  async updateVariant(
    tx: TenantTransaction,
    tenantId: string,
    variantId: string,
    values: {
      barcode?: string | null;
      unit?: string;
      maxPrice?: string;
      basePrice?: string;
      minPrice?: string;
      cost?: string | null;
      status?: string;
      attributes?: Record<string, unknown>;
    },
  ): Promise<VariantRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findVariantById(tx, tenantId, variantId, { canViewFloor: true, canViewCost: true });
    }
    const [row] = await tx
      .update(productVariants)
      .set(values)
      .where(
        and(
          eq(productVariants.tenantId, tenantId),
          eq(productVariants.id, variantId),
          isNull(productVariants.deletedAt),
        ),
      )
      .returning();
    return row;
  }

  /** database.md#pricing: "every time they change, application code closes the previous
   * product_price_history row (effective_to = now()) and inserts a new one" — the ledger mirrors
   * inventory's balance/movement split, applied to pricing. Called only when a price field actually
   * changes (the service layer decides that), never unconditionally on every update. */
  async recordPriceChange(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      productVariantId: string;
      maxPrice: string;
      basePrice: string;
      minPrice: string;
      changedBy: string;
    },
  ): Promise<void> {
    await tx
      .update(productPriceHistory)
      .set({ effectiveTo: new Date() })
      .where(
        and(
          eq(productPriceHistory.tenantId, values.tenantId),
          eq(productPriceHistory.productVariantId, values.productVariantId),
          isNull(productPriceHistory.effectiveTo),
        ),
      );
    await tx.insert(productPriceHistory).values({
      id: values.id,
      tenantId: values.tenantId,
      productVariantId: values.productVariantId,
      maxPrice: values.maxPrice,
      basePrice: values.basePrice,
      minPrice: values.minPrice,
      changedBy: values.changedBy,
    });
  }

  /** No brand/supplier CRUD in this phase (Prompt 06's explicit scope) — these two existence
   * checks are the minimal surface products.repository needs to validate a client-supplied
   * brandId/supplierId belongs to the current tenant before insert, so a foreign/nonexistent id
   * fails as a clean 404 rather than a raw FK-violation 500. */
  async brandExists(tx: TenantTransaction, tenantId: string, brandId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.tenantId, tenantId), eq(brands.id, brandId), isNull(brands.deletedAt)));
    return row !== undefined;
  }

  async supplierExists(tx: TenantTransaction, tenantId: string, supplierId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, supplierId), isNull(suppliers.deletedAt)));
    return row !== undefined;
  }

  private selectColumns(visibility: VariantVisibility) {
    return {
      ...BASE_VARIANT_COLUMNS,
      ...(visibility.canViewFloor ? { minPrice: productVariants.minPrice } : {}),
      ...(visibility.canViewCost ? { cost: productVariants.cost } : {}),
    };
  }
}
