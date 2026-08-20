import { Module } from '@nestjs/common';
import { UsersRepository } from '../auth/repositories/users.repository';
import { AuditLogService } from '../common/audit/audit-log.service';
import { LocationAssignmentsController } from './location-assignments/location-assignments.controller';
import { LocationAssignmentsService } from './location-assignments/location-assignments.service';
import { LocationsController } from './locations/locations.controller';
import { LocationsService } from './locations/locations.service';
import { LocationsRepository } from './repositories/locations.repository';
import { UserLocationAssignmentsRepository } from './repositories/user-location-assignments.repository';
import { WarehousesRepository } from './repositories/warehouses.repository';
import { WarehousesController } from './warehouses/warehouses.controller';
import { WarehousesService } from './warehouses/warehouses.service';

/**
 * modules.md#inventory — warehouses, locations, and location-scoped authorization assignments
 * (Prompt 07 / roadmap.md FASE 7). Deliberately excludes inventory_balances/inventory_movements/
 * adjustments/transfers — those remain FASE 8, not built here (see the Prompt 07 scope decision).
 * Depends on CORE (tenant scoping, audit, and — for location-assignments only — UsersRepository,
 * reused rather than duplicated, same precedent as CoreModule reusing auth/'s UsersRepository)
 * per modules.md's `Inventory --> Core` dependency edge. AuditLogService is registered here the same
 * way CatalogModule/CoreModule each register their own stateless instance of the same class.
 */
@Module({
  controllers: [WarehousesController, LocationsController, LocationAssignmentsController],
  providers: [
    WarehousesService,
    LocationsService,
    LocationAssignmentsService,
    AuditLogService,
    WarehousesRepository,
    LocationsRepository,
    UserLocationAssignmentsRepository,
    UsersRepository,
  ],
})
export class InventoryModule {}
