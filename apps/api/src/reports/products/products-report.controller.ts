import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { PaginatedResult } from '@saas-inventory/types';
import type { FastifyReply } from 'fastify';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProductCatalogExportQueryDto } from './dto/product-catalog-export-query.dto';
import { ProductCatalogQueryDto } from './dto/product-catalog-query.dto';
import { ProductsExportService } from './products-export.service';
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
  constructor(
    private readonly productsReportService: ProductsReportService,
    private readonly productsExportService: ProductsExportService,
  ) {}

  @Get('product-catalog')
  @RequirePermissions('products.view')
  @ApiOkResponse({ type: ProductCatalogRowDto, isArray: true })
  async productCatalog(
    @CurrentTenant() tenantId: string,
    @Query() query: ProductCatalogQueryDto,
  ): Promise<PaginatedResult<ProductCatalogRowDto>> {
    return this.productsReportService.listCatalog(tenantId, query);
  }

  /** Excel/PDF of the filtered product list — same filters, one row per variant, like the screen. */
  @Get('product-catalog/export')
  @RequirePermissions('products.view')
  async exportProductCatalog(
    @CurrentTenant() tenantId: string,
    @Query() query: ProductCatalogExportQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Buffer> {
    const file = await this.productsExportService.build(tenantId, query);
    void reply.header('Content-Type', file.contentType);
    void reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.buffer;
  }
}
