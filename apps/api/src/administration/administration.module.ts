import { Module } from '@nestjs/common';
import { IdentitiesRepository } from '../auth/repositories/identities.repository';
import { PlatformSupportSessionsRepository } from '../auth/repositories/platform-support-sessions.repository';
import { RolesRepository } from '../auth/repositories/roles.repository';
import { TenantAdminInvitationsRepository } from '../auth/repositories/tenant-admin-invitations.repository';
import { TenantMembershipsRepository } from '../auth/repositories/tenant-memberships.repository';
import { TenantsPlatformRepository } from '../auth/repositories/tenants-platform.repository';
import { UsersRepository } from '../auth/repositories/users.repository';
import { IdentityProvisioningService } from '../auth/services/identity-provisioning.service';
import { TenantProvisioningService } from '../auth/services/tenant-provisioning.service';
import { InvitationTokenService } from '../auth/tokens/invitation-token.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { PlatformAuditLogService } from '../common/audit/platform-audit-log.service';
import { SupportSessionGuard } from '../common/guards/support-session.guard';
import { PlatformSummaryController } from './platform-summary/platform-summary.controller';
import { PlatformSummaryRepository } from './platform-summary/platform-summary.repository';
import { PlatformSummaryService } from './platform-summary/platform-summary.service';
import { PlatformSupportController } from './platform-support/platform-support.controller';
import { PlatformSupportRepository } from './platform-support/platform-support.repository';
import { PlatformSupportService } from './platform-support/platform-support.service';
import { PlatformSupportSessionsController } from './platform-support/platform-support-sessions.controller';
import { PlatformSupportSessionsService } from './platform-support/platform-support-sessions.service';
import { PlatformTenantOnboardingService } from './platform-tenants/platform-tenant-onboarding.service';
import { PlatformTenantsController } from './platform-tenants/platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants/platform-tenants.service';
import { TenantSettingsController } from './tenant-settings/tenant-settings.controller';
import { TenantSettingsRepository } from './tenant-settings/tenant-settings.repository';
import { TenantSettingsService } from './tenant-settings/tenant-settings.service';

/**
 * modules.md#administration — "tenant-level configuration ... and system-level configuration that
 * only a SuperAdmin can change", FASE 11 + the ADR-0036 Tenant Onboarding / Tenant Support block.
 * Independent feature areas sharing one module purely for NestJS wiring convenience; they share no
 * controller and no permission model:
 *
 * - tenant-settings/ — tenant-scoped, RBAC-gated (administration.settings.*), audited via the
 *   ordinary tenant AuditLogService.
 * - platform-tenants/ — platform-scoped, @PlatformOnly()-gated, audited via
 *   PlatformAuditLogService. Now includes onboarding (create tenant + admin + invitation) — ADR-0036.
 * - platform-summary/ (F18-10) — platform-scoped, @PlatformOnly()-gated, read-only aggregate over
 *   the `tenants` table alone; no mutation, so no audit write.
 * - platform-support/ (ADR-0036) — platform-scoped, @PlatformOnly() + @RequireSupportSession()
 *   (SupportSessionGuard), a curated read/write surface over ONE tenant at a time, audited via
 *   PlatformAuditLogService. Never tenant RBAC (`@RequirePermissions()` is never used here).
 *
 * Re-provides the auth/ repositories/services it needs directly (TenantProvisioningService,
 * IdentityProvisioningService, IdentitiesRepository, TenantMembershipsRepository, RolesRepository,
 * UsersRepository) rather than importing AuthModule — same convention this module's own header
 * comment already established for TenantsPlatformRepository (§6: no parallel implementation, but
 * also no cross-module coupling for what are stateless, side-effect-free classes; NestJS gives
 * each module its own instance, not a second competing implementation).
 */
@Module({
  controllers: [
    TenantSettingsController,
    PlatformTenantsController,
    PlatformSummaryController,
    PlatformSupportSessionsController,
    PlatformSupportController,
  ],
  providers: [
    TenantSettingsService,
    TenantSettingsRepository,
    PlatformTenantsService,
    PlatformTenantOnboardingService,
    PlatformSummaryService,
    PlatformSummaryRepository,
    PlatformSupportService,
    PlatformSupportRepository,
    PlatformSupportSessionsService,
    PlatformSupportSessionsRepository,
    SupportSessionGuard,
    TenantsPlatformRepository,
    AuditLogService,
    PlatformAuditLogService,
    // ADR-0036 — reused verbatim from auth/, never reimplemented.
    TenantProvisioningService,
    IdentityProvisioningService,
    InvitationTokenService,
    TenantAdminInvitationsRepository,
    IdentitiesRepository,
    TenantMembershipsRepository,
    RolesRepository,
    UsersRepository,
  ],
})
export class AdministrationModule {}
