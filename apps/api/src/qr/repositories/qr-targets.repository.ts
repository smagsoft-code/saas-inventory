import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { locations, productVariants } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface QrProductVariantTarget {
  id: string;
  productId: string;
  status: string;
}

export interface QrLocationTarget {
  id: string;
  status: string;
}

/**
 * QR --> CATALOG / QR --> INVENTORY (modules.md's declared dependency edges: "QR depends on CATALOG
 * (product QR), INVENTORY (location QR)"). A minimal existence + identity check only — never price
 * fields, mirroring inventory/repositories/product-variants-lookup.repository.ts's exact precedent
 * ("reads the shared product_variants table directly rather than importing CatalogModule's
 * ProductsRepository, mirroring how catalog/repositories/*.ts themselves read schema tables directly
 * rather than going through another module's repository class"). Applied here to a second module
 * boundary (QR) the same way that file applies it to INVENTORY's — not a new convention.
 *
 * Deliberately returns only `productId`/`status` (product_variant) or `status` (location) — exactly
 * what QrCodesService needs to (a) validate the target exists in the caller's own tenant before
 * minting a QR row and (b) let the authenticated resolve endpoint hand the client a productId to
 * call the real, ADR-0028-governed CATALOG endpoint with. Never `min_price`/`cost`/`sku`/any other
 * field — reusing those would mean duplicating ADR-0028's field-level authorization here, which
 * CLAUDE.md and this prompt both explicitly rule out. The authenticated client always goes back to
 * `GET /products/:id/variants/:variantId` for anything price-related.
 */
@Injectable()
export class QrTargetsRepository {
  async findProductVariant(tx: TenantTransaction, tenantId: string, productVariantId: string): Promise<QrProductVariantTarget | undefined> {
    const [row] = await tx
      .select({ id: productVariants.id, productId: productVariants.productId, status: productVariants.status })
      .from(productVariants)
      .where(and(eq(productVariants.tenantId, tenantId), eq(productVariants.id, productVariantId), isNull(productVariants.deletedAt)));
    return row;
  }

  async findLocation(tx: TenantTransaction, tenantId: string, locationId: string): Promise<QrLocationTarget | undefined> {
    const [row] = await tx
      .select({ id: locations.id, status: locations.status })
      .from(locations)
      .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), isNull(locations.deletedAt)));
    return row;
  }
}
