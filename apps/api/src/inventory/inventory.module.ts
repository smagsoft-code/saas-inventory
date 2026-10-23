import { Module } from '@nestjs/common';
import { UsersRepository } from '../auth/repositories/users.repository';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantSettingsRepository } from '../administration/tenant-settings/tenant-settings.repository';
import { BulkReceiptsController } from './bulk-receipts/bulk-receipts.controller';
import { BulkReceiptsService } from './bulk-receipts/bulk-receipts.service';
import { BulkReceiptsLookupRepository } from './repositories/bulk-receipts-lookup.repository';
import { BalancesController } from './balances/balances.controller';
import { BalancesService } from './balances/balances.service';
import { MovingAverageCostService } from './kardex/moving-average-cost.service';
import { VariantCostLookupRepository } from './kardex/variant-cost-lookup.repository';
import { LocationAssignmentsController } from './location-assignments/location-assignments.controller';
import { LocationAssignmentsService } from './location-assignments/location-assignments.service';
import { LocationAuthorizationService } from './location-authorization.service';
import { LocationScopeController } from './location-scope/location-scope.controller';
import { LocationsController } from './locations/locations.controller';
import { LocationsService } from './locations/locations.service';
import { MovementsController } from './movements/movements.controller';
import { MovementsService } from './movements/movements.service';
import { ProductsInStockController } from './products-in-stock/products-in-stock.controller';
import { IdempotencyKeysRepository } from './repositories/idempotency-keys.repository';
import { InventoryBalancesRepository } from './repositories/inventory-balances.repository';
import { InventoryMovementsRepository } from './repositories/inventory-movements.repository';
import { InventoryTransferItemsRepository } from './repositories/inventory-transfer-items.repository';
import { InventoryTransferReceiptsRepository } from './repositories/inventory-transfer-receipts.repository';
import { InventoryTransfersRepository } from './repositories/inventory-transfers.repository';
import { LocationsRepository } from './repositories/locations.repository';
import { ProductVariantsLookupRepository } from './repositories/product-variants-lookup.repository';
import { ProductsInStockRepository } from './repositories/products-in-stock.repository';
import { TransferWorkflowConfigRepository } from './repositories/transfer-workflow-config.repository';
import { UserLocationAssignmentsRepository } from './repositories/user-location-assignments.repository';
import { WarehousesRepository } from './repositories/warehouses.repository';
import { StockLedgerService } from './stock-ledger.service';
import { TransfersController } from './transfers/transfers.controller';
import { TransfersService } from './transfers/transfers.service';
import { WarehousesController } from './warehouses/warehouses.controller';
import { WarehousesService } from './warehouses/warehouses.service';

/**
 * modules.md#inventory — warehouses, locations, location-scoped authorization assignments (Prompt
 * 07 / roadmap.md FASE 7), plus inventory_balances/inventory_movements/adjustments/transfers and the
 * ADR-0024 location-authorization guard itself (Prompt 08 / FASE 8). Depends on CORE (tenant
 * scoping, audit, and — for location-assignments only — UsersRepository, reused rather than
 * duplicated) and CATALOG (ProductVariantsLookupRepository, a minimal existence check reused across
 * balances/movements/transfers) per modules.md's `Inventory --> Core`/`Inventory --> Catalog`
 * dependency edges. StockLedgerService is the one locking convoy every stock-affecting write (FASE
 * 8's adjustments and every transfer state transition) goes through — never duplicated per feature.
 */
/**
 * Exports (Prompt 10): IMPORT depends on INVENTORY (modules.md's IMPORT --> INVENTORY edge) and
 * reuses these providers directly — StockLedgerService for the one locking convoy every
 * stock-affecting write goes through (INITIAL_STOCK/ADJUSTMENT_IN, never a parallel write path),
 * LocationAuthorizationService for the same ADR-0024 check every other location-targeting write
 * uses, WarehousesRepository/LocationsRepository for template generation and row validation. This
 * is the one direction the edge runs; InventoryModule itself never imports ImportModule.
 */
@Module({
  controllers: [
    WarehousesController,
    LocationsController,
    LocationAssignmentsController,
    LocationScopeController,
    BalancesController,
    MovementsController,
    BulkReceiptsController,
    ProductsInStockController,
    TransfersController,
  ],
  providers: [
    WarehousesService,
    LocationsService,
    LocationAssignmentsService,
    BalancesService,
    MovementsService,
    BulkReceiptsService,
    BulkReceiptsLookupRepository,
    TenantSettingsRepository,
    TransfersService,
    AuditLogService,
    LocationAuthorizationService,
    StockLedgerService,
    WarehousesRepository,
    LocationsRepository,
    UserLocationAssignmentsRepository,
    InventoryBalancesRepository,
    InventoryMovementsRepository,
    InventoryTransfersRepository,
    InventoryTransferItemsRepository,
    InventoryTransferReceiptsRepository,
    IdempotencyKeysRepository,
    ProductVariantsLookupRepository,
    ProductsInStockRepository,
    TransferWorkflowConfigRepository,
    UsersRepository,
    MovingAverageCostService,
    VariantCostLookupRepository,
  ],
  exports: [
    StockLedgerService,
    LocationAuthorizationService,
    WarehousesRepository,
    LocationsRepository,
    ProductVariantsLookupRepository,
    // Prompt 012 (SALES): checkout reads available stock at the cart location for the cart view and
    // reserves/commits through StockLedgerService — modules.md's SALES --> INVENTORY edge, the same
    // "reuse the public provider, never a parallel read" posture IMPORT already uses.
    InventoryBalancesRepository,
    // A sales return values its reingreso at the cost the original SALE drew at (Kardex average).
    MovingAverageCostService,
  ],
})
export class InventoryModule {}
