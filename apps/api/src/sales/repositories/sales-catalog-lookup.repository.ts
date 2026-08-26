import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { products, productVariants } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

/**
 * SALES --> CATALOG (modules.md's dependency edge: a sale line refers to a product variant). Reads
 * the shared `product_variants`/`products` tables directly rather than going through
 * CatalogModule's permission-gated ProductsRepository — same pattern
 * inventory/repositories/product-variants-lookup.repository.ts already uses.
 *
 * Deliberately fetches `min_price`/`cost` UNCONDITIONALLY: SALES must be able to *validate* a
 * negotiated price against the floor server-side even for a caller who may not *see* `min_price`
 * (ADR-0028, §23: "backend can validate value ≠ user may see value"). The response DTOs are what
 * hide `min_price`/`cost` from an unauthorized caller — never this read.
 */
export interface SalesVariantRow {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unit: string;
  maxPrice: string;
  basePrice: string;
  minPrice: string;
  cost: string | null;
  status: string;
  isSerialized: boolean;
  isLotTracked: boolean;
}

@Injectable()
export class SalesCatalogLookupRepository {
  async findVariantById(tx: TenantTransaction, tenantId: string, variantId: string): Promise<SalesVariantRow | undefined> {
    const [row] = await tx
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        productName: products.name,
        sku: productVariants.sku,
        unit: productVariants.unit,
        maxPrice: productVariants.maxPrice,
        basePrice: productVariants.basePrice,
        minPrice: productVariants.minPrice,
        cost: productVariants.cost,
        status: productVariants.status,
        isSerialized: productVariants.isSerialized,
        isLotTracked: productVariants.isLotTracked,
      })
      .from(productVariants)
      .innerJoin(
        products,
        and(eq(products.tenantId, productVariants.tenantId), eq(products.id, productVariants.productId), isNull(products.deletedAt)),
      )
      .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.id, variantId), isNull(productVariants.deletedAt)));
    return row;
  }
}
