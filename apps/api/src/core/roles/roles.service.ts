import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { RolesRepository, type RoleWithPermissions } from '../../auth/repositories/roles.repository';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { RoleResponseDto } from './dto/role-response.dto';
import type { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';

export interface AuditMeta {
  correlationId: string | undefined;
  ipAddress: string | undefined;
}

interface UniqueViolation {
  code: string;
}

function hasUniqueViolationCode(error: unknown): error is UniqueViolation {
  return typeof error === 'object' && error !== null && 'code' in error && (error as UniqueViolation).code === '23505';
}

/** Same unwrap as UsersService/ProductsService/etc. — drizzle-orm's postgres-js driver wraps the
 * raw Postgres error (with `.code`) inside `DrizzleQueryError.cause`, never throws it directly. */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  return error instanceof Error && hasUniqueViolationCode(error.cause);
}

function toResponse(role: RoleWithPermissions, isAssignedToCaller: boolean): RoleResponseDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? undefined,
    isSystemDefault: role.isSystemDefault,
    permissionCodes: role.permissionCodes,
    isAssignedToCaller,
  };
}

/**
 * ROLES/PERMISSIONS block — custom role CRUD (closes `GAP-ROLE-CRUD`). Gated by `core.roles.manage`
 * at the route level (a single flat permission, same "do not fragment the catalog" precedent
 * ADR-0031 already applied to `core.roles.assign`). `is_system_default` stays "a label, not a
 * protection mechanism" (database.md#rbac-roles-permissions) — a predefined role can be renamed,
 * have its permissions changed, or be deleted exactly like a custom one; the only backend-enforced
 * restrictions are ADR-0034's self-escalation block (below) and the delete-in-use guard, neither of
 * which cares about `isSystemDefault`.
 */
@Injectable()
export class RolesService {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    private readonly rolesRepository: RolesRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, actorId: string): Promise<RoleResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const [roles, ownRoleIds] = await Promise.all([
        this.rolesRepository.listByTenant(tx, tenantId),
        this.rolesRepository.roleIdsForUser(tx, tenantId, actorId),
      ]);
      return roles.map((role) => toResponse(role, ownRoleIds.includes(role.id)));
    });
  }

  async getById(tenantId: string, actorId: string, roleId: string): Promise<RoleResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const role = await this.loadWithPermissions(tx, tenantId, roleId);
      const ownRoleIds = await this.rolesRepository.roleIdsForUser(tx, tenantId, actorId);
      return toResponse(role, ownRoleIds.includes(roleId));
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateRoleDto, meta: AuditMeta): Promise<RoleResponseDto> {
    const codes = dto.permissionCodes ?? [];
    return withTenantTransaction(tenantId, async (tx) => {
      await this.assertKnownPermissionCodes(tx, codes);

      let created;
      try {
        created = await this.rolesRepository.create(tx, {
          id: generateId(),
          tenantId,
          name: dto.name,
          description: dto.description,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A role with this name already exists.');
        }
        throw error;
      }

      if (codes.length > 0) {
        await this.rolesRepository.replacePermissions(tx, tenantId, created.id, codes);
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'role.created',
        entityId: created.id,
        afterState: { name: created.name, description: created.description, permissionCodes: codes },
        meta,
      });

      // A role a caller just created is never one they are already assigned to.
      return toResponse({ ...created, permissionCodes: codes }, false);
    });
  }

  /** Name/description only. Deliberately allowed on the caller's own currently-assigned role —
   * ADR-0034 blocks permission changes, never renaming/describing (renaming a role you hold cannot
   * grant yourself anything). */
  async update(tenantId: string, actorId: string, roleId: string, dto: UpdateRoleDto, meta: AuditMeta): Promise<RoleResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.loadWithPermissions(tx, tenantId, roleId);

      let updated;
      try {
        updated = await this.rolesRepository.updateProfile(tx, tenantId, roleId, {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A role with this name already exists.');
        }
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('Role not found.');
      }

      if ((dto.name !== undefined && dto.name !== before.name) || (dto.description !== undefined && dto.description !== before.description)) {
        await this.writeAudit(tx, {
          tenantId,
          actorId,
          actionCode: 'role.updated',
          entityId: roleId,
          beforeState: { name: before.name, description: before.description },
          afterState: { name: updated.name, description: updated.description },
          meta,
        });
      }

      const ownRoleIds = await this.rolesRepository.roleIdsForUser(tx, tenantId, actorId);
      return toResponse({ ...updated, permissionCodes: before.permissionCodes }, ownRoleIds.includes(roleId));
    });
  }

  /** ADR-0034: a caller can never replace the permission set of a role currently assigned to
   * themselves — checked live against `user_roles` on every call, independent of whatever
   * permissions they hold (`core.roles.manage` included). Editing OTHER roles' permissions is
   * unrestricted beyond the route-level `core.roles.manage` gate. */
  async setPermissions(
    tenantId: string,
    actorId: string,
    roleId: string,
    dto: SetRolePermissionsDto,
    meta: AuditMeta,
  ): Promise<RoleResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.loadWithPermissions(tx, tenantId, roleId);

      const ownRoleIds = await this.rolesRepository.roleIdsForUser(tx, tenantId, actorId);
      if (ownRoleIds.includes(roleId)) {
        throw new ForbiddenException({
          code: 'ROLE_SELF_PERMISSION_ESCALATION',
          message: 'You cannot modify the permissions of a role currently assigned to yourself.',
        });
      }

      await this.assertKnownPermissionCodes(tx, dto.permissionCodes);
      await this.rolesRepository.replacePermissions(tx, tenantId, roleId, dto.permissionCodes);

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'role.permissions_changed',
        entityId: roleId,
        beforeState: { permissionCodes: before.permissionCodes },
        afterState: { permissionCodes: dto.permissionCodes },
        meta,
      });

      // ownRoleIds above already proved roleId is NOT one of the caller's own roles (or we'd have
      // thrown) — isAssignedToCaller is always false on this success path.
      return toResponse({ ...before, permissionCodes: dto.permissionCodes }, false);
    });
  }

  /** Soft-delete, blocked (409) while 1+ users still hold the role — the admin reassigns them
   * first. This incidentally also stops a caller from deleting their own currently-assigned role,
   * without needing a separate ADR-0034-style check: they are themselves one of the "users
   * assigned" the guard counts. */
  async remove(tenantId: string, actorId: string, roleId: string, meta: AuditMeta): Promise<void> {
    return withTenantTransaction(tenantId, async (tx) => {
      const role = await this.rolesRepository.findById(tx, tenantId, roleId);
      if (!role) {
        throw new NotFoundException('Role not found.');
      }

      const assignedCount = await this.rolesRepository.countUsersAssigned(tx, tenantId, roleId);
      if (assignedCount > 0) {
        throw new ConflictException(`Cannot delete a role assigned to ${assignedCount} user(s). Reassign them first.`);
      }

      await this.rolesRepository.softDelete(tx, tenantId, roleId);

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'role.deleted',
        entityId: roleId,
        beforeState: { name: role.name },
        meta,
      });
    });
  }

  private async loadWithPermissions(tx: TenantTransaction, tenantId: string, roleId: string): Promise<RoleWithPermissions> {
    const role = await this.rolesRepository.findByIdWithPermissions(tx, tenantId, roleId);
    if (!role) {
      throw new NotFoundException('Role not found.');
    }
    return role;
  }

  private async assertKnownPermissionCodes(tx: TenantTransaction, codes: string[]): Promise<void> {
    const unknown = await this.rolesRepository.findUnknownPermissionCodes(tx, codes);
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown permission code(s): ${unknown.join(', ')}`);
    }
  }

  private async writeAudit(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      actorId: string;
      actionCode: string;
      entityId: string;
      beforeState?: Record<string, unknown>;
      afterState?: Record<string, unknown>;
      meta: AuditMeta;
    },
  ): Promise<void> {
    try {
      await this.auditLogService.record(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actionCode: input.actionCode,
        entityType: 'role',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for ${input.actionCode} (${input.entityId}): ${String(error)}`);
    }
  }
}
