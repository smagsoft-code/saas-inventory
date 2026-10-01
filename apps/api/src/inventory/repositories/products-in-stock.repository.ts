import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { inventoryBalances, locations, productVariants, products } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ProductInStockRow {
  id: string;
  name: string;
}

const RESULT_LIMIT = 200;

/**
 * INVENTORY --> CATALOG (same direction as `ProductVariantsLookupRepository` — a stock record
 * refers to a product, never the other way around; CATALOG has no edge back into INVENTORY per
 * modules.md, so this deliberately does NOT live under catalog/products/). Reads
 * `inventory_balances`/`product_variants`/`products` directly rather than importing another
 * module's repository, the same convention `product-variants-lookup.repository.ts` documents.
 *
 * Backs "Producto" on the New Transfer form (F17-TRANSFERS-AUDIT): only products with at least one
 * active, undeleted variant carrying `quantity_available > 0` at the given (already-authorized)
 * location — never the tenant's full catalog. Deliberately not paginated (a bounded, capped list
 * like `buildLocationIndex()`'s `pageSize: 100` convention elsewhere) — a single location realistically
 * never has hundreds of distinct in-stock products; `RESULT_LIMIT` is a safety cap, not a page size.
 */
@Injectable()
export class ProductsInStockRepository {
  async listByLocation(tx: TenantTransaction, tenantId: string, locationId: string): Promise<ProductInStockRow[]> {
    return tx
      .selectDistinct({ id: products.id, name: products.name })
      .from(inventoryBalances)
      .innerJoin(
        productVariants,
        and(eq(productVariants.tenantId, inventoryBalances.tenantId), eq(productVariants.id, inventoryBalances.productVariantId)),
      )
      .innerJoin(products, and(eq(products.tenantId, productVariants.tenantId), eq(products.id, productVariants.productId)))
      .innerJoin(locations, and(eq(locations.tenantId, inventoryBalances.tenantId), eq(locations.id, inventoryBalances.locationId)))
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.locationId, locationId),
          gt(inventoryBalances.quantityAvailable, sql`0`),
          isNull(productVariants.deletedAt),
          eq(products.status, 'active'),
          isNull(products.deletedAt),
          eq(locations.status, 'active'),
        ),
      )
      .orderBy(products.name)
      .limit(RESULT_LIMIT);
  }
}
