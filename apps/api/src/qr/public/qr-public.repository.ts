import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PUBLIC_RESOLVER_DATABASE } from '../../database/database.module';
import type { PublicResolverDatabase } from '../../database/public-resolver-client';
import { locations, products, productVariants, qrCodes } from '../../database/schema';

export interface PublicQrCodeRow {
  targetType: string;
  targetId: string;
}

export interface PublicProductVariantRow {
  productId: string;
  maxPrice: string;
  status: string;
}

export interface PublicLocationRow {
  name: string;
  code: string;
  status: string;
}

/**
 * Reads through the `app_public_resolver` connection (public-resolver-client.ts) — never
 * `withTenantTransaction()`/`TenantTransaction` (there is no `app.tenant_id` to SET LOCAL on this
 * role's session; database.md#qr-codes is explicit this policy "doesn't check tenant at all, by
 * design"). Row/column access is bounded entirely by the `*_public_resolve` RLS policies and the
 * narrow column-level GRANTs already in place (migrations 0003/0004/0018) — this repository never
 * selects a column beyond what those GRANTs allow; doing so would fail at the database level
 * regardless, but the query lists are kept explicit here too, matching every other repository's
 * "never SELECT *" convention.
 */
@Injectable()
export class QrPublicRepository {
  constructor(@Inject(PUBLIC_RESOLVER_DATABASE) private readonly db: PublicResolverDatabase) {}

  /** The `qr_codes_public_resolve` RLS policy (migration 0004) already restricts visible rows to
   * `status = 'active' AND (expires_at IS NULL OR expires_at > now())` — a row simply doesn't exist
   * for this connection otherwise, so there is no separate active/expiry check to repeat here. */
  async findActiveByCode(code: string): Promise<PublicQrCodeRow | undefined> {
    const [row] = await this.db
      .select({ targetType: qrCodes.targetType, targetId: qrCodes.targetId })
      .from(qrCodes)
      .where(eq(qrCodes.code, code));
    return row;
  }

  async findProductVariant(productVariantId: string): Promise<PublicProductVariantRow | undefined> {
    const [row] = await this.db
      .select({ productId: productVariants.productId, maxPrice: productVariants.maxPrice, status: productVariants.status })
      .from(productVariants)
      .where(eq(productVariants.id, productVariantId));
    return row;
  }

  async findProductName(productId: string): Promise<string | undefined> {
    const [row] = await this.db.select({ name: products.name }).from(products).where(eq(products.id, productId));
    return row?.name;
  }

  async findLocation(locationId: string): Promise<PublicLocationRow | undefined> {
    const [row] = await this.db
      .select({ name: locations.name, code: locations.code, status: locations.status })
      .from(locations)
      .where(eq(locations.id, locationId));
    return row;
  }
}
