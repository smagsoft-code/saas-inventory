import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { ProductsRepository } from '../repositories/products.repository';
import { ProductImagesRepository, type ProductImageRow } from '../repositories/product-images.repository';
import type { ProductImageResponseDto } from './dto/product-image-response.dto';

/** The same 3-type set the `product_images_mime_type_check` DB constraint enforces (migration
 * 0031) — kept in sync by hand, the same convention every other DB-enum-mirroring constant in this
 * codebase already follows (e.g. `PRODUCT_CATALOG_STATUSES`). */
export const PRODUCT_IMAGE_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ProductImageMimeType = (typeof PRODUCT_IMAGE_ALLOWED_MIME_TYPES)[number];

/** A product photo, not a spreadsheet — deliberately far below `IMPORT_MAX_FILE_SIZE_BYTES` (25 MB). */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<ProductImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function toResponse(row: ProductImageRow): ProductImageResponseDto {
  return {
    id: row.id,
    productId: row.productId,
    ...(row.productVariantId ? { productVariantId: row.productVariantId } : {}),
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    url: `/api/v1/products/${row.productId}/images/${row.id}`,
  };
}

/**
 * OUI-006 — the first real wiring of `product_images` (schema-ready since Prompt 06, per
 * `ObjectStorageService`'s own header comment). One product can carry several images, ordered by
 * `position` (append-only here — no reorder endpoint yet, `GAP-IMAGE-REORDER`). Images live under
 * CATALOG (`modules.md` lists `product_images` as a CATALOG-owned table) and reuse the same
 * tenant-wide `ObjectStorageService` IMPORT already established (`common/storage/`, `@Global()` —
 * no new module dependency edge).
 */
@Injectable()
export class ProductImagesService {
  constructor(
    private readonly productImagesRepository: ProductImagesRepository,
    private readonly productsRepository: ProductsRepository,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  async list(tenantId: string, productId: string): Promise<ProductImageResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      await this.assertProductExists(tx, tenantId, productId);
      const rows = await this.productImagesRepository.listByProduct(tx, tenantId, productId);
      return rows.map(toResponse);
    });
  }

  async upload(
    tenantId: string,
    productId: string,
    file: { buffer: Buffer; mimeType: string },
    productVariantId?: string,
  ): Promise<ProductImageResponseDto> {
    if (file.buffer.length === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (file.buffer.length > PRODUCT_IMAGE_MAX_BYTES) {
      throw new BadRequestException(`The image exceeds the ${PRODUCT_IMAGE_MAX_BYTES / (1024 * 1024)} MB limit.`);
    }
    if (!(PRODUCT_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
      throw new BadRequestException(`Unsupported image type. Allowed: ${PRODUCT_IMAGE_ALLOWED_MIME_TYPES.join(', ')}.`);
    }
    const mimeType = file.mimeType as ProductImageMimeType;

    return withTenantTransaction(tenantId, async (tx) => {
      await this.assertProductExists(tx, tenantId, productId);
      if (productVariantId) {
        const variant = await this.productsRepository.findVariantById(tx, tenantId, productVariantId, {
          canViewFloor: true,
          canViewCost: true,
        });
        if (!variant || variant.productId !== productId) {
          throw new NotFoundException('Variant not found.');
        }
      }
      const existing = await this.productImagesRepository.listByProduct(tx, tenantId, productId);
      const storageKey = `products/${tenantId}/${productId}/${randomUUID()}.${EXTENSION_BY_MIME[mimeType]}`;
      await this.objectStorage.putObject(storageKey, file.buffer, mimeType);
      const row = await this.productImagesRepository.create(tx, {
        tenantId,
        productId,
        ...(productVariantId ? { productVariantId } : {}),
        storageKey,
        mimeType,
        position: existing.length,
      });
      return toResponse(row);
    });
  }

  async getImageBinary(
    tenantId: string,
    productId: string,
    imageId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const row = await withTenantTransaction(tenantId, async (tx) => {
      await this.assertProductExists(tx, tenantId, productId);
      const found = await this.productImagesRepository.findById(tx, tenantId, productId, imageId);
      if (!found) {
        throw new NotFoundException('Image not found.');
      }
      return found;
    });
    const buffer = await this.objectStorage.getObject(row.storageKey);
    return { buffer, mimeType: row.mimeType };
  }

  async delete(tenantId: string, productId: string, imageId: string): Promise<void> {
    const row = await withTenantTransaction(tenantId, async (tx) => {
      await this.assertProductExists(tx, tenantId, productId);
      const found = await this.productImagesRepository.findById(tx, tenantId, productId, imageId);
      if (!found) {
        throw new NotFoundException('Image not found.');
      }
      await this.productImagesRepository.delete(tx, tenantId, productId, imageId);
      return found;
    });
    // Best-effort: the DB row is already gone even if the object itself can't be removed (a rare,
    // non-fatal storage error never leaves a dangling, still-referenced row behind).
    await this.objectStorage.deleteObject(row.storageKey);
  }

  private async assertProductExists(tx: TenantTransaction, tenantId: string, productId: string): Promise<void> {
    const product = await this.productsRepository.findById(tx, tenantId, productId);
    if (!product) {
      throw new NotFoundException('Product not found.');
    }
  }
}
