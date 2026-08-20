import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { UsersRepository, type UserListRow, type UserRow } from '../../auth/repositories/users.repository';
import { RolesRepository } from '../../auth/repositories/roles.repository';
import { PasswordService } from '../../auth/password/password.service';
import { normalizeEmail } from '../../auth/util/normalize';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { CreateUserDto } from './dto/create-user.dto';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UserResponseDto } from './dto/user-response.dto';

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

/** drizzle-orm's postgres-js driver never throws the raw `postgres` package error directly — it
 * wraps it as `DrizzleQueryError` with the original (which carries Postgres's `.code`, e.g.
 * '23505' unique_violation) on `.cause`, not on the thrown error itself (found running this
 * against real PostgreSQL, Prompt 05-B — checking `error.code` here always missed, silently
 * falling through to the generic 500 handler instead of the intended 409). */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  return error instanceof Error && hasUniqueViolationCode(error.cause);
}

function toResponse(user: UserRow | UserListRow, roleNames: string[]): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    status: user.status,
    roleNames,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : undefined,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Administration of users within the caller's own tenant (§10–§16, §21). Every method takes an
 * already-resolved `tenantId` (from CurrentTenant — never client input) and performs its work
 * inside `withTenantTransaction`, so RLS is a live backstop on every query here, not just the
 * repository-level tenant filter.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly rolesRepository: RolesRepository,
    private readonly passwordService: PasswordService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, query: ListUsersQueryDto): Promise<PaginatedResult<UserResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.usersRepository.findManyByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
      });
      const roleNamesByUser = await this.rolesRepository.roleNamesForUsers(
        tx,
        tenantId,
        rows.map((row) => row.id),
      );
      return {
        data: rows.map((row) => toResponse(row, roleNamesByUser.get(row.id) ?? [])),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async getById(tenantId: string, userId: string): Promise<UserResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const user = await this.usersRepository.findById(tx, tenantId, userId);
      if (!user) {
        // A foreign-tenant id resolves here identically to a nonexistent one (§12) — the WHERE
        // clause is tenant-scoped, backstopped by RLS, so there is no distinguishable code path
        // that would let a caller tell "wrong tenant" apart from "no such user".
        throw new NotFoundException('User not found.');
      }
      const roleNames = await this.rolesRepository.roleNamesForUsers(tx, tenantId, [userId]);
      return toResponse(user, roleNames.get(userId) ?? []);
    });
  }

  async create(
    tenantId: string,
    actorId: string,
    actorPermissions: string[],
    dto: CreateUserDto,
    meta: AuditMeta,
  ): Promise<UserResponseDto> {
    if (dto.roleId && !actorPermissions.includes('core.roles.assign')) {
      throw new ForbiddenException('Missing permission to assign a role.');
    }

    return withTenantTransaction(tenantId, async (tx) => {
      let role: { id: string; name: string } | undefined;
      if (dto.roleId) {
        role = await this.rolesRepository.findById(tx, tenantId, dto.roleId);
        if (!role) {
          // Deliberately not distinguishing "no such role" from "that role belongs to another
          // tenant" — RolesRepository.findById is already tenant-scoped, so both look identical
          // here, same generic-error posture as everywhere else cross-tenant ids are rejected.
          throw new NotFoundException('Role not found.');
        }
      }

      const passwordHash = await this.passwordService.hash(dto.password);
      let created: UserRow;
      try {
        created = await this.usersRepository.create(tx, {
          id: generateId(),
          tenantId,
          email: normalizeEmail(dto.email),
          passwordHash,
          fullName: dto.fullName,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A user with this email already exists.');
        }
        throw error;
      }

      if (role) {
        await this.rolesRepository.setUserRole(tx, tenantId, created.id, role.id, actorId);
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'user.created',
        entityId: created.id,
        afterState: { email: created.email, fullName: created.fullName, roleId: role?.id ?? null },
        meta,
      });

      return toResponse(created, role ? [role.name] : []);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    actorPermissions: string[],
    targetUserId: string,
    dto: UpdateUserDto,
    meta: AuditMeta,
  ): Promise<UserResponseDto> {
    const isSelf = actorId === targetUserId;

    // §16/§21: self-administration never extends to security-relevant fields, independent of
    // whatever permissions the caller happens to hold — this is a structural block, not a
    // permission check that a sufficiently-privileged actor could pass.
    if (isSelf && (dto.status !== undefined || dto.roleId !== undefined)) {
      throw new ForbiddenException('You cannot change your own status or role.');
    }
    if (dto.roleId !== undefined && !actorPermissions.includes('core.roles.assign')) {
      throw new ForbiddenException('Missing permission to assign a role.');
    }

    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.usersRepository.findById(tx, tenantId, targetUserId);
      if (!before) {
        throw new NotFoundException('User not found.');
      }

      let role: { id: string; name: string } | undefined;
      if (dto.roleId !== undefined) {
        role = await this.rolesRepository.findById(tx, tenantId, dto.roleId);
        if (!role) {
          throw new NotFoundException('Role not found.');
        }
      }

      const updated =
        dto.fullName !== undefined || dto.status !== undefined
          ? await this.usersRepository.updateProfile(tx, tenantId, targetUserId, {
              ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
              ...(dto.status !== undefined ? { status: dto.status } : {}),
            })
          : before;
      if (!updated) {
        throw new NotFoundException('User not found.');
      }

      if (role) {
        await this.rolesRepository.setUserRole(tx, tenantId, targetUserId, role.id, actorId);
      }

      if (dto.status !== undefined && dto.status !== before.status) {
        await this.writeAudit(tx, {
          tenantId,
          actorId,
          actionCode: 'user.status_changed',
          entityId: targetUserId,
          beforeState: { status: before.status },
          afterState: { status: updated.status },
          meta,
        });
      }
      if (dto.fullName !== undefined && dto.fullName !== before.fullName) {
        await this.writeAudit(tx, {
          tenantId,
          actorId,
          actionCode: 'user.profile_updated',
          entityId: targetUserId,
          beforeState: { fullName: before.fullName },
          afterState: { fullName: updated.fullName },
          meta,
        });
      }
      if (role) {
        await this.writeAudit(tx, {
          tenantId,
          actorId,
          actionCode: 'user.role_changed',
          entityId: targetUserId,
          afterState: { roleId: role.id, roleName: role.name },
          meta,
        });
      }

      const roleNames = await this.rolesRepository.roleNamesForUsers(tx, tenantId, [targetUserId]);
      return toResponse(updated, roleNames.get(targetUserId) ?? []);
    });
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
        entityType: 'user',
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
