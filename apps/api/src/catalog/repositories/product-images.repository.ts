import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { productImages } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface ProductImageRow {
  id: string;
  tenantId: string;
  productId: string;
  productVariantId: string | null;
  storageKey: string;
  mimeType: string;
  position: number;
  createdAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `product_images` (OUI-006 — the first real wiring of
 * this table; it existed schema-only since Prompt 06, see `ObjectStorageService`'s own header
 * comment). Never the actual image bytes — `storageKey` is an opaque pointer into
 * `ObjectStorageService`'s bucket, resolved by the service layer only when actually streaming an
 * image back (`GET /products/:id/images/:imageId`), never returned in a list/JSON response.
 */
@Injectable()
export class ProductImagesRepository {
  async listByProduct(tx: TenantTransaction, tenantId: string, productId: string): Promise<ProductImageRow[]> {
    return tx
      .select()
      .from(productImages)
      .where(and(eq(productImages.tenantId, tenantId), eq(productImages.productId, productId)))
      .orderBy(asc(productImages.position), asc(productImages.createdAt));
  }

  async findById(
    tx: TenantTransaction,
    tenantId: string,
    productId: string,
    imageId: string,
  ): Promise<ProductImageRow | undefined> {
    const [row] = await tx
      .select()
      .from(productImages)
      .where(
        and(
          eq(productImages.tenantId, tenantId),
          eq(productImages.productId, productId),
          eq(productImages.id, imageId),
        ),
      );
    return row;
  }

  async create(
    tx: TenantTransaction,
    values: {
      tenantId: string;
      productId: string;
      productVariantId?: string | undefined;
      storageKey: string;
      mimeType: string;
      position: number;
    },
  ): Promise<ProductImageRow> {
    const [row] = await tx.insert(productImages).values(values).returning();
    if (!row) {
      throw new Error('product_images insert did not return a row.');
    }
    return row;
  }

  async delete(tx: TenantTransaction, tenantId: string, productId: string, imageId: string): Promise<void> {
    await tx
      .delete(productImages)
      .where(
        and(
          eq(productImages.tenantId, tenantId),
          eq(productImages.productId, productId),
          eq(productImages.id, imageId),
        ),
      );
  }
}
