import { Module } from '@nestjs/common';
import { TenantSettingsRepository } from '../administration/tenant-settings/tenant-settings.repository';
import { InventoryReportController } from './inventory/inventory-report.controller';
import { InventoryReportRepository } from './inventory/inventory-report.repository';
import { InventoryReportService } from './inventory/inventory-report.service';
import { ReturnsReportController } from './returns/returns-report.controller';
import { ReturnsReportRepository } from './returns/returns-report.repository';
import { ReturnsReportService } from './returns/returns-report.service';
import { SalesReportController } from './sales/sales-report.controller';
import { SalesReportRepository } from './sales/sales-report.repository';
import { SalesReportService } from './sales/sales-report.service';

/**
 * REPORTS — modules.md#reports: "read-side aggregation across CORE/CATALOG/INVENTORY/SALES ...
 * read-optimized queries ... must not reuse the transactional write-path repositories." F18-02
 * delivered the SALES read-side (`sales/`); F18-03 added the INVENTORY read-side (`inventory/`);
 * F18-04 adds the RETURNS read-side (`returns/`) — same pattern, its own repository/service/
 * controller, never `SalesReturnsRepository`/`SalesReturnItemsRepository`. `TenantSettingsRepository`
 * is reused directly as a provider (same convention `AuthModule`/`AdministrationModule` already use
 * for cross-cutting repositories) rather than importing `AdministrationModule` — no module-level
 * dependency edge either way; the inventory report does not need it (no timezone-bucketed period in
 * that report, unlike sales-summary/returns-summary).
 */
@Module({
  controllers: [SalesReportController, InventoryReportController, ReturnsReportController],
  providers: [
    SalesReportService,
    SalesReportRepository,
    InventoryReportService,
    InventoryReportRepository,
    ReturnsReportService,
    ReturnsReportRepository,
    TenantSettingsRepository,
  ],
})
export class ReportsModule {}
