import { Global, Module } from '@nestjs/common';
import { VARIANT_STOCK_PORT } from '../catalog/products/variant-stock.port';
import { InventoryBalancesRepository } from './repositories/inventory-balances.repository';
import { VariantStockAdapter } from './variant-stock.adapter';

/**
 * The one place CATALOG's variant-status write (rejecting "discontinued" while physical stock > 0)
 * reaches INVENTORY data — via the port CATALOG owns (`catalog/products/variant-stock.port.ts`),
 * bound here to an INVENTORY-backed adapter. `@Global()` so the binding reaches `ProductsService`
 * without `CatalogModule` ever gaining an `imports: [InventoryModule]` edge — the same "avoid a new
 * module dependency edge" motivation `common/storage/`'s `ObjectStorageService` already established.
 * `InventoryBalancesRepository` is declared again here (stateless — no constructor deps, pure `tx`-
 * scoped DB access, so a second instance carries no divergent state) instead of importing the whole
 * `InventoryModule`, keeping this bridge a narrow, one-way seam rather than pulling in inventory's
 * controllers/services.
 */
@Global()
@Module({
  providers: [
    InventoryBalancesRepository,
    VariantStockAdapter,
    { provide: VARIANT_STOCK_PORT, useExisting: VariantStockAdapter },
  ],
  exports: [VARIANT_STOCK_PORT],
})
export class VariantStockBridgeModule {}
