import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { productVariants, products } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface BulkReceiptVariantRow {
  variantId: string;
  sku: string;
  productName: string;
  variantStatus: string;
  productStatus: string;
  isSerialized: boolean;
  isLotTracked: boolean;
}

export interface BulkReceiptCatalogRow {
  sku: string;
  productName: string;
  /** Catalog reference cost (`product_variants.cost`); only fetched when the caller may see costs. */
  cost?: string | null;
}

/** Read-only lookup of the variants a bulk stock load refers to, by the code (SKU) typed in the
 * file — one batched query for the whole file, tenant-scoped. Same cross-module read as
 * `ProductVariantsLookupRepository` (INVENTORY reads CATALOG tables for existence/display only). */
@Injectable()
export class BulkReceiptsLookupRepository {
  /** Every active, non-deleted variant (code + product name) for the template's "Productos" sheet.
   * `cost` is selected only when `canViewCost` (ADR-0028: never fetched for a caller without it). */
  async listActive(tx: TenantTransaction, tenantId: string, canViewCost: boolean): Promise<BulkReceiptCatalogRow[]> {
    return tx
      .select({
        sku: productVariants.sku,
        productName: products.name,
        ...(canViewCost ? { cost: productVariants.cost } : {}),
      })
      .from(productVariants)
      .innerJoin(products, and(eq(products.tenantId, productVariants.tenantId), eq(products.id, productVariants.productId)))
      .where(
        and(
          eq(productVariants.tenantId, tenantId),
          isNull(productVariants.deletedAt),
          isNull(products.deletedAt),
          eq(productVariants.status, 'active'),
          eq(products.status, 'active'),
        ),
      )
      .orderBy(asc(products.name), asc(productVariants.sku));
  }

  /** `codes` are matched case-insensitively against `product_variants.sku`; the map is keyed by the
   * lower-cased code. */
  async findByCodes(tx: TenantTransaction, tenantId: string, codes: string[]): Promise<Map<string, BulkReceiptVariantRow>> {
    const lowered = [...new Set(codes.map((code) => code.toLowerCase()))];
    if (lowered.length === 0) return new Map();
    const rows = await tx
      .select({
        variantId: productVariants.id,
        sku: productVariants.sku,
        productName: products.name,
        variantStatus: productVariants.status,
        productStatus: products.status,
        isSerialized: productVariants.isSerialized,
        isLotTracked: productVariants.isLotTracked,
      })
      .from(productVariants)
      .innerJoin(products, and(eq(products.tenantId, productVariants.tenantId), eq(products.id, productVariants.productId)))
      .where(
        and(
          eq(productVariants.tenantId, tenantId),
          isNull(productVariants.deletedAt),
          isNull(products.deletedAt),
          inArray(sql<string>`lower(${productVariants.sku})`, lowered),
        ),
      );
    return new Map(rows.map((row) => [row.sku.toLowerCase(), row]));
  }
}
