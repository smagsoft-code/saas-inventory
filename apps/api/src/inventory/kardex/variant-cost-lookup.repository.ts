import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { productVariants } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

/**
 * Reads only `product_variants.cost` — the moving-average engine's last-resort fallback for an
 * inbound movement with no per-movement `unitCost` (legacy pre-migration rows, see
 * kardex-costing.ts). This is an internal costing input, not a response field, so it does not go
 * through ADR-0028's field-level authorization (that gate is about whether an API response may
 * expose cost to a given caller, not about the ledger's own arithmetic). Reads the schema table
 * directly rather than importing catalog's ProductsRepository, the same direct-read convention
 * `product-variants-lookup.repository.ts` documents for this module.
 */
@Injectable()
export class VariantCostLookupRepository {
  async getCost(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<number | null> {
    const [row] = await tx
      .select({ cost: productVariants.cost })
      .from(productVariants)
      .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.id, productVariantId)));
    return row?.cost !== null && row?.cost !== undefined ? Number(row.cost) : null;
  }
}
