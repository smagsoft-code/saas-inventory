import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../../lib/api/client';
import { getVariant, listVariants, resolveQrCode, searchProducts } from './sale-api';

vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mocked = vi.mocked(apiFetch);

describe('sale-api', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searchProducts queries the variant-grain catalog report by name/code — no tenantId', async () => {
    mocked.mockResolvedValueOnce({ data: [{ productId: 'p1', productName: 'Widget', variantId: 'v1', sku: 'WID-001' }] });
    const rows = await searchProducts('wid');
    expect(mocked).toHaveBeenCalledWith('/api/v1/reports/product-catalog', {
      query: { q: 'wid', status: 'active', productStatus: 'active', pageSize: 8 },
    });
    expect(rows).toEqual([{ id: 'p1', variantId: 'v1', name: 'Widget', sku: 'WID-001' }]);
    expect(JSON.stringify(mocked.mock.calls)).not.toMatch(/tenant_?id/i);
  });

  it('listVariants reads GET /products/:id/variants', async () => {
    mocked.mockResolvedValueOnce([{ id: 'v1', sku: 'SKU-1' }]);
    await listVariants('p1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/products/p1/variants');
  });

  it('getVariant reads GET /products/:id/variants/:variantId', async () => {
    mocked.mockResolvedValueOnce({ id: 'v1', sku: 'SKU-1' });
    await getVariant('p1', 'v1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/products/p1/variants/v1');
  });

  it('resolveQrCode reads GET /qr-codes/resolve/:code, URL-encoded', async () => {
    mocked.mockResolvedValueOnce({ qrCodeId: 'q1', targetType: 'product_variant', status: 'active' });
    await resolveQrCode('AB C/1');
    expect(mocked).toHaveBeenCalledWith('/api/v1/qr-codes/resolve/AB%20C%2F1');
  });
});
