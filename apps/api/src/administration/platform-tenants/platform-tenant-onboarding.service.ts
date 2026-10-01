import { randomBytes } from 'node:crypto';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { getOptionalEnvVar } from '@saas-inventory/config';
import { generateId } from '@saas-inventory/shared';
import { withTenantTransaction } from '../../database/tenant-context';
import { PlatformAuditLogService } from '../../common/audit/platform-audit-log.service';
import { IdentityProvisioningService } from '../../auth/services/identity-provisioning.service';
import { TenantProvisioningService } from '../../auth/services/tenant-provisioning.service';
import { InvitationTokenService } from '../../auth/tokens/invitation-token.service';
import { TenantAdminInvitationsRepository, type InvitationRow } from '../../auth/repositories/tenant-admin-invitations.repository';
import { TenantsPlatformRepository, type TenantRow } from '../../auth/repositories/tenants-platform.repository';
import { UsersRepository } from '../../auth/repositories/users.repository';
import type { CreatePlatformTenantDto } from './dto/create-platform-tenant.dto';

export interface PlatformAuditMeta {
  actorId: string;
  correlationId: string | undefined;
  ipAddress: string | undefined;
}

export interface OnboardingResult {
  tenant: TenantRow;
  admin: { id: string; email: string; fullName: string };
  identityReused: boolean;
  invitation?: { rawToken: string; expiresAt: Date };
}

/** Never a real credential — `users.password_hash` is unread by the current auth flow
 * (`identities.password_hash` is what login checks), but the column is NOT NULL, so a
 * structurally valid, non-guessable placeholder satisfies it without asserting a hashing
 * algorithm this code path never runs. Same exact convention as `database/seeds/demo-tenant.ts`'s
 * `generatePlaceholderPasswordHash`. */
function placeholderPasswordHash(): string {
  return `unset:${randomBytes(32).toString('hex')}`;
}

/**
 * ADR-0036 — the SuperAdmin-facing orchestrator for "Tenant Onboarding". A thin facade: every step
 * reuses an existing service/repository verbatim (`TenantProvisioningService`,
 * `IdentityProvisioningService`, `TenantsPlatformRepository`, `UsersRepository`) — this class adds
 * no domain logic of its own beyond sequencing them and compensating on the identity-status branch
 * `/auth/register` and `POST /users` don't have to consider (they always supply a real password,
 * so their identity is always freshly-created-`active` or already-`active` — never
 * `pending_credential`/`disabled`).
 */
@Injectable()
export class PlatformTenantOnboardingService {
  private readonly logger = new Logger(PlatformTenantOnboardingService.name);

  constructor(
    private readonly tenantProvisioningService: TenantProvisioningService,
    private readonly identityProvisioningService: IdentityProvisioningService,
    private readonly invitationsRepository: TenantAdminInvitationsRepository,
    private readonly invitationTokenService: InvitationTokenService,
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
    private readonly usersRepository: UsersRepository,
    private readonly platformAuditLogService: PlatformAuditLogService,
  ) {}

  async createTenant(dto: CreatePlatformTenantDto, meta: PlatformAuditMeta): Promise<OnboardingResult> {
    // Step 1: tenant + roles + user — TenantProvisioningService verbatim (never reimplemented).
    // No real password exists yet, so a throwaway, unusable hash satisfies the NOT NULL column
    // that the current auth flow never reads for a SuperAdmin-provisioned admin.
    const { tenantId, userId } = await this.tenantProvisioningService.provision({
      companyName: dto.companyName,
      adminEmail: dto.adminEmail,
      adminPasswordHash: placeholderPasswordHash(),
      adminFullName: dto.adminFullName,
    });

    try {
      // Step 2: resolve the identity WITHOUT creating a membership yet — ADR-0036 §4's three-way
      // branch (active / pending_credential / disabled) must be decided before anything tenant-
      // linking happens.
      const { identityId, status } = await this.identityProvisioningService.resolveOrCreatePendingIdentity(
        dto.adminEmail,
        dto.adminFullName,
      );

      if (status === 'disabled') {
        // Never silently provision an unreachable admin (the exact risk the pre-implementation
        // audit flagged) — refuse and compensate the tenant/user already created in step 1.
        await this.compensate(tenantId, userId);
        throw new ConflictException(
          'The admin email belongs to a global identity that is currently disabled. It cannot be used to provision a new tenant admin until a platform admin re-enables it.',
        );
      }

      // Step 3: link the membership now that the identity is known-usable.
      await this.identityProvisioningService.linkMembership({ tenantId, userId, identityId });

      const tenant = await this.tenantsPlatformRepository.findById(tenantId);
      if (!tenant) {
        throw new Error('Tenant not found immediately after provisioning it.');
      }

      await this.writeAudit(tenantId, meta, 'tenant.created', 'tenant', tenantId, undefined, { name: tenant.name, slug: tenant.slug });
      await this.writeAudit(tenantId, meta, 'tenant_admin.provisioned', 'user', userId, undefined, {
        email: dto.adminEmail,
        identityReused: status === 'active',
      });

      if (status === 'active') {
        // ADR-0036 §4: an already-active identity needs no invitation — it already has a working
        // credential, and the membership just created is immediately usable.
        return { tenant, admin: { id: userId, email: dto.adminEmail, fullName: dto.adminFullName }, identityReused: true };
      }

      // status === 'pending_credential' (new or pre-existing): issue an invitation.
      const invitation = await this.issueInvitation(tenantId, identityId, userId, meta);
      return {
        tenant,
        admin: { id: userId, email: dto.adminEmail, fullName: dto.adminFullName },
        identityReused: false,
        invitation,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      await this.compensate(tenantId, userId);
      throw error;
    }
  }

  async resendInvitation(tenantId: string, meta: PlatformAuditMeta): Promise<{ rawToken: string; expiresAt: Date }> {
    const latest = await this.invitationsRepository.findLatestForTenant(tenantId);
    if (!latest) {
      throw new NotFoundException('No invitation exists for this tenant’s admin.');
    }
    if (latest.status === 'accepted') {
      throw new ConflictException('This invitation was already accepted — the admin already has a working credential.');
    }
    if (['pending', 'sent'].includes(latest.status)) {
      await this.invitationsRepository.revoke(latest.id);
    }
    const invitation = await this.issueInvitation(tenantId, latest.identityId, latest.userId, meta, 'tenant_admin.invitation_resent');
    return invitation;
  }

  async revokeInvitation(tenantId: string, meta: PlatformAuditMeta): Promise<InvitationRow> {
    const latest = await this.invitationsRepository.findLatestForTenant(tenantId);
    if (!latest || !['pending', 'sent'].includes(latest.status)) {
      throw new NotFoundException('No live invitation to revoke for this tenant’s admin.');
    }
    const revoked = await this.invitationsRepository.revoke(latest.id);
    if (!revoked) {
      throw new ConflictException('The invitation was no longer live — someone else may have just accepted, resent, or revoked it.');
    }
    await this.writeAudit(tenantId, meta, 'tenant_admin.invitation_revoked', 'tenant_admin_invitation', revoked.id, { status: latest.status }, { status: 'revoked' });
    return revoked;
  }

  async getInvitationStatus(tenantId: string): Promise<InvitationRow | undefined> {
    return this.invitationsRepository.findLatestForTenant(tenantId);
  }

  private async issueInvitation(
    tenantId: string,
    identityId: string,
    userId: string,
    meta: PlatformAuditMeta,
    actionCode: 'tenant_admin.invitation_sent' | 'tenant_admin.invitation_resent' = 'tenant_admin.invitation_sent',
  ): Promise<{ rawToken: string; expiresAt: Date }> {
    const generated = this.invitationTokenService.generate();
    const invitation = await this.invitationsRepository.create({
      id: generateId(),
      tenantId,
      identityId,
      userId,
      tokenHash: generated.tokenHash,
      createdBy: meta.actorId,
      expiresAt: generated.expiresAt,
    });
    await this.writeAudit(tenantId, meta, actionCode, 'tenant_admin_invitation', invitation.id, undefined, {
      expiresAt: generated.expiresAt.toISOString(),
      // Never the token itself — only that one was issued and when it expires.
    });
    return { rawToken: generated.token, expiresAt: generated.expiresAt };
  }

  /** Mirrors `TenantProvisioningService`'s own compensation (mark the tenant `suspended`, never
   * hard-delete) PLUS `UsersService.create`'s compensation (soft-delete the orphaned `users` row)
   * — combined here because this orchestration can fail one step later than either of those two
   * existing callers ever does. */
  private async compensate(tenantId: string, userId: string): Promise<void> {
    await this.tenantsPlatformRepository.markSuspended(tenantId).catch((error: unknown) => {
      this.logger.error(`Compensating suspend for tenant ${tenantId} failed: ${String(error)}`);
    });
    await withTenantTransaction(tenantId, (tx) => this.usersRepository.softDelete(tx, tenantId, userId)).catch((error: unknown) => {
      this.logger.error(`Compensating soft-delete for user ${userId} failed: ${String(error)}`);
    });
  }

  private async writeAudit(
    tenantId: string,
    meta: PlatformAuditMeta,
    actionCode: string,
    entityType: string,
    entityId: string,
    beforeState: Record<string, unknown> | undefined,
    afterState: Record<string, unknown> | undefined,
  ): Promise<void> {
    try {
      await this.platformAuditLogService.record({
        tenantId,
        actorId: meta.actorId,
        actionCode,
        entityType,
        entityId,
        beforeState,
        afterState,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
    } catch (error) {
      this.logger.error(`Failed to write platform audit log for ${actionCode} (${entityId}): ${String(error)}`);
    }
  }
}

/** `${APP_URL}/accept-invitation/${token}` — the one place this link shape is constructed, so the
 * frontend route and this stay in sync by construction. `APP_URL` already exists (.env.example)
 * as "the application's own base URL"; no new config surface. */
export function buildInvitationUrl(rawToken: string): string {
  const appUrl = getOptionalEnvVar('APP_URL', 'http://localhost:3000').replace(/\/$/, '');
  return `${appUrl}/accept-invitation/${rawToken}`;
}
