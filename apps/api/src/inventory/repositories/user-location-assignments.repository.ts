import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { userLocationAssignments } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface UserLocationAssignmentRow {
  tenantId: string;
  userId: string;
  locationId: string;
  assignedAt: Date;
  assignedBy: string | null;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `user_location_assignments` — ADR-0024. Hard-deleted
 * on unassignment, same pattern as `user_roles`/`role_permissions` (database.md#soft-delete-policy),
 * so "replace" is delete-then-insert within the caller's transaction, never a soft update.
 */
@Injectable()
export class UserLocationAssignmentsRepository {
  async listByUser(tx: TenantTransaction, tenantId: string, userId: string): Promise<UserLocationAssignmentRow[]> {
    return tx
      .select()
      .from(userLocationAssignments)
      .where(and(eq(userLocationAssignments.tenantId, tenantId), eq(userLocationAssignments.userId, userId)));
  }

  async replaceForUser(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
    locationIds: string[],
    assignedBy: string,
  ): Promise<UserLocationAssignmentRow[]> {
    await tx
      .delete(userLocationAssignments)
      .where(and(eq(userLocationAssignments.tenantId, tenantId), eq(userLocationAssignments.userId, userId)));

    if (locationIds.length === 0) {
      return [];
    }

    return tx
      .insert(userLocationAssignments)
      .values(locationIds.map((locationId) => ({ tenantId, userId, locationId, assignedBy })))
      .returning();
  }
}
