import { Module } from '@nestjs/common';
import { TenantsPlatformRepository } from '../auth/repositories/tenants-platform.repository';
import { AuditLogService } from '../common/audit/audit-log.service';
import { PlatformAuditLogService } from '../common/audit/platform-audit-log.service';
import { PlatformSummaryController } from './platform-summary/platform-summary.controller';
import { PlatformSummaryRepository } from './platform-summary/platform-summary.repository';
import { PlatformSummaryService } from './platform-summary/platform-summary.service';
import { PlatformTenantsController } from './platform-tenants/platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants/platform-tenants.service';
import { TenantSettingsController } from './tenant-settings/tenant-settings.controller';
import { TenantSettingsRepository } from './tenant-settings/tenant-settings.repository';
import { TenantSettingsService } from './tenant-settings/tenant-settings.service';

/**
 * modules.md#administration — "tenant-level configuration ... and system-level configuration that
 * only a SuperAdmin can change", FASE 11. Two independent feature areas sharing one module purely
 * for NestJS wiring convenience; they share no controller and no permission model:
 *
 * - tenant-settings/ — tenant-scoped, RBAC-gated (administration.settings.*), audited via the
 *   ordinary tenant AuditLogService.
 * - platform-tenants/ — platform-scoped, @PlatformOnly()-gated, audited via
 *   PlatformAuditLogService.
 * - platform-summary/ (F18-10) — platform-scoped, @PlatformOnly()-gated, read-only aggregate over
 *   the `tenants` table alone (a dedicated read-side repository, never TenantsPlatformRepository);
 *   no mutation, so no audit write.
 *
 * Reuses TenantsPlatformRepository directly (same convention CoreModule already established for
 * reusing auth/'s repositories — see core.module.ts's own comment) rather than importing AuthModule
 * or duplicating a second `tenants`-table repository (§6).
 */
@Module({
  controllers: [TenantSettingsController, PlatformTenantsController, PlatformSummaryController],
  providers: [
    TenantSettingsService,
    TenantSettingsRepository,
    PlatformTenantsService,
    PlatformSummaryService,
    PlatformSummaryRepository,
    TenantsPlatformRepository,
    AuditLogService,
    PlatformAuditLogService,
  ],
})
export class AdministrationModule {}
