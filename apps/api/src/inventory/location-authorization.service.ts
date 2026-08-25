import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { userLocationAssignments } from '../database/schema';
import type { TenantTransaction } from '../database/tenant-context';

/**
 * ADR-0024 / database.md#location-scoped-authorization's guard, deliberately deferred by FASE 7
 * ("this phase only manages the assignment data itself") and built now. A permission check
 * (RequirePermissions on the route) answers "can this user do this kind of thing at all" — this
 * answers "can this user do it *at this specific location*." Both are required; neither substitutes
 * for the other.
 *
 * Implemented as a plain injectable rather than a route guard: several FASE 8 operations (transfer
 * dispatch/receive) only know the target location after the entity (the transfer) has been loaded
 * and locked inside the service's own transaction — a route-level guard would have to re-derive that
 * same lookup from the raw, not-yet-validated request body ahead of the service, duplicating work and
 * losing the transaction/lock context. Called explicitly, at the point the target location is known,
 * by every FASE 8 write path that touches a specific physical location (adjustments, transfer
 * prepare/dispatch/receive).
 *
 * Default semantics per database.md#location-scoped-authorization: a user with zero
 * `user_location_assignments` rows is unrestricted (any location in the tenant); one or more rows
 * restricts them to exactly those locations.
 */
@Injectable()
export class LocationAuthorizationService {
  async assertAccess(tx: TenantTransaction, tenantId: string, userId: string, locationId: string): Promise<void> {
    const rows = await tx
      .select({ locationId: userLocationAssignments.locationId })
      .from(userLocationAssignments)
      .where(and(eq(userLocationAssignments.tenantId, tenantId), eq(userLocationAssignments.userId, userId)));

    if (rows.length === 0) {
      return;
    }
    const allowed = rows.some((row) => row.locationId === locationId);
    if (!allowed) {
      throw new ForbiddenException('You are not authorized to operate on this location.');
    }
  }
}
