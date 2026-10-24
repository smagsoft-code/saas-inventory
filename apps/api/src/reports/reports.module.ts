import { Module } from '@nestjs/common';
import { TenantSettingsRepository } from '../administration/tenant-settings/tenant-settings.repository';
import { ApprovalsReportController } from './approvals/approvals-report.controller';
import { ApprovalsReportRepository } from './approvals/approvals-report.repository';
import { ApprovalsReportService } from './approvals/approvals-report.service';
import { LocationAuthorizationService } from '../inventory/location-authorization.service';
import { ImportsReportController } from './imports/imports-report.controller';
import { ImportsReportRepository } from './imports/imports-report.repository';
import { ImportsReportService } from './imports/imports-report.service';
import { InventoryReportController } from './inventory/inventory-report.controller';
import { InventoryReportRepository } from './inventory/inventory-report.repository';
import { InventoryReportService } from './inventory/inventory-report.service';
import { KardexExportService } from './kardex/kardex-export.service';
import { KardexReportController } from './kardex/kardex-report.controller';
import { KardexReportRepository } from './kardex/kardex-report.repository';
import { KardexReportService } from './kardex/kardex-report.service';
import { MovementsReportController } from './movements/movements-report.controller';
import { MovementsReportRepository } from './movements/movements-report.repository';
import { MovementsReportService } from './movements/movements-report.service';
import { PaymentsExportService } from './payments/payments-export.service';
import { PaymentsReportController } from './payments/payments-report.controller';
import { PaymentsReportRepository } from './payments/payments-report.repository';
import { PaymentsReportService } from './payments/payments-report.service';
import { TabularExportService } from '../common/export/tabular-export.service';
import { ProductsExportService } from './products/products-export.service';
import { ProductsReportController } from './products/products-report.controller';
import { ProductsReportRepository } from './products/products-report.repository';
import { ProductsReportService } from './products/products-report.service';
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
 * job-count + row-total aggregation by period (`completed_at`) or by status. OUI-004 adds the
 * PRODUCTS read-side (`products/`) — `GET /reports/product-catalog`, the operational product list
 * (variant-grain: SKU/prices/status live on `product_variants`, not `products`) joined to a live
 * `inventory_balances` stock rollup — the one place this cross-domain (CATALOG + INVENTORY) join is
 * architecturally allowed to live (`modules.md`'s `Catalog -> Core`-only edge), the exact same
 * reasoning `inventory/` already established for its own product/category name enrichment. Not a
 * KPI dashboard — `apps/web`'s `/products` page is its only consumer. `TenantSettingsRepository`
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
    ProductsReportController,
    KardexReportController,
    PaymentsReportController,
  ],
  providers: [
    SalesReportService,
    SalesReportRepository,
    InventoryReportService,
    InventoryReportRepository,
    KardexReportService,
    KardexReportRepository,
    KardexExportService,
    PaymentsReportService,
    PaymentsReportRepository,
    PaymentsExportService,
    ProductsExportService,
    TabularExportService,
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
    ProductsReportService,
    ProductsReportRepository,
    TenantSettingsRepository,
    // Read-side location scope (ADR-0024/0035): a plain injectable with no dependencies, provided
    // directly the same way TenantSettingsRepository is, rather than importing InventoryModule.
    LocationAuthorizationService,
  ],
})
export class ReportsModule {}
