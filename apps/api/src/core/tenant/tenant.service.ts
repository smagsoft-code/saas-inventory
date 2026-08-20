import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction } from '../../database/tenant-context';
import { TenantsPlatformRepository, type TenantRow } from '../../auth/repositories/tenants-platform.repository';
import type { UpdateTenantDto } from './dto/update-tenant.dto';

export interface AuditMeta {
  actorId: string;
  correlationId: string | undefined;
  ipAddress: string | undefined;
}

/**
 * Self-administration of the caller's own tenant (§7 — GET/PATCH /tenant). `tenantId` is always
 * the value TenantGuard resolved from the verified access token (CurrentTenant), never anything
 * client-supplied — this service has no code path that accepts a tenant id as an argument coming
 * from request input.
 */
@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private readonly tenantsPlatformRepository: TenantsPlatformRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async getCurrent(tenantId: string): Promise<TenantRow> {
    const tenant = await this.tenantsPlatformRepository.findById(tenantId);
    if (!tenant) {
      // Structurally unreachable in practice — TenantGuard already resolved this tenantId from a
      // verified token — but a repository method still declares its honest return type.
      throw new NotFoundException('Tenant not found.');
    }
    return tenant;
  }

  async updateCurrent(tenantId: string, dto: UpdateTenantDto, meta: AuditMeta): Promise<TenantRow> {
    const before = await this.getCurrent(tenantId);
    const updated = await this.tenantsPlatformRepository.updateName(tenantId, dto.name);

    try {
      await withTenantTransaction(tenantId, (tx) =>
        this.auditLogService.record(tx, {
          tenantId,
          actorId: meta.actorId,
          actionCode: 'tenant.updated',
          entityType: 'tenant',
          entityId: tenantId,
          beforeState: { name: before.name },
          afterState: { name: updated.name },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        }),
      );
    } catch (error) {
      // The tenant update itself already succeeded — an audit-write failure is logged, not
      // surfaced as a failed request (§26: audit is "prepared for," not a transactional
      // co-requirement of every write in this phase).
      this.logger.error(`Failed to write audit log for tenant.updated (${tenantId}): ${String(error)}`);
    }

    return updated;
  }
}
