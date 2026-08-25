import { Module } from '@nestjs/common';
import { UsersRepository } from '../auth/repositories/users.repository';
import { AuditLogService } from '../common/audit/audit-log.service';
import { BalancesController } from './balances/balances.controller';
import { BalancesService } from './balances/balances.service';
import { LocationAssignmentsController } from './location-assignments/location-assignments.controller';
import { LocationAssignmentsService } from './location-assignments/location-assignments.service';
import { LocationAuthorizationService } from './location-authorization.service';
import { LocationsController } from './locations/locations.controller';
import { LocationsService } from './locations/locations.service';
import { MovementsController } from './movements/movements.controller';
import { MovementsService } from './movements/movements.service';
import { IdempotencyKeysRepository } from './repositories/idempotency-keys.repository';
import { InventoryBalancesRepository } from './repositories/inventory-balances.repository';
import { InventoryMovementsRepository } from './repositories/inventory-movements.repository';
import { InventoryTransferItemsRepository } from './repositories/inventory-transfer-items.repository';
import { InventoryTransferReceiptsRepository } from './repositories/inventory-transfer-receipts.repository';
import { InventoryTransfersRepository } from './repositories/inventory-transfers.repository';
import { LocationsRepository } from './repositories/locations.repository';
import { ProductVariantsLookupRepository } from './repositories/product-variants-lookup.repository';
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
@Module({
  controllers: [WarehousesController, LocationsController, LocationAssignmentsController, BalancesController, MovementsController, TransfersController],
  providers: [
    WarehousesService,
    LocationsService,
    LocationAssignmentsService,
    BalancesService,
    MovementsService,
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
    UsersRepository,
  ],
})
export class InventoryModule {}
