import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { AUTH_CONFIG, type AuthConfig } from '../../common/config/auth-config';
import { PlatformAuditLogService } from '../../common/audit/platform-audit-log.service';
import { TenantsPlatformRepository } from '../../auth/repositories/tenants-platform.repository';
import { PlatformSupportSessionsRepository, type SupportSessionMode, type SupportSessionRow } from '../../auth/repositories/platform-support-sessions.repository';

export interface PlatformAuditMeta {
  actorId: string;
  correlationId: string | undefined;
  ipAddress: string | undefined;
}

/**
 * ADR-0036 §8-14 — "Tenant Support". A support session is a temporary, tenant-scoped, audited
 * window; the Platform Admin never becomes a member of the tenant, never receives a tenant
 * session/JWT, and the actor recorded everywhere is always the platform admin (ADR-0032's
 * `platformPrincipal`), never a tenant `users.id` — there is no "phantom admin" account anywhere
 * in this flow (§1/§25 of the prompt).
 */
@Injectable()
export class PlatformSupportSessionsService {
  private readonly logger = new Logger(PlatformSupportSessionsService.name);

  constructor(
    private readonly sessionsRepository: PlatformSupportSessionsRepository,
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
    private readonly platformAuditLogService: PlatformAuditLogService,
    @Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig,
  ) {}

  async start(
    tenantId: string,
    mode: SupportSessionMode,
    reason: string,
    meta: PlatformAuditMeta,
  ): Promise<SupportSessionRow> {
    const tenant = await this.tenantsPlatformRepository.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }

    // §17 of the prompt: one live support context per platform admin. Superseding (not rejecting)
    // an existing session on a DIFFERENT tenant is a deliberate UX choice — the alternative (force
    // the admin to end it manually first) adds a step with no security benefit, since the DB
    // partial unique index already guarantees only one `active` row can ever exist regardless.
    const previous = await this.sessionsRepository.endActiveForAdmin(meta.actorId);
    if (previous) {
      await this.writeAudit({
        tenantId: previous.tenantId,
        actorId: meta.actorId,
        actionCode: 'support_session.ended',
        entityId: previous.id,
        beforeState: { status: 'active' },
        afterState: { status: 'ended', reason: 'superseded_by_new_session' },
        meta,
      });
    }

    const session = await this.sessionsRepository.create({
      id: generateId(),
      platformAdminId: meta.actorId,
      tenantId,
      mode,
      reason,
      expiresAt: new Date(Date.now() + this.authConfig.supportSessionTtlSeconds * 1000),
    });

    await this.writeAudit({
      tenantId,
      actorId: meta.actorId,
      actionCode: 'support_session.started',
      entityId: session.id,
      afterState: { mode, reason, expiresAt: session.expiresAt.toISOString() },
      meta,
    });

    return session;
  }

  async endCurrent(meta: PlatformAuditMeta): Promise<SupportSessionRow | undefined> {
    const ended = await this.sessionsRepository.endActiveForAdmin(meta.actorId);
    if (ended) {
      await this.writeAudit({
        tenantId: ended.tenantId,
        actorId: meta.actorId,
        actionCode: 'support_session.ended',
        entityId: ended.id,
        beforeState: { status: 'active' },
        afterState: { status: 'ended', reason: 'admin_exit' },
        meta,
      });
    }
    return ended;
  }

  /** `GET .../current` — also the opportunistic point that converges a stale `active` row (past
   * its `expires_at`) to `expired`, so the frontend banner/countdown and any later audit read see
   * a status that matches reality without needing a cron. */
  async getCurrent(platformAdminId: string): Promise<SupportSessionRow | undefined> {
    await this.sessionsRepository.markExpiredIfStale(platformAdminId);
    return this.sessionsRepository.findActiveForAdmin(platformAdminId);
  }

  private async writeAudit(input: {
    tenantId: string;
    actorId: string;
    actionCode: string;
    entityId: string;
    beforeState?: Record<string, unknown>;
    afterState?: Record<string, unknown>;
    meta: PlatformAuditMeta;
  }): Promise<void> {
    try {
      await this.platformAuditLogService.record({
        tenantId: input.tenantId,
        actorId: input.actorId,
        actionCode: input.actionCode,
        entityType: 'support_session',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch (error) {
      this.logger.error(`Failed to write platform audit log for ${input.actionCode} (${input.entityId}): ${String(error)}`);
    }
  }
}
