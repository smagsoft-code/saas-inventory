import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QrPublicService } from './qr-public.service';

function buildService() {
  const qrPublicRepository = {
    findActiveByCode: vi.fn(),
    findProductVariant: vi.fn(),
    findProductName: vi.fn(),
    findLocation: vi.fn(),
  };
  const service = new QrPublicService(qrPublicRepository as never);
  return { service, qrPublicRepository };
}

describe('QrPublicService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('404s for a code with no visible row (nonexistent, revoked, or expired — collapsed identically by RLS)', async () => {
    const { service, qrPublicRepository } = buildService();
    qrPublicRepository.findActiveByCode.mockResolvedValue(undefined);
    await expect(service.resolve('unknown-code')).rejects.toThrow(NotFoundException);
  });

  it('resolves a product_variant target to name/maxPrice/status only — never basePrice/minPrice/cost/ids', async () => {
    const { service, qrPublicRepository } = buildService();
    qrPublicRepository.findActiveByCode.mockResolvedValue({ targetType: 'product_variant', targetId: 'variant-1' });
    qrPublicRepository.findProductVariant.mockResolvedValue({ productId: 'product-1', maxPrice: '199.99', status: 'active' });
    qrPublicRepository.findProductName.mockResolvedValue('Moto XR');

    const result = await service.resolve('opaque-code');

    expect(result).toEqual({ targetType: 'product_variant', productName: 'Moto XR', maxPrice: 199.99, status: 'active' });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('productVariantId');
    expect(result).not.toHaveProperty('basePrice');
    expect(result).not.toHaveProperty('minPrice');
    expect(result).not.toHaveProperty('cost');
    expect(result).not.toHaveProperty('sku');
    expect(result).not.toHaveProperty('tenantId');
  });

  it('resolves a location target to name/code/status only', async () => {
    const { service, qrPublicRepository } = buildService();
    qrPublicRepository.findActiveByCode.mockResolvedValue({ targetType: 'location', targetId: 'location-1' });
    qrPublicRepository.findLocation.mockResolvedValue({ name: 'Bodega Norte - A3', code: 'A3', status: 'active' });

    const result = await service.resolve('opaque-code');

    expect(result).toEqual({ targetType: 'location', name: 'Bodega Norte - A3', code: 'A3', status: 'active' });
    expect(result).not.toHaveProperty('id');
    expect(result).not.toHaveProperty('warehouseId');
    expect(result).not.toHaveProperty('tenantId');
  });

  it('404s when a product_variant QR row is orphaned (target soft-deleted/gone)', async () => {
    const { service, qrPublicRepository } = buildService();
    qrPublicRepository.findActiveByCode.mockResolvedValue({ targetType: 'product_variant', targetId: 'variant-1' });
    qrPublicRepository.findProductVariant.mockResolvedValue(undefined);
    await expect(service.resolve('opaque-code')).rejects.toThrow(NotFoundException);
  });

  it('404s when a location QR row is orphaned (target soft-deleted/gone)', async () => {
    const { service, qrPublicRepository } = buildService();
    qrPublicRepository.findActiveByCode.mockResolvedValue({ targetType: 'location', targetId: 'location-1' });
    qrPublicRepository.findLocation.mockResolvedValue(undefined);
    await expect(service.resolve('opaque-code')).rejects.toThrow(NotFoundException);
  });

  it('404s when the product row behind a variant is missing (orphaned product_id)', async () => {
    const { service, qrPublicRepository } = buildService();
    qrPublicRepository.findActiveByCode.mockResolvedValue({ targetType: 'product_variant', targetId: 'variant-1' });
    qrPublicRepository.findProductVariant.mockResolvedValue({ productId: 'product-1', maxPrice: '10', status: 'active' });
    qrPublicRepository.findProductName.mockResolvedValue(undefined);
    await expect(service.resolve('opaque-code')).rejects.toThrow(NotFoundException);
  });
});
