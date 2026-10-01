import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlatformAuditLogService } from '../../common/audit/platform-audit-log.service';
import type { SupportSessionContext } from '../../common/context/request-context';
import { PlatformSupportRepository, type SupportUserRow, type SupportWarehouseRow } from './platform-support.repository';

export interface PlatformAuditMeta {
  actorId: string;
  correlationId: string | undefined;
  ipAddress: string | undefined;
}

/** ADR-0036 §9 — SUPPORT_READ (list users/warehouses) is unaudited (a read has nothing to record
 * a before/after for, same posture as every other GET in this codebase); SUPPORT_WRITE
 * (warehouse status) always writes an audit entry, including on a no-op (status unchanged), so a
 * "nothing happened" outcome is still traceable to who attempted what, when, why. */
@Injectable()
export class PlatformSupportService {
  private readonly logger = new Logger(PlatformSupportService.name);

  constructor(
    private readonly repository: PlatformSupportRepository,
    private readonly platformAuditLogService: PlatformAuditLogService,
  ) {}

  async listUsers(tenantId: string): Promise<SupportUserRow[]> {
    return this.repository.listUsers(tenantId);
  }

  async listWarehouses(tenantId: string): Promise<SupportWarehouseRow[]> {
    return this.repository.listWarehouses(tenantId);
  }

  async setWarehouseStatus(
    tenantId: string,
    warehouseId: string,
    status: 'active' | 'inactive',
    session: SupportSessionContext,
    meta: PlatformAuditMeta,
  ): Promise<SupportWarehouseRow> {
    const before = await this.repository.findWarehouseStatus(tenantId, warehouseId);
    if (before === undefined) {
      throw new NotFoundException('Warehouse not found.');
    }

    const updated = await this.repository.setWarehouseStatus(tenantId, warehouseId, status);
    if (!updated) {
      throw new NotFoundException('Warehouse not found.');
    }

    try {
      await this.platformAuditLogService.record({
        tenantId,
        actorId: meta.actorId,
        actionCode: 'support.warehouse_status_changed',
        entityType: 'warehouse',
        entityId: warehouseId,
        beforeState: { status: before },
        afterState: { status: updated.status, supportSessionId: session.supportSessionId, reason: session.reason },
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
    } catch (error) {
      this.logger.error(`Failed to write platform audit log for support.warehouse_status_changed (${warehouseId}): ${String(error)}`);
    }

    return updated;
  }
}
