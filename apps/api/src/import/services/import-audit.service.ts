import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import type { TenantTransaction } from '../../database/tenant-context';
import type { ImportJobRow, ImportJobStatus } from '../repositories/import-jobs.repository';
import { TERMINAL_STATUSES } from '../import-job-state-machine';

const ACTION_CODES: Partial<Record<ImportJobStatus, string>> = {
  completed: 'INVENTORY_IMPORT_COMPLETED',
  completed_with_errors: 'INVENTORY_IMPORT_COMPLETED_WITH_ERRORS',
  failed: 'INVENTORY_IMPORT_FAILED',
  cancelled: 'INVENTORY_IMPORT_CANCELLED',
};

/**
 * §27 — "en estados terminales... debe existir la auditoria requerida". Shared by
 * ImportJobService (the synchronous path and cancel) and ImportWorkerService (the async path), so
 * a job's terminal audit entry is written exactly once, regardless of which path finished it.
 */
@Injectable()
export class ImportAuditService {
  constructor(private readonly auditLogService: AuditLogService) {}

  async recordTerminalState(tx: TenantTransaction, tenantId: string, job: ImportJobRow, status: ImportJobStatus): Promise<void> {
    if (!TERMINAL_STATUSES.includes(status)) return;
    const actionCode = ACTION_CODES[status];
    if (!actionCode) return;
    try {
      await this.auditLogService.record(tx, {
        tenantId,
        actorId: job.createdBy,
        actionCode,
        entityType: 'import_job',
        entityId: job.id,
        afterState: {
          status,
          totalRows: job.totalRows,
          validRows: job.validRows,
          invalidRows: job.invalidRows,
          warningRows: job.warningRows,
          importedRows: job.importedRows,
        },
        correlationId: undefined,
        ipAddress: undefined,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation.
    }
  }
}
