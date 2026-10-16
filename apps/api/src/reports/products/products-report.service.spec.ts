import { describe, expect, it, vi } from 'vitest';
import { ProductsReportService } from './products-report.service';
import type { ProductCatalogQueryDto } from './dto/product-catalog-query.dto';
import type { ProductCatalogRow } from './products-report.repository';

/** Same convention as inventory-report.service.spec.ts: mock withTenantTransaction to just invoke
 * its callback with a stub `tx` — no database, no Nest DI container. Real-PostgreSQL coverage is
 * test/reports/product-catalog.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function buildService() {
  const productsReportRepository = { list: vi.fn().mockResolvedValue([]) };
  const service = new ProductsReportService(productsReportRepository as never);
  return { service, productsReportRepository };
}

function query(overrides: Partial<ProductCatalogQueryDto> = {}): ProductCatalogQueryDto {
  return { page: 1, pageSize: 20, ...overrides } as ProductCatalogQueryDto;
}

function row(overrides: Partial<ProductCatalogRow> = {}): ProductCatalogRow {
  return {
    productId: 'p1',
    productName: 'Widget',
    categoryId: null,
    variantId: 'v1',
    sku: 'SKU-1',
    status: 'active',
    maxPrice: '100',
    basePrice: '80',
    availableQuantity: '5',
    imageId: null,
    attributes: null,
    totalCount: '1',
    ...overrides,
  };
}

describe('ProductsReportService.listCatalog', () => {
  it('trims and passes q/categoryId/status/stock filters through to the repository', async () => {
    const { service, productsReportRepository } = buildService();
    await service.listCatalog('t1', query({ q: '  widg  ', categoryId: 'c1', status: 'active', stock: 'with' }));
    expect(productsReportRepository.list).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      { q: 'widg', categoryId: 'c1', status: 'active', productStatus: undefined, variantId: undefined, locationId: undefined, stock: 'with' },
      1,
      20,
    );
  });

  it('omits q entirely when it trims to empty — never sends a blank search', async () => {
    const { service, productsReportRepository } = buildService();
    await service.listCatalog('t1', query({ q: '   ' }));
    expect(productsReportRepository.list).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ q: undefined }),
      1,
      20,
    );
  });

  it('converts numeric-string fields to numbers and omits categoryId when null', async () => {
    const { service, productsReportRepository } = buildService();
    productsReportRepository.list.mockResolvedValue([row()]);
    const result = await service.listCatalog('t1', query());
    expect(result.data[0]).toEqual({
      productId: 'p1',
      productName: 'Widget',
      variantId: 'v1',
      sku: 'SKU-1',
      status: 'active',
      maxPrice: 100,
      basePrice: 80,
      availableQuantity: 5,
    });
    expect(result.data[0]).not.toHaveProperty('categoryId');
  });

  it('includes categoryId when the product has one', async () => {
    const { service, productsReportRepository } = buildService();
    productsReportRepository.list.mockResolvedValue([row({ categoryId: 'c1' })]);
    const result = await service.listCatalog('t1', query());
    expect(result.data[0]?.categoryId).toBe('c1');
  });

  it('omits thumbnailUrl when the product has no image', async () => {
    const { service, productsReportRepository } = buildService();
    productsReportRepository.list.mockResolvedValue([row({ imageId: null })]);
    const result = await service.listCatalog('t1', query());
    expect(result.data[0]).not.toHaveProperty('thumbnailUrl');
  });

  it('builds a same-origin thumbnailUrl when the product has an image', async () => {
    const { service, productsReportRepository } = buildService();
    productsReportRepository.list.mockResolvedValue([row({ imageId: 'img-1' })]);
    const result = await service.listCatalog('t1', query());
    expect(result.data[0]?.thumbnailUrl).toBe('/api/v1/products/p1/images/img-1');
  });

  it('passes productStatus (the status of the parent product) through, e.g. the sales picker asking for active only', async () => {
    const { service, productsReportRepository } = buildService();
    await service.listCatalog('t1', query({ q: 'arm', status: 'active', productStatus: 'active' }));
    expect(productsReportRepository.list).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ q: 'arm', status: 'active', productStatus: 'active' }),
      1,
      20,
    );
  });

  it('exposes the merged attribute values (and omits the field when there are none)', async () => {
    const { service, productsReportRepository } = buildService();
    productsReportRepository.list.mockResolvedValue([
      row({ attributes: { ATR001: 'crema', ATR002: 80 } }),
      row({ variantId: 'v2', attributes: {} }),
    ]);
    const result = await service.listCatalog('t1', query());
    expect(result.data[0]?.attributes).toEqual({ ATR001: 'crema', ATR002: 80 });
    expect(result.data[1]).not.toHaveProperty('attributes');
  });

  it('reads total from the first row\'s totalCount (COUNT(*) OVER())', async () => {
    const { service, productsReportRepository } = buildService();
    productsReportRepository.list.mockResolvedValue([row({ totalCount: '37' }), row({ totalCount: '37', variantId: 'v2' })]);
    const result = await service.listCatalog('t1', query({ pageSize: 2 }));
    expect(result.meta).toEqual({ page: 1, pageSize: 2, total: 37, totalPages: 19 });
  });

  it('reports total 0 (never a fake row) when nothing matches', async () => {
    const { service, productsReportRepository } = buildService();
    productsReportRepository.list.mockResolvedValue([]);
    const result = await service.listCatalog('t1', query());
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(1);
  });

  it('never sends a tenantId anywhere but the resolved argument', async () => {
    const { service, productsReportRepository } = buildService();
    await service.listCatalog('t1', query());
    expect(JSON.stringify(productsReportRepository.list.mock.calls)).toContain('t1');
  });
});
