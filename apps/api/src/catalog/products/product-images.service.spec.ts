import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ProductImagesService, PRODUCT_IMAGE_MAX_BYTES } from './product-images.service';
import type { ProductImageRow } from '../repositories/product-images.repository';
import type { ProductRow } from '../repositories/products.repository';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function product(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: 'p1',
    tenantId: 't1',
    categoryId: null,
    brandId: null,
    supplierId: null,
    name: 'Widget',
    description: null,
    status: 'active',
    warrantyMonths: null,
    attributes: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function imageRow(overrides: Partial<ProductImageRow> = {}): ProductImageRow {
  return {
    id: 'img-1',
    tenantId: 't1',
    productId: 'p1',
    productVariantId: null,
    storageKey: 'products/t1/p1/img-1.jpg',
    mimeType: 'image/jpeg',
    position: 0,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildService() {
  const productImagesRepository = {
    listByProduct: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(undefined),
    create: vi.fn(),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const productsRepository = {
    findById: vi.fn().mockResolvedValue(product()),
    findVariantById: vi.fn().mockResolvedValue(undefined),
  };
  const objectStorage = {
    putObject: vi.fn().mockResolvedValue(undefined),
    getObject: vi.fn(),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ProductImagesService(
    productImagesRepository as never,
    productsRepository as never,
    objectStorage as never,
  );
  return { service, productImagesRepository, productsRepository, objectStorage };
}

describe('ProductImagesService', () => {
  describe('list', () => {
    it('404s when the product does not exist', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.findById.mockResolvedValue(undefined);
      await expect(service.list('t1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps every row to a response with a same-origin url, never the storageKey', async () => {
      const { service, productImagesRepository } = buildService();
      productImagesRepository.listByProduct.mockResolvedValue([imageRow()]);
      const result = await service.list('t1', 'p1');
      expect(result).toEqual([
        {
          id: 'img-1',
          productId: 'p1',
          position: 0,
          createdAt: '2026-09-01T00:00:00.000Z',
          url: '/api/v1/products/p1/images/img-1',
        },
      ]);
      expect(JSON.stringify(result)).not.toMatch(/storageKey|storage_key/i);
    });
  });

  describe('upload', () => {
    it('rejects an empty file', async () => {
      const { service } = buildService();
      await expect(service.upload('t1', 'p1', { buffer: Buffer.alloc(0), mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a file over the size limit', async () => {
      const { service } = buildService();
      const buffer = Buffer.alloc(PRODUCT_IMAGE_MAX_BYTES + 1);
      await expect(service.upload('t1', 'p1', { buffer, mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an unsupported mime type', async () => {
      const { service } = buildService();
      await expect(
        service.upload('t1', 'p1', { buffer: Buffer.from('x'), mimeType: 'application/pdf' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('404s when the product does not exist', async () => {
      const { service, productsRepository } = buildService();
      productsRepository.findById.mockResolvedValue(undefined);
      await expect(
        service.upload('t1', 'missing', { buffer: Buffer.from('x'), mimeType: 'image/jpeg' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('writes to object storage before inserting the row, and appends at the next position', async () => {
      const { service, productImagesRepository, objectStorage } = buildService();
      productImagesRepository.listByProduct.mockResolvedValue([imageRow(), imageRow({ id: 'img-2' })]);
      productImagesRepository.create.mockResolvedValue(imageRow({ id: 'img-3', position: 2 }));

      const result = await service.upload('t1', 'p1', { buffer: Buffer.from('bytes'), mimeType: 'image/png' });

      expect(objectStorage.putObject).toHaveBeenCalledTimes(1);
      const [storageKey, buffer, mimeType] = objectStorage.putObject.mock.calls[0]!;
      expect(storageKey).toMatch(/^products\/t1\/p1\/.+\.png$/);
      expect(buffer).toEqual(Buffer.from('bytes'));
      expect(mimeType).toBe('image/png');

      expect(productImagesRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: 't1', productId: 'p1', position: 2, mimeType: 'image/png' }),
      );
      expect(result.id).toBe('img-3');
      expect(result.url).toBe('/api/v1/products/p1/images/img-3');
    });

    it('scopes the image to a variant when productVariantId is given and belongs to the product', async () => {
      const { service, productImagesRepository, productsRepository } = buildService();
      productsRepository.findVariantById.mockResolvedValue({ id: 'v1', productId: 'p1' });
      productImagesRepository.create.mockResolvedValue(imageRow({ productVariantId: 'v1' }));

      await service.upload('t1', 'p1', { buffer: Buffer.from('bytes'), mimeType: 'image/png' }, 'v1');

      expect(productImagesRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ productVariantId: 'v1' }),
      );
    });

    it('404s when productVariantId does not belong to this product (or does not exist)', async () => {
      const { service, productsRepository, objectStorage } = buildService();
      productsRepository.findVariantById.mockResolvedValue({ id: 'v9', productId: 'some-other-product' });

      await expect(
        service.upload('t1', 'p1', { buffer: Buffer.from('bytes'), mimeType: 'image/png' }, 'v9'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(objectStorage.putObject).not.toHaveBeenCalled();
    });
  });

  describe('getImageBinary', () => {
    it('404s when the image does not exist', async () => {
      const { service, productImagesRepository } = buildService();
      productImagesRepository.findById.mockResolvedValue(undefined);
      await expect(service.getImageBinary('t1', 'p1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('resolves the storage key and returns the buffer + mime type', async () => {
      const { service, productImagesRepository, objectStorage } = buildService();
      productImagesRepository.findById.mockResolvedValue(imageRow());
      objectStorage.getObject.mockResolvedValue(Buffer.from('bytes'));

      const result = await service.getImageBinary('t1', 'p1', 'img-1');
      expect(objectStorage.getObject).toHaveBeenCalledWith('products/t1/p1/img-1.jpg');
      expect(result).toEqual({ buffer: Buffer.from('bytes'), mimeType: 'image/jpeg' });
    });
  });

  describe('delete', () => {
    it('404s when the image does not exist, and never touches object storage', async () => {
      const { service, productImagesRepository, objectStorage } = buildService();
      productImagesRepository.findById.mockResolvedValue(undefined);
      await expect(service.delete('t1', 'p1', 'missing')).rejects.toBeInstanceOf(NotFoundException);
      expect(objectStorage.deleteObject).not.toHaveBeenCalled();
    });

    it('deletes the row then the object', async () => {
      const { service, productImagesRepository, objectStorage } = buildService();
      productImagesRepository.findById.mockResolvedValue(imageRow());
      await service.delete('t1', 'p1', 'img-1');
      expect(productImagesRepository.delete).toHaveBeenCalledWith(expect.anything(), 't1', 'p1', 'img-1');
      expect(objectStorage.deleteObject).toHaveBeenCalledWith('products/t1/p1/img-1.jpg');
    });
  });
});
