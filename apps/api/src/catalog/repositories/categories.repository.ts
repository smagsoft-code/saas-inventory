import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { categories } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface CategoryRow {
  id: string;
  tenantId: string;
  parentCategoryId: string | null;
  name: string;
  slug: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `categories` — same convention as
 * apps/api/src/auth/repositories/users.repository.ts: every method takes the caller's already-open
 * tenant transaction, filters explicitly by tenantId on top of (never instead of) RLS.
 */
@Injectable()
export class CategoriesRepository {
  async findById(tx: TenantTransaction, tenantId: string, categoryId: string): Promise<CategoryRow | undefined> {
    const [row] = await tx
      .select()
      .from(categories)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId), isNull(categories.deletedAt)));
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; status?: string | undefined },
  ): Promise<{ rows: CategoryRow[]; total: number }> {
    const conditions = [eq(categories.tenantId, tenantId), isNull(categories.deletedAt)];
    if (params.status) {
      conditions.push(eq(categories.status, params.status));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(categories).where(where);

    const rows = await tx
      .select()
      .from(categories)
      .where(where)
      .orderBy(categories.name)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; name: string; slug: string; parentCategoryId?: string | undefined },
  ): Promise<CategoryRow> {
    const [row] = await tx.insert(categories).values(values).returning();
    if (!row) {
      throw new Error('Category insert did not return a row.');
    }
    return row;
  }

  /** Undefined fields are left untouched — the caller (service layer) only includes keys it
   * actually wants to change, matching UsersRepository.updateProfile's convention. */
  async update(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string,
    values: { name?: string; slug?: string; parentCategoryId?: string | null; status?: string },
  ): Promise<CategoryRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, categoryId);
    }
    const [row] = await tx
      .update(categories)
      .set(values)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId), isNull(categories.deletedAt)))
      .returning();
    return row;
  }
}
