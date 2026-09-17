import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProductCatalogQueryDto } from './dto/product-catalog-query.dto';
import { ProductCatalogRowDto } from './dto/product-catalog-response.dto';
import { ProductsReportService } from './products-report.service';

/**
 * OUI-004 (`S-CAT-PRODUCTS` redesign). Reuses `products.view` as-is — F18-01's ratified rule (no
 * `reports.*` permission family; a report gates on the `*.view` permission of the domain it
 * reports on), the same permission `GET /products` itself requires.
 */
@ApiTags('reports')
@Controller('reports')
export class ProductsReportController {
  constructor(private readonly productsReportService: ProductsReportService) {}

  @Get('product-catalog')
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: ProductCatalogRowDto, isArray: true })
  async productCatalog(
    @CurrentTenant() tenantId: string,
    @Query() query: ProductCatalogQueryDto,
  ): Promise<PaginatedResult<ProductCatalogRowDto>> {
    return this.productsReportService.listCatalog(tenantId, query);
  }
}
