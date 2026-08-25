import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { productVariants } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

/**
 * INVENTORY --> CATALOG (modules.md's dependency edge: "a stock record refers to a product"). A
 * minimal existence check only — never price fields (those are ADR-0028's field-level-authorized
 * territory, catalog/repositories/products.repository.ts's own concern, not inventory's). Reads the
 * shared `product_variants` table directly rather than importing CatalogModule's ProductsRepository,
 * mirroring how catalog/repositories/*.ts themselves read schema tables directly rather than going
 * through another module's repository class.
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
}
