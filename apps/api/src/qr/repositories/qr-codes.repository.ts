import { Injectable } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
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

/** One `product_variants` row with no active `qr_codes` row — bulk-generation candidate. A plain
 * type alias (not `interface`) — `Database['execute']`'s generic bound requires
 * `Record<string, unknown>`, same reason `ProductCatalogRow` (products-report.repository.ts) is one. */
export type PendingVariantRow = {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  totalCount: string;
};

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

  /** Used by `QrCodesService.create()` to reject generating a second QR for a target that already
   * has one active — a revoked one never blocks a new generation (that is exactly the intended
   * "revoke, then regenerate" lifecycle). No unique constraint enforces this at the schema level
   * (deliberately — a target legitimately cycles through many revoked codes over its lifetime), so
   * the application layer is the actual authority here. */
  async findActiveByTarget(
    tx: TenantTransaction,
    tenantId: string,
    targetType: string,
    targetId: string,
  ): Promise<QrCodeRow | undefined> {
    const [row] = await tx
      .select()
      .from(qrCodes)
      .where(
        and(
          eq(qrCodes.tenantId, tenantId),
          eq(qrCodes.targetType, targetType),
          eq(qrCodes.targetId, targetId),
          eq(qrCodes.status, 'active'),
        ),
      )
      .limit(1);
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

  /**
   * Bulk-generation candidates (`GET /qr-codes/pending-variants`) — every active, non-deleted
   * `product_variants` row in this tenant with **no active** `qr_codes` row pointing at it. A
   * revoked-only or never-generated target both qualify identically (`NOT EXISTS ... status =
   * 'active'` — the same "revoked never blocks a new generation" rule `findActiveByTarget`
   * documents, just phrased as an anti-join instead of a positive lookup). Raw parameterized `sql`
   * (never string-interpolated), same convention `ProductsReportRepository.list()` already
   * establishes for this exact join+search+pagination shape — QR already depends on CATALOG
   * (`QrTargetsRepository` reads `product_variants`/`locations` directly), so reading `products`
   * here too is the same existing edge, not a new one.
   */
  async findPendingProductVariants(
    tx: TenantTransaction,
    tenantId: string,
    params: { q?: string | undefined; page: number; pageSize: number },
  ): Promise<{ rows: PendingVariantRow[]; total: number }> {
    const offset = (params.page - 1) * params.pageSize;
    const rows = await tx.execute<PendingVariantRow>(sql`
      SELECT
        p.id AS "productId",
        p.name AS "productName",
        pv.id AS "variantId",
        pv.sku AS sku,
        COUNT(*) OVER() AS "totalCount"
      FROM product_variants pv
      JOIN products p ON p.tenant_id = pv.tenant_id AND p.id = pv.product_id
      WHERE pv.tenant_id = ${tenantId}
        AND pv.deleted_at IS NULL
        AND p.deleted_at IS NULL
        AND pv.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM qr_codes qc
          WHERE qc.tenant_id = pv.tenant_id
            AND qc.target_type = 'product_variant'
            AND qc.target_id = pv.id
            AND qc.status = 'active'
        )
        ${params.q ? sql`AND (p.name ILIKE '%' || ${params.q} || '%' OR pv.sku ILIKE '%' || ${params.q} || '%')` : sql``}
      ORDER BY p.name ASC, pv.sku ASC
      LIMIT ${params.pageSize} OFFSET ${offset}
    `);
    const total = rows.length > 0 ? Number(rows[0]!.totalCount) : 0;
    return { rows, total };
  }
}
