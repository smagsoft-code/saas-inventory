import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { users } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface UserRow {
  id: string;
  tenantId: string;
  email: string;
  passwordHash: string;
  fullName: string;
  status: string;
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

  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; email: string; passwordHash: string; fullName: string },
  ): Promise<void> {
    await tx.insert(users).values({ ...values, status: 'active' });
  }

  async touchLastLogin(tx: TenantTransaction, tenantId: string, userId: string): Promise<void> {
    await tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  }
}
