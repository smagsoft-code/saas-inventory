import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { categories } from '../../database/schema';
import { upperName } from '../upper-name';
import type { TenantTransaction } from '../../database/tenant-context';

export interface CategoryRow {
  id: string;
  tenantId: string;
  parentCategoryId: string | null;
  name: string;
  code: string;
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

  /**
   * The next free automatic code, `CAT-001`, `CAT-002`, … (three digits is a minimum, never a cap:
   * `CAT-1000` follows `CAT-999`). One more than the highest `CAT-<number>` the tenant already has —
   * counting soft-deleted rows too, so a code is never reused — taken under a transaction-scoped
   * advisory lock so two concurrent creates cannot be handed the same one. A code the user typed by
   * hand (any other shape) is ignored by the sequence.
   */
  async nextCode(tx: TenantTransaction, tenantId: string): Promise<string> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`catalog.category_code:${tenantId}`}))`);
    const rows = await tx.execute<{ max: string | null }>(
      sql`select max(substring(code from '(?i)^CAT-([0-9]+)$')::bigint)::text as max from categories where tenant_id = ${tenantId}`,
    );
    const next = Number(rows[0]?.max ?? 0) + 1;
    return `CAT-${String(next).padStart(3, '0')}`;
  }

  async create(
    tx: TenantTransaction,
    values: { id: string; tenantId: string; name: string; code: string; parentCategoryId?: string | undefined },
  ): Promise<CategoryRow> {
    const [row] = await tx
      .insert(categories)
      .values({ ...values, name: upperName(values.name) })
      .returning();
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
    values: { name?: string; code?: string; parentCategoryId?: string | null; status?: string },
  ): Promise<CategoryRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, categoryId);
    }
    const [row] = await tx
      .update(categories)
      .set(values.name !== undefined ? { ...values, name: upperName(values.name) } : values)
      .where(and(eq(categories.tenantId, tenantId), eq(categories.id, categoryId), isNull(categories.deletedAt)))
      .returning();
    return row;
  }
}
