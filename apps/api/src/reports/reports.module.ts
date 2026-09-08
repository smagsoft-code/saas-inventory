import { Module } from '@nestjs/common';
import { TenantSettingsRepository } from '../administration/tenant-settings/tenant-settings.repository';
import { ApprovalsReportController } from './approvals/approvals-report.controller';
import { ApprovalsReportRepository } from './approvals/approvals-report.repository';
import { ApprovalsReportService } from './approvals/approvals-report.service';
import { ImportsReportController } from './imports/imports-report.controller';
import { ImportsReportRepository } from './imports/imports-report.repository';
import { ImportsReportService } from './imports/imports-report.service';
import { InventoryReportController } from './inventory/inventory-report.controller';
import { InventoryReportRepository } from './inventory/inventory-report.repository';
import { InventoryReportService } from './inventory/inventory-report.service';
import { MovementsReportController } from './movements/movements-report.controller';
import { MovementsReportRepository } from './movements/movements-report.repository';
import { MovementsReportService } from './movements/movements-report.service';
import { ReturnsReportController } from './returns/returns-report.controller';
import { ReturnsReportRepository } from './returns/returns-report.repository';
import { ReturnsReportService } from './returns/returns-report.service';
import { SalesReportController } from './sales/sales-report.controller';
import { SalesReportRepository } from './sales/sales-report.repository';
import { SalesReportService } from './sales/sales-report.service';
import { TransfersReportController } from './transfers/transfers-report.controller';
import { TransfersReportRepository } from './transfers/transfers-report.repository';
import { TransfersReportService } from './transfers/transfers-report.service';

/**
 * REPORTS — modules.md#reports: "read-side aggregation across CORE/CATALOG/INVENTORY/SALES ...
 * read-optimized queries ... must not reuse the transactional write-path repositories." F18-02
 * delivered the SALES read-side (`sales/`); F18-03 added the INVENTORY read-side (`inventory/`);
 * F18-04 adds the RETURNS read-side (`returns/`) — same pattern, its own repository/service/
 * controller, never `SalesReturnsRepository`/`SalesReturnItemsRepository`. F18-05 adds the
 * APPROVALS read-side (`approvals/`) — `GET /reports/approvals-summary` over `price_approvals`
 * alone, never `PriceApprovalsRepository`. F18-07 adds the MOVEMENTS read-side (`movements/`) —
 * `GET /reports/movements-summary` over `inventory_movements` alone (no join), never
 * `InventoryMovementsRepository`. F18-08 adds the TRANSFERS read-side (`transfers/`) —
 * `GET /reports/transfers-summary`, a live snapshot over `inventory_transfers` /
 * `inventory_transfer_items` (never the transactional `InventoryTransfers*`/`InventoryTransferItems*`
 * repositories) — status rollup + in-transit stock by destination/variant; no `from`/`to` (like
 * `inventory-summary`). F18-09 adds the IMPORTS read-side (`imports/`) —
 * `GET /reports/imports-summary` over `import_jobs` alone (no join), never `ImportJobsRepository` —
 * job-count + row-total aggregation by period (`completed_at`) or by status. `TenantSettingsRepository`
 * is reused directly as a provider (same convention `AuthModule`/`AdministrationModule` already use
 * for cross-cutting repositories) rather than importing `AdministrationModule` — no module-level
 * dependency edge either way; the inventory report does not need it (no timezone-bucketed period in
 * that report, unlike sales-summary/returns-summary/movements-summary).
 */
@Module({
  controllers: [
    SalesReportController,
    InventoryReportController,
    ReturnsReportController,
    ApprovalsReportController,
    MovementsReportController,
    TransfersReportController,
    ImportsReportController,
  ],
  providers: [
    SalesReportService,
    SalesReportRepository,
    InventoryReportService,
    InventoryReportRepository,
    ReturnsReportService,
    ReturnsReportRepository,
    ApprovalsReportService,
    ApprovalsReportRepository,
    MovementsReportService,
    MovementsReportRepository,
    TransfersReportService,
    TransfersReportRepository,
    ImportsReportService,
    ImportsReportRepository,
    TenantSettingsRepository,
  ],
})
export class ReportsModule {}
