import { Injectable } from '@nestjs/common';
import type { PaginatedResult } from '@saas-inventory/types';
import { withTenantTransaction } from '../../database/tenant-context';
import type { ProductCatalogQueryDto } from './dto/product-catalog-query.dto';
import type { ProductCatalogRowDto } from './dto/product-catalog-response.dto';
import type { ProductCatalogRow } from './products-report.repository';
import { ProductsReportRepository } from './products-report.repository';

function toRowDto(row: ProductCatalogRow): ProductCatalogRowDto {
  return {
    productId: row.productId,
    productName: row.productName,
    ...(row.categoryId ? { categoryId: row.categoryId } : {}),
    variantId: row.variantId,
    sku: row.sku,
    status: row.status,
    maxPrice: Number(row.maxPrice),
    basePrice: Number(row.basePrice),
    availableQuantity: Number(row.availableQuantity),
    ...(row.imageId ? { thumbnailUrl: `/api/v1/products/${row.productId}/images/${row.imageId}` } : {}),
  };
}

/**
 * `GET /reports/product-catalog` (OUI-004) — the operational product list, variant-grain, with a
 * live stock rollup. `COUNT(*) OVER()` rides on every returned row (`ProductsReportRepository`); a
 * 0-row page carries no such row, so `total` falls back to `0` explicitly rather than reading
 * `undefined`.
 */
@Injectable()
export class ProductsReportService {
  constructor(private readonly productsReportRepository: ProductsReportRepository) {}

  async listCatalog(tenantId: string, query: ProductCatalogQueryDto): Promise<PaginatedResult<ProductCatalogRowDto>> {
    const filters = {
      q: query.q?.trim() || undefined,
      categoryId: query.categoryId,
      status: query.status,
      stock: query.stock,
    };

    return withTenantTransaction(tenantId, async (tx) => {
      const rows = await this.productsReportRepository.list(tx, tenantId, filters, query.page, query.pageSize);
      const total = rows.length > 0 ? Number(rows[0]!.totalCount) : 0;

      return {
        data: rows.map(toRowDto),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }
}
