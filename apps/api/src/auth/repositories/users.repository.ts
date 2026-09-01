import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { users } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface UserListRow {
  id: string;
  email: string;
  fullName: string;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `users` — every method takes the caller's already-
 * open tenant transaction (multi-tenancy.md's layer 2: the repository layer is where tenant
 * filtering is applied explicitly, on top of — never instead of — RLS).
 */
@Injectable()
export class UsersRepository {
  async findByEmail(tx: TenantTransaction, tenantId: string, email: string): Promise<UserRow | undefined> {
    const [row] = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.email, email), isNull(users.deletedAt)));
    return row;
  }

  async findById(tx: TenantTransaction, tenantId: string, userId: string): Promise<UserRow | undefined> {
    const [row] = await tx
      .select()
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId), isNull(users.deletedAt)));
    return row;
  }

  /** Returns the inserted row (id/email/fullName/status) — never the password hash back out to a
   * caller that doesn't already have it. Existing callers (tenant-provisioning.service.ts) simply
   * don't capture the return value, so this stays backward compatible. */
  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; email: string; passwordHash: string; fullName: string },
  ): Promise<UserRow> {
    const [row] = await tx
      .insert(users)
      .values({ ...values, status: 'active' })
      .returning();
    if (!row) {
      throw new Error('User insert did not return a row.');
    }
    return row;
  }

  async touchLastLogin(tx: TenantTransaction, tenantId: string, userId: string): Promise<void> {
    await tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  }

  /** Compensating soft-delete (016-C): used only by `UsersService.create` to undo a `users` row
   * whose global identity/membership provisioning failed right after it committed — so the row is
   * never left orphaned (unreachable by the new login). */
  async softDelete(tx: TenantTransaction, tenantId: string, userId: string): Promise<void> {
    await tx
      .update(users)
      .set({ deletedAt: new Date() })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  }

  /** Admin-facing paginated listing (§11) — never selects `password_hash`. `status` is an
   * optional allow-listed filter (validated by the DTO before this is called). */
  async findManyByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; status?: string | undefined },
  ): Promise<{ rows: UserListRow[]; total: number }> {
    const conditions = [eq(users.tenantId, tenantId), isNull(users.deletedAt)];
    if (params.status) {
      conditions.push(eq(users.status, params.status));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(users).where(where);

    const rows = await tx
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(users.createdAt)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  /** Updates only the caller-supplied fields — never `email`/`tenant_id`/`password_hash` (those
   * have no place in this DTO at all, per §13/§14's mass-assignment rule). Returns the updated row,
   * or undefined if no matching (tenant-scoped, non-deleted) user exists. */
  async updateProfile(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
    values: { fullName?: string; status?: string },
  ): Promise<UserRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, userId);
    }
    const [row] = await tx
      .update(users)
      .set(values)
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId), isNull(users.deletedAt)))
      .returning();
    return row;
  }
}
