import { Injectable } from '@nestjs/common';
import { and, count, eq } from 'drizzle-orm';
import { qrCodes } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface QrCodeRow {
  id: string;
  tenantId: string;
  code: string;
  targetType: string;
  targetId: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Tenant-scoped, RLS-backed reads/writes on `qr_codes` — same convention as every other repository
 * in this codebase (catalog/repositories/products.repository.ts, inventory/repositories/
 * locations.repository.ts). Every method runs inside the caller's already-open tenant transaction
 * (app_tenant), backstopped by the `qr_codes_tenant_isolation` RLS policy — distinct from
 * `qr-public.repository.ts`, which reads through the separate `app_public_resolver` connection and
 * never touches this repository.
 */
@Injectable()
export class QrCodesRepository {
  /** Insert-and-let-the-constraint-fail, never SELECT-then-INSERT (database.md's concurrency
   * guidance, applied to `code` uniqueness) — the caller (QrCodesService) catches a `code`
   * unique-violation (Postgres 23505 on `qr_codes_code_key`) and retries with a freshly generated
   * code; the database's UNIQUE constraint is the actual authority, this method never pre-checks. */
  async create(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      code: string;
      targetType: string;
      targetId: string;
      expiresAt?: Date | undefined;
    },
  ): Promise<QrCodeRow> {
    const [row] = await tx.insert(qrCodes).values(values).returning();
    if (!row) {
      throw new Error('QR code insert did not return a row.');
    }
    return row;
  }

  async findById(tx: TenantTransaction, tenantId: string, id: string): Promise<QrCodeRow | undefined> {
    const [row] = await tx.select().from(qrCodes).where(and(eq(qrCodes.tenantId, tenantId), eq(qrCodes.id, id)));
    return row;
  }

  /** Used by the authenticated resolve path (`GET /qr-codes/resolve/:code`) — tenant-scoped
   * explicitly (never rely on RLS alone, CLAUDE.md §7.3), so a code belonging to another tenant
   * resolves to "not found" here exactly like a nonexistent one, before the caller ever inspects
   * `status`/`expiresAt`. */
  async findByCode(tx: TenantTransaction, tenantId: string, code: string): Promise<QrCodeRow | undefined> {
    const [row] = await tx.select().from(qrCodes).where(and(eq(qrCodes.tenantId, tenantId), eq(qrCodes.code, code)));
    return row;
  }

  async listByTenant(
    tx: TenantTransaction,
    tenantId: string,
    params: { page: number; pageSize: number; targetType?: string | undefined; targetId?: string | undefined },
  ): Promise<{ rows: QrCodeRow[]; total: number }> {
    const conditions = [eq(qrCodes.tenantId, tenantId)];
    if (params.targetType) {
      conditions.push(eq(qrCodes.targetType, params.targetType));
    }
    if (params.targetId) {
      conditions.push(eq(qrCodes.targetId, params.targetId));
    }
    const where = and(...conditions);

    const [totalRow] = await tx.select({ total: count() }).from(qrCodes).where(where);

    const rows = await tx
      .select()
      .from(qrCodes)
      .where(where)
      .orderBy(qrCodes.createdAt)
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize);

    return { rows, total: totalRow?.total ?? 0 };
  }

  /** The only supported mutation beyond create — revocation (`status: 'revoked'`). No DELETE grant
   * exists on `qr_codes` (migration 0004's comment: "status governs lifecycle, no DELETE grant"). */
  async updateStatus(tx: TenantTransaction, tenantId: string, id: string, status: string): Promise<QrCodeRow | undefined> {
    const [row] = await tx
      .update(qrCodes)
      .set({ status })
      .where(and(eq(qrCodes.tenantId, tenantId), eq(qrCodes.id, id)))
      .returning();
    return row;
  }
}
