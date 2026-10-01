import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { customers } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface CustomerRow {
  id: string;
  tenantId: string;
  type: string;
  firstName: string;
  lastName: string | null;
  displayName: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `customers` — same per-transaction convention as every
 * other repository in this codebase (SALES owns this table, modules.md#sales). No hard delete:
 * `customers` is soft-deleted (database.md#soft-delete-policy) and historical `orders` still
 * reference it via `customer_id` for traceability, so the row must keep existing.
 */
@Injectable()
export class CustomersRepository {
  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<CustomerRow | undefined> {
    const [row] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id), isNull(customers.deletedAt)));
    return row;
  }

  async findByTaxId(tx: TenantTransaction, tenantId: string, taxId: string): Promise<CustomerRow | undefined> {
    const [row] = await tx
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.taxId, taxId), isNull(customers.deletedAt)));
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; status?: string | undefined; type?: string | undefined; q?: string | undefined },
  ): Promise<{ rows: CustomerRow[]; total: number }> {
    const conditions: SQL[] = [eq(customers.tenantId, tenantId), isNull(customers.deletedAt)];
    if (params.status) {
      conditions.push(eq(customers.status, params.status));
    }
    if (params.type) {
      conditions.push(eq(customers.type, params.type));
    }
    if (params.q) {
      const pattern = `%${params.q}%`;
      const search = or(
        ilike(customers.firstName, pattern),
        ilike(customers.lastName, pattern),
        ilike(customers.taxId, pattern),
        ilike(customers.email, pattern),
        ilike(customers.phone, pattern),
      );
      if (search) {
        conditions.push(search);
      }
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(customers).where(where);
    const rows = await tx
      .select()
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  async create(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      type: string;
      firstName: string;
      lastName: string;
      taxId?: string | null | undefined;
      email?: string | null | undefined;
      phone?: string | null | undefined;
      address?: string | null | undefined;
    },
  ): Promise<CustomerRow> {
    const [row] = await tx.insert(customers).values(values).returning();
    if (!row) {
      throw new Error('Customer insert did not return a row.');
    }
    return row;
  }

  async update(
    tx: TenantTransaction,
    tenantId: string,
    id: string,
    values: {
      type?: string;
      firstName?: string;
      lastName?: string | null;
      taxId?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      status?: string;
    },
  ): Promise<CustomerRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findById(tx, tenantId, id);
    }
    const [row] = await tx
      .update(customers)
      .set(values)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, id), isNull(customers.deletedAt)))
      .returning();
    return row;
  }
}
