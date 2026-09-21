import { ForbiddenException, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { roles, userLocationAssignments, userRoles } from '../database/schema';
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
 * **ADR-0035** (supersedes ADR-0024's original default): a `user_location_assignments` row is now
 * required — zero rows denies, it does not mean unrestricted — with one narrow, explicit exception:
 * a caller currently holding the tenant's founding, system-default "Administrador" role
 * (`roles.name = 'Administrador' AND roles.is_system_default = true`) is always allowed, regardless
 * of assignment rows. That exception exists solely to avoid a bootstrap deadlock — a freshly
 * registered tenant has zero warehouses/locations, so its founding admin could never receive the
 * first stock if they also needed a pre-existing assignment. See ADR-0035 for the full rationale,
 * including the deliberately accepted fragility (renaming that role away from the literal string
 * "Administrador" loses the exception for whoever holds it).
 */
@Injectable()
export class LocationAuthorizationService {
  async assertAccess(tx: TenantTransaction, tenantId: string, userId: string, locationId: string): Promise<void> {
    if (await this.isFoundingAdministrador(tx, tenantId, userId)) {
      return;
    }

    const rows = await tx
      .select({ locationId: userLocationAssignments.locationId })
      .from(userLocationAssignments)
      .where(and(eq(userLocationAssignments.tenantId, tenantId), eq(userLocationAssignments.userId, userId)));

    const allowed = rows.some((row) => row.locationId === locationId);
    if (!allowed) {
      throw new ForbiddenException('You are not authorized to operate on this location.');
    }
  }

  /** ADR-0035's bootstrap exception — checked live against `user_roles`/`roles` on every call,
   * never cached. Keyed to the fixed role name `tenant-provisioning.service.ts`'s `ADMIN_ROLE_NAME`
   * constant already uses for "the role a fresh tenant's founding user gets", combined with
   * `is_system_default` so a tenant-created custom role named "Administrador" never qualifies. */
  private async isFoundingAdministrador(tx: TenantTransaction, tenantId: string, userId: string): Promise<boolean> {
    const rows = await tx
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), eq(roles.tenantId, tenantId)))
      .where(
        and(
          eq(userRoles.tenantId, tenantId),
          eq(userRoles.userId, userId),
          eq(roles.name, 'Administrador'),
          eq(roles.isSystemDefault, true),
        ),
      );
    return rows.length > 0;
  }
}
