import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentPlatformAdmin } from '../../common/decorators/current-platform-admin.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import type { PlatformPrincipal } from '../../common/context/request-context';
import type { TenantRow } from '../../auth/repositories/tenants-platform.repository';
import type { InvitationRow } from '../../auth/repositories/tenant-admin-invitations.repository';
import { PlatformTenantResponseDto } from '../dto/platform-tenant-response.dto';
import { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';
import { InvitationStatusResponseDto } from './dto/invitation-status-response.dto';
import { PlatformTenantOnboardingResponseDto } from './dto/platform-tenant-onboarding-response.dto';
import { PlatformTenantOnboardingService, buildInvitationUrl, type OnboardingResult } from './platform-tenant-onboarding.service';
import { PlatformTenantsService } from './platform-tenants.service';

function toResponse(tenant: TenantRow): PlatformTenantResponseDto {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    isDemo: tenant.isDemo,
    createdAt: tenant.createdAt.toISOString(),
  };
}

function toOnboardingResponse(result: OnboardingResult): PlatformTenantOnboardingResponseDto {
  return {
    tenant: toResponse(result.tenant),
    admin: result.admin,
    identityReused: result.identityReused,
    ...(result.invitation
      ? { invitationUrl: buildInvitationUrl(result.invitation.rawToken), invitationExpiresAt: result.invitation.expiresAt.toISOString() }
      : {}),
  };
}

/** Never `tokenHash` — this DTO mapping is the one place that boundary is enforced by
 * construction (explicit field list, never a spread), same discipline ADR-0028 established. */
function toInvitationStatusResponse(invitation: InvitationRow): InvitationStatusResponseDto {
  const isStale = (invitation.status === 'pending' || invitation.status === 'sent') && invitation.expiresAt.getTime() <= Date.now();
  return {
    id: invitation.id,
    status: isStale ? 'expired' : invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    ...(invitation.sentAt ? { sentAt: invitation.sentAt.toISOString() } : {}),
    ...(invitation.acceptedAt ? { acceptedAt: invitation.acceptedAt.toISOString() } : {}),
    ...(invitation.revokedAt ? { revokedAt: invitation.revokedAt.toISOString() } : {}),
  };
}

/**
 * SuperAdmin-only (multi-tenancy.md#superadmin-vs-tenant) — every route is @PlatformOnly(),
 * TenantGuard-enforced (common/guards/tenant.guard.ts), never gated by the tenant RBAC
 * PermissionsGuard (§13: there is no tenant permission catalog entry for these routes, by design —
 * a tenant Administrador role can never be configured into platform access). `:tenantId` is a
 * genuine path parameter here (unlike every tenant-scoped controller in this codebase) because the
 * caller has no tenant of its own to scope to — this is the one controller in the API where that is
 * the correct, narrow exception, per multi-tenancy.md#administrative--cross-tenant-queries.
 */
@ApiTags('platform-administration')
@Controller('platform/tenants')
@PlatformOnly()
export class PlatformTenantsController {
  constructor(
    private readonly platformTenantsService: PlatformTenantsService,
    private readonly onboardingService: PlatformTenantOnboardingService,
  ) {}

  @Get()
  @ApiOkResponse({ type: PlatformTenantResponseDto, isArray: true })
  async list(): Promise<PlatformTenantResponseDto[]> {
    const tenants = await this.platformTenantsService.list();
    return tenants.map(toResponse);
  }

  @Get(':tenantId')
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  async getById(@Param('tenantId') tenantId: string): Promise<PlatformTenantResponseDto> {
    return toResponse(await this.platformTenantsService.getById(tenantId));
  }

  /** ADR-0036 — closes GAP-SA-CREATE-TENANT. Reuses `TenantProvisioningService` +
   * `IdentityProvisioningService` verbatim via `PlatformTenantOnboardingService`; never emits a
   * tenant session (the caller stays a platform admin, never becomes a tenant member — §1). */
  @Post()
  @ApiCreatedResponse({ type: PlatformTenantOnboardingResponseDto })
  async create(
    @Body() dto: CreatePlatformTenantDto,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<PlatformTenantOnboardingResponseDto> {
    const result = await this.onboardingService.createTenant(dto, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toOnboardingResponse(result);
  }

  @Get(':tenantId/admin-invitation')
  @ApiOkResponse({ type: InvitationStatusResponseDto })
  async getInvitationStatus(@Param('tenantId') tenantId: string): Promise<InvitationStatusResponseDto | null> {
    const invitation = await this.onboardingService.getInvitationStatus(tenantId);
    return invitation ? toInvitationStatusResponse(invitation) : null;
  }

  @Post(':tenantId/admin-invitation/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: InvitationStatusResponseDto })
  async resendInvitation(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<{ invitationUrl: string; expiresAt: string }> {
    const invitation = await this.onboardingService.resendInvitation(tenantId, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return { invitationUrl: buildInvitationUrl(invitation.rawToken), expiresAt: invitation.expiresAt.toISOString() };
  }

  @Post(':tenantId/admin-invitation/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: InvitationStatusResponseDto })
  async revokeInvitation(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<InvitationStatusResponseDto> {
    const invitation = await this.onboardingService.revokeInvitation(tenantId, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toInvitationStatusResponse(invitation);
  }

  @Post(':tenantId/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  async suspend(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<PlatformTenantResponseDto> {
    const tenant = await this.platformTenantsService.suspend(tenantId, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toResponse(tenant);
  }

  @Post(':tenantId/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: PlatformTenantResponseDto })
  async activate(
    @Param('tenantId') tenantId: string,
    @CurrentPlatformAdmin() principal: PlatformPrincipal,
    @Req() request: FastifyRequest,
  ): Promise<PlatformTenantResponseDto> {
    const tenant = await this.platformTenantsService.activate(tenantId, {
      actorId: principal.adminId,
      correlationId: request.correlationId,
      ipAddress: request.ip,
    });
    return toResponse(tenant);
  }
}
