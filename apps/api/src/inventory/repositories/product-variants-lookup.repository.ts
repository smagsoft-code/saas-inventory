import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { productVariants, products } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ProductVariantNameRow {
  id: string;
  sku: string;
  productName: string;
}

/**
 * INVENTORY --> CATALOG (modules.md's dependency edge: "a stock record refers to a product"). A
 * minimal existence check + display-name lookup only — never price fields (those are ADR-0028's
 * field-level-authorized territory, catalog/repositories/products.repository.ts's own concern, not
 * inventory's). Reads the shared `product_variants`/`products` tables directly rather than
 * importing CatalogModule's ProductsRepository, mirroring how catalog/repositories/*.ts themselves
 * read schema tables directly rather than going through another module's repository class.
 */
@Injectable()
export class ProductVariantsLookupRepository {
  async exists(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.id, productVariantId), isNull(productVariants.deletedAt)));
    return row !== undefined;
  }

  /** Batch id -> {sku, productName} for display purposes (e.g. a transfer's line items,
   * `GAP-VARIANT-LIST`/`GAP-NAME-ENRICHMENT`'s narrow resolution). Deliberately NOT filtered by
   * `deletedAt` — a transfer created against a variant that was later deactivated/soft-deleted must
   * still show its historical name, the same "history is never rewritten" posture as movements. */
  async findByIds(tx: TenantTransaction, tenantId: string, ids: string[]): Promise<ProductVariantNameRow[]> {
    if (ids.length === 0) {
      return [];
    }
    return tx
      .select({ id: productVariants.id, sku: productVariants.sku, productName: products.name })
      .from(productVariants)
      .innerJoin(products, and(eq(products.tenantId, productVariants.tenantId), eq(products.id, productVariants.productId)))
      .where(and(eq(productVariants.tenantId, tenantId), inArray(productVariants.id, ids)));
  }
}
