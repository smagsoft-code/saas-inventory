import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PlatformSupportSessionsRepository } from '../auth/repositories/platform-support-sessions.repository';
import { TenantMembershipsRepository } from '../auth/repositories/tenant-memberships.repository';
import { TenantsPlatformRepository } from '../auth/repositories/tenants-platform.repository';
import { PlatformAuditLogService } from './audit/platform-audit-log.service';
import { AUTH_CONFIG, getAuthConfig } from './config/auth-config';
import { HttpExceptionFilter } from './filters/http-exception.filter';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { TenantGuard } from './guards/tenant.guard';
import { SupportReadAuditInterceptor } from './interceptors/support-read-audit.interceptor';
import { ObjectStorageService } from './storage/object-storage.service';

/**
 * Cross-cutting infrastructure shared by every module (backend.md#cross-cutting-concerns):
 * the global guard chain in the exact order api.md#request-flow specifies (auth -> tenant -> csrf
 * -> permissions), the single global exception filter, and (Prompt 10) the one S3-compatible
 * ObjectStorageService every module needing file storage shares (IMPORT is the first consumer).
 * Global so no future feature module has to remember to wire these up itself.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [
    { provide: AUTH_CONFIG, useFactory: getAuthConfig },
    // TenantMembershipsRepository: TenantGuard's one live cross-tenant status check (016-C —
    // membership + tenant + identity + user status, folding in PROMPT 011-A/011-B). Stateless,
    // depends only on the globally-provided PLATFORM_DATABASE token — same "each module gets its
    // own instance" convention already used for the other app_platform repositories.
    TenantMembershipsRepository,
    // ADR-0036 extension — TenantGuard's support-session resolution branch (a Platform Admin
    // browsing an ordinary tenant route under an active support session): both are stateless,
    // depend only on PLATFORM_DATABASE, same convention as TenantMembershipsRepository above.
    PlatformSupportSessionsRepository,
    TenantsPlatformRepository,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // SUP-READ-NOT-AUDITED (FASE 19): one audit row per GET served under a support session (ADR-0036). Inert for every other request.
    PlatformAuditLogService,
    { provide: APP_INTERCEPTOR, useClass: SupportReadAuditInterceptor },
    ObjectStorageService,
  ],
  exports: [AUTH_CONFIG, JwtModule, ObjectStorageService],
})
export class CommonModule {}
