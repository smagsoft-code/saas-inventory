import { Injectable } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { auditLog } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface AuditEntryInput {
  tenantId: string;
  actorId: string;
  actionCode: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown> | undefined;
  afterState?: Record<string, unknown> | undefined;
  correlationId?: string | undefined;
  ipAddress?: string | undefined;
}

/**
 * Minimal write-only wrapper around the existing, already-provisioned `audit_log` table
 * (schema/02-core.ts, RLS-enabled, tenant-owned, append-only — app_tenant has SELECT/INSERT only,
 * no UPDATE/DELETE grant). This is modules.md#core's "audit-write interface" CORE exposes to other
 * modules — not a new subsystem, just the one insert every sensitive administrative operation in
 * this phase (§26) needs. Runs inside the caller's already-open tenant transaction, same
 * convention as every other repository in this codebase.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class AuditLogService {
  async record(tx: TenantTransaction, entry: AuditEntryInput): Promise<void> {
    await tx.insert(auditLog).values({
      id: generateId(),
      tenantId: entry.tenantId,
      actorType: 'user',
      actorId: entry.actorId,
      actionCode: entry.actionCode,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeState: entry.beforeState ?? null,
      afterState: entry.afterState ?? null,
      // audit_log.correlation_id is a uuid column, but the correlation id on the request can be a
      // client-supplied header value of arbitrary shape (main.ts's registerCorrelationId doesn't
      // validate it) — write it only when it's actually UUID-shaped, so a garbage header can never
      // turn an audited admin action into a failed insert (denial of service via a malformed
      // header), never silently corrupting the rest of the write either.
      correlationId: entry.correlationId && UUID_PATTERN.test(entry.correlationId) ? entry.correlationId : null,
      ipAddress: entry.ipAddress ?? null,
    });
  }
}
