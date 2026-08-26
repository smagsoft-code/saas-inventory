import { Module } from '@nestjs/common';
import { TenantsPlatformRepository } from '../auth/repositories/tenants-platform.repository';
import { CatalogModule } from '../catalog/catalog.module';
import { AuditLogService } from '../common/audit/audit-log.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ImportJobsController } from './import-jobs.controller';
import { ImportMappingTemplatesController } from './import-mapping-templates.controller';
import { ImportCatalogLookupRepository } from './repositories/import-catalog-lookup.repository';
import { ImportJobRowsRepository } from './repositories/import-job-rows.repository';
import { ImportJobsRepository } from './repositories/import-jobs.repository';
import { ImportMappingTemplatesRepository } from './repositories/import-mapping-templates.repository';
import { ImportWorkerClaimRepository } from './repositories/import-worker-claim.repository';
import { ImportAttributePartitionService } from './services/import-attribute-partition.service';
import { ImportAuditService } from './services/import-audit.service';
import { ImportErrorReportService } from './services/import-error-report.service';
import { ImportExecutionService } from './services/import-execution.service';
import { ImportFileService, ImportFileStorage } from './services/import-file.service';
import { ImportJobService } from './services/import-job.service';
import { ImportMappingService } from './services/import-mapping.service';
import { ImportPreviewService } from './services/import-preview.service';
import { ImportTemplateService } from './services/import-template.service';
import { ImportValidationService } from './services/import-validation.service';
import { ImportWorkerService } from './services/import-worker.service';

/**
 * modules.md#import — the staged Excel onboarding pipeline (§2, §3, ADR-0027). Depends on CORE
 * (tenant scoping, audit), CATALOG (product/category/attribute writes and validation), and
 * INVENTORY (the stock-mutation locking convoy and location authorization) — never the reverse;
 * neither CatalogModule nor InventoryModule imports ImportModule. Exports ImportWorkerService so
 * the separate Import Worker deployable (import-worker/main.ts) can drive it from its own
 * application-context bootstrap without duplicating any of this wiring.
 */
@Module({
  imports: [CatalogModule, InventoryModule],
  controllers: [ImportJobsController, ImportMappingTemplatesController],
  providers: [
    AuditLogService,
    // TenantsPlatformRepository: ImportValidationService/ImportExecutionService's PROMPT-011-B
    // between-batch tenant-status check needs it (via the same app_platform connection those
    // services already have global access to) — same "each module gets its own stateless
    // instance" convention as CommonModule/CoreModule/AdministrationModule for this exact class.
    TenantsPlatformRepository,
    ImportJobsRepository,
    ImportJobRowsRepository,
    ImportMappingTemplatesRepository,
    ImportCatalogLookupRepository,
    ImportWorkerClaimRepository,
    ImportTemplateService,
    ImportFileService,
    ImportFileStorage,
    ImportMappingService,
    ImportAttributePartitionService,
    ImportValidationService,
    ImportExecutionService,
    ImportPreviewService,
    ImportErrorReportService,
    ImportAuditService,
    ImportJobService,
    ImportWorkerService,
  ],
  exports: [ImportWorkerService],
})
export class ImportModule {}
