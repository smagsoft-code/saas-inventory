import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { UsersRepository } from '../../auth/repositories/users.repository';
import { withTenantTransaction } from '../../database/tenant-context';
import type { AuditMeta } from '../inventory-audit-meta';
import { LocationsRepository } from '../repositories/locations.repository';
import { UserLocationAssignmentsRepository } from '../repositories/user-location-assignments.repository';
import type { SetUserLocationsDto } from './dto/set-user-locations.dto';
import type { UserLocationResponseDto } from './dto/user-location-response.dto';

/**
 * ADR-0024's `user_location_assignments` join table, managed here rather than in
 * core/users/ — INVENTORY owns the table (modules.md#inventory), CORE never depends on INVENTORY
 * (modules.md's dependency rule), even though the permission gating this is named
 * `core.users.locations.manage` (a semantic action name, not a module-placement rule). Every method
 * runs inside `withTenantTransaction`, same convention as the rest of this module.
 */
@Injectable()
export class LocationAssignmentsService {
  constructor(
    private readonly userLocationAssignmentsRepository: UserLocationAssignmentsRepository,
    private readonly locationsRepository: LocationsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, userId: string): Promise<UserLocationResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, tenantId, userId);
      if (!user) {
        throw new NotFoundException('User not found.');
      }
      const rows = await this.userLocationAssignmentsRepository.listByUser(tx, tenantId, userId);
      return rows.map((row) => ({
        locationId: row.locationId,
        assignedAt: row.assignedAt.toISOString(),
        assignedBy: row.assignedBy ?? undefined,
      }));
    });
  }

  async replace(
    tenantId: string,
    actorId: string,
    userId: string,
    dto: SetUserLocationsDto,
    meta: AuditMeta,
  ): Promise<UserLocationResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, tenantId, userId);
      if (!user) {
        throw new NotFoundException('User not found.');
      }

      for (const locationId of dto.locationIds) {
        const location = await this.locationsRepository.findById(tx, tenantId, locationId);
        if (!location) {
          throw new NotFoundException(`Location "${locationId}" not found.`);
        }
      }

      const rows = await this.userLocationAssignmentsRepository.replaceForUser(tx, tenantId, userId, dto.locationIds, actorId);

      try {
        await this.auditLogService.record(tx, {
          tenantId,
          actorId,
          actionCode: 'user_location_assignments.replaced',
          entityType: 'user',
          entityId: userId,
          afterState: { locationIds: dto.locationIds },
          correlationId: meta.correlationId,
          ipAddress: meta.ipAddress,
        });
      } catch {
        // Best-effort — an audit write failure must never block the primary operation, same
        // convention as catalog/categories/categories.service.ts's writeAudit().
      }

      return rows.map((row) => ({
        locationId: row.locationId,
        assignedAt: row.assignedAt.toISOString(),
        assignedBy: row.assignedBy ?? undefined,
      }));
    });
  }
}
