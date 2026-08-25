import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TenantsPlatformRepository, type TenantRow } from '../../auth/repositories/tenants-platform.repository';
import { PlatformAuditLogService } from '../../common/audit/platform-audit-log.service';

export interface PlatformAuditMeta {
  actorId: string;
  correlationId: string | undefined;
  ipAddress: string | undefined;
}

/**
 * SuperAdmin tenant-lifecycle management (multi-tenancy.md's "list companies, ...
 * activate/deactivate a company" capability) — reuses TenantsPlatformRepository (the same
 * repository CORE's own tenant self-administration and AUTH's registration already use), never a
 * second `tenants`-table repository (§6/§26 of this phase: ADMINISTRATION does not duplicate
 * CORE's ownership of the tenant record, it only adds the one platform-only mutation — status —
 * that CORE deliberately never exposed to a tenant's own self-edit).
 */
@Injectable()
export class PlatformTenantsService {
  private readonly logger = new Logger(PlatformTenantsService.name);

  constructor(
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
    private readonly platformAuditLogService: PlatformAuditLogService,
  ) {}

  async list(): Promise<TenantRow[]> {
    return this.tenantsPlatformRepository.list();
  }

  async getById(tenantId: string): Promise<TenantRow> {
    const tenant = await this.tenantsPlatformRepository.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }
    return tenant;
  }

  async suspend(tenantId: string, meta: PlatformAuditMeta): Promise<TenantRow> {
    return this.setStatus(tenantId, 'suspended', 'tenant.suspended', meta);
  }

  async activate(tenantId: string, meta: PlatformAuditMeta): Promise<TenantRow> {
    return this.setStatus(tenantId, 'active', 'tenant.activated', meta);
  }

  private async setStatus(
    tenantId: string,
    status: 'active' | 'suspended',
    actionCode: string,
    meta: PlatformAuditMeta,
  ): Promise<TenantRow> {
    const before = await this.getById(tenantId);
    const updated = await this.tenantsPlatformRepository.setStatus(tenantId, status);

    if (before.status !== updated.status) {
      try {
        await this.platformAuditLogService.record({
          tenantId,
          actorId: meta.actorId,
          actionCode,
          entityType: 'tenant',
          entityId: tenantId,
          beforeState: { status: before.status },
          afterState: { status: updated.status },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
      } catch (error) {
        this.logger.error(`Failed to write platform audit log for ${actionCode} (${tenantId}): ${String(error)}`);
      }
    }

    return updated;
  }
}
