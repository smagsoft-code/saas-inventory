import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { withTenantTransaction } from '../../database/tenant-context';
import { ProductsInStockRepository } from '../repositories/products-in-stock.repository';
import { ListProductsInStockQueryDto } from './dto/list-products-in-stock-query.dto';
import { ProductInStockResponseDto } from './dto/product-in-stock-response.dto';
import { SearchVariantsInStockQueryDto } from './dto/search-variants-in-stock-query.dto';
import { VariantInStockResponseDto } from './dto/variant-in-stock-response.dto';

/**
 * Which products have available stock (`quantity_available > 0`) at one location — backs
 * "Producto" on the New Transfer form (F17-TRANSFERS-AUDIT): the picker must only offer products
 * that can actually be transferred from the chosen source, not the tenant's whole catalog. Reads
 * are tenant-wide, not location-scoped by ADR-0024 (same posture as `GET /inventory/balances` —
 * `inventory.view` alone; write paths are what assert location authorization).
 */
@ApiTags('inventory-products-in-stock')
@Controller('inventory/products-in-stock')
export class ProductsInStockController {
  constructor(private readonly productsInStockRepository: ProductsInStockRepository) {}

  /** Variant-grain search by product name or code — the New Transfer form's product search box. */
  @Get('variants')
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: VariantInStockResponseDto, isArray: true })
  async searchVariants(@CurrentTenant() tenantId: string, @Query() query: SearchVariantsInStockQueryDto): Promise<VariantInStockResponseDto[]> {
    const rows = await withTenantTransaction(tenantId, (tx) =>
      this.productsInStockRepository.searchVariantsByLocation(tx, tenantId, query.locationId, query.q),
    );
    return rows.map((row) => ({ ...row, quantityAvailable: Number(row.quantityAvailable) }));
  }

  @Get()
  @RequirePermissions('inventory.view')
  @ApiOkResponse({ type: ProductInStockResponseDto, isArray: true })
  async list(@CurrentTenant() tenantId: string, @Query() query: ListProductsInStockQueryDto): Promise<ProductInStockResponseDto[]> {
    return withTenantTransaction(tenantId, (tx) => this.productsInStockRepository.listByLocation(tx, tenantId, query.locationId));
  }
}
