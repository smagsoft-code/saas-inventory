import { Inject, Injectable } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { auditLog } from '../../database/schema';

export interface PlatformAuditEntryInput {
  /** The tenant a platform action targeted (e.g. suspending a specific company) — `undefined` for
   * an action with no single-tenant target. Written as `NULL`, database.md's documented shape for
   * a "SuperAdmin action not scoped to one tenant". */
  tenantId?: string | undefined;
  /** A `platform_admins.id` — audit_log.actor_type is set to `'platform_admin'` here, never
   * `'user'`, so a platform action can never be misread as a tenant user's own action. */
  actorId: string;
  actionCode: string;
  entityType: string;
  entityId: string;
  beforeState?: Record<string, unknown> | undefined;
  afterState?: Record<string, unknown> | undefined;
  correlationId?: string | undefined;
  ipAddress?: string | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The platform-side counterpart to common/audit/audit-log.service.ts — same `audit_log` table,
 * same append-only write-only contract, but through the `app_platform` connection (BYPASSRLS)
 * instead of a tenant transaction, since a platform action has no `app.tenant_id` to `SET LOCAL`
 * (and, for tenant_id === undefined, no tenant row at all to attribute the write to). Required a
 * real, necessary grant this phase adds (migration 0022): `app_platform` previously had SELECT-only
 * on `audit_log` (migration 0002) because no platform-level write path existed yet — see
 * multi-tenancy.md#superadmin-vs-tenant's "SuperAdmin actions are audited the same as tenant
 * actions."
 */
@Injectable()
export class PlatformAuditLogService {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async record(entry: PlatformAuditEntryInput): Promise<void> {
    await this.platformDb.insert(auditLog).values({
      id: generateId(),
      tenantId: entry.tenantId ?? null,
      actorType: 'platform_admin',
      actorId: entry.actorId,
      actionCode: entry.actionCode,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeState: entry.beforeState ?? null,
      afterState: entry.afterState ?? null,
      correlationId: entry.correlationId && UUID_PATTERN.test(entry.correlationId) ? entry.correlationId : null,
      ipAddress: entry.ipAddress ?? null,
    });
  }
}
