import { Module } from '@nestjs/common';
import { TenantSettingsRepository } from '../administration/tenant-settings/tenant-settings.repository';
import { SalesReportController } from './sales/sales-report.controller';
import { SalesReportRepository } from './sales/sales-report.repository';
import { SalesReportService } from './sales/sales-report.service';

/**
 * REPORTS — modules.md#reports: "read-side aggregation across CORE/CATALOG/INVENTORY/SALES ...
 * read-optimized queries ... must not reuse the transactional write-path repositories." First real
 * deliverable, F18-02: the SALES read-side (`sales/`). `TenantSettingsRepository` is reused
 * directly as a provider (same convention `AuthModule`/`AdministrationModule` already use for
 * cross-cutting repositories) rather than importing `AdministrationModule` — no module-level
 * dependency edge either way.
 */
@Module({
  controllers: [SalesReportController],
  providers: [SalesReportService, SalesReportRepository, TenantSettingsRepository],
})
export class ReportsModule {}
