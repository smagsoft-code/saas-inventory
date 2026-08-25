import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import { generateQrCode } from '../code-generator';
import type { AuditMeta } from '../qr-audit-meta';
import { QrCodesRepository, type QrCodeRow } from '../repositories/qr-codes.repository';
import { QrTargetsRepository } from '../repositories/qr-targets.repository';
import type { CreateQrCodeDto } from './dto/create-qr-code.dto';
import type { ListQrCodesQueryDto } from './dto/list-qr-codes-query.dto';
import type { QrCodeResponseDto } from './dto/qr-code-response.dto';
import type { QrResolveIdentityResponseDto } from './dto/qr-resolve-identity-response.dto';
import type { UpdateQrCodeDto } from './dto/update-qr-code.dto';

interface UniqueViolation {
  code: string;
  constraint_name?: string;
}

function hasUniqueViolationCode(error: unknown): error is UniqueViolation {
  return typeof error === 'object' && error !== null && 'code' in error && (error as UniqueViolation).code === '23505';
}

/** Same fix as catalog/products/products.service.ts / core/users/users.service.ts: drizzle-orm's
 * postgres-js driver wraps the real Postgres error (carrying `.code`) as `DrizzleQueryError.cause`,
 * never on the thrown error directly. */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  return error instanceof Error && hasUniqueViolationCode(error.cause);
}

const MAX_CODE_GENERATION_ATTEMPTS = 5;

function toQrCodeResponse(row: QrCodeRow): QrCodeResponseDto {
  return {
    id: row.id,
    code: row.code,
    targetType: row.targetType,
    targetId: row.targetId,
    status: row.status,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * QR code management + the authenticated resolve-identity path (§6/§8/§12 of this prompt), within
 * the caller's own tenant only. Every method runs inside `withTenantTransaction`, so RLS backstops
 * every query on top of the explicit tenantId filter — same convention as every other service in
 * this codebase.
 */
@Injectable()
export class QrCodesService {
  constructor(
    private readonly qrCodesRepository: QrCodesRepository,
    private readonly qrTargetsRepository: QrTargetsRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(tenantId: string, actorId: string, dto: CreateQrCodeDto, meta: AuditMeta): Promise<QrCodeResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      await this.assertTargetExists(tx, tenantId, dto.targetType, dto.targetId);

      const row = await this.insertWithRetry(tx, {
        tenantId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      });

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'qr.created',
        entityId: row.id,
        afterState: { targetType: row.targetType, targetId: row.targetId },
        meta,
      });

      return toQrCodeResponse(row);
    });
  }

  async getById(tenantId: string, id: string): Promise<QrCodeResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const row = await this.qrCodesRepository.findById(tx, tenantId, id);
      if (!row) {
        throw new NotFoundException('QR code not found.');
      }
      return toQrCodeResponse(row);
    });
  }

  async list(tenantId: string, query: ListQrCodesQueryDto): Promise<PaginatedResult<QrCodeResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.qrCodesRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        targetType: query.targetType,
        targetId: query.targetId,
      });
      return {
        data: rows.map(toQrCodeResponse),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async updateStatus(tenantId: string, actorId: string, id: string, dto: UpdateQrCodeDto, meta: AuditMeta): Promise<QrCodeResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.qrCodesRepository.findById(tx, tenantId, id);
      if (!before) {
        throw new NotFoundException('QR code not found.');
      }

      const updated = await this.qrCodesRepository.updateStatus(tx, tenantId, id, dto.status);
      if (!updated) {
        throw new NotFoundException('QR code not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'qr.revoked',
        entityId: id,
        beforeState: { status: before.status },
        afterState: { status: updated.status },
        meta,
      });

      return toQrCodeResponse(updated);
    });
  }

  /** `GET /qr-codes/resolve/:code` — any authenticated tenant user, no `catalog.qr.manage` required
   * (mobile.md#qr-on-mobile: the scan-and-look-up step itself is not the sensitive operation; the
   * subsequent CATALOG/INVENTORY call the client makes with the ids returned here is where the real
   * permission gate — ADR-0028 / `locations.view` — actually lives). Applies the same active/
   * non-expired rule the public resolver's RLS policy applies, so a revoked or expired label fails
   * to resolve for every caller, not just anonymous ones. */
  async resolveIdentity(tenantId: string, code: string): Promise<QrResolveIdentityResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const qr = await this.qrCodesRepository.findByCode(tx, tenantId, code);
      if (!qr) {
        throw new NotFoundException('QR code not found.');
      }
      if (qr.status !== 'active') {
        throw new GoneException('This QR code has been revoked.');
      }
      if (qr.expiresAt && qr.expiresAt.getTime() <= Date.now()) {
        throw new GoneException('This QR code has expired.');
      }

      if (qr.targetType === 'product_variant') {
        const target = await this.qrTargetsRepository.findProductVariant(tx, tenantId, qr.targetId);
        if (!target) {
          throw new NotFoundException('QR code target no longer exists.');
        }
        return {
          qrCodeId: qr.id,
          targetType: 'product_variant',
          productVariantId: target.id,
          productId: target.productId,
          status: target.status,
        };
      }

      const target = await this.qrTargetsRepository.findLocation(tx, tenantId, qr.targetId);
      if (!target) {
        throw new NotFoundException('QR code target no longer exists.');
      }
      return {
        qrCodeId: qr.id,
        targetType: 'location',
        locationId: target.id,
        status: target.status,
      };
    });
  }

  private async assertTargetExists(tx: TenantTransaction, tenantId: string, targetType: string, targetId: string): Promise<void> {
    if (targetType === 'product_variant') {
      const target = await this.qrTargetsRepository.findProductVariant(tx, tenantId, targetId);
      if (!target) {
        throw new NotFoundException('Product variant not found.');
      }
      return;
    }
    const target = await this.qrTargetsRepository.findLocation(tx, tenantId, targetId);
    if (!target) {
      throw new NotFoundException('Location not found.');
    }
  }

  /** Insert-and-catch-conflict, never SELECT-then-INSERT (database.md's concurrency guidance) — the
   * database's `qr_codes_code_key` UNIQUE constraint is the actual authority on `code` uniqueness.
   * A collision is astronomically unlikely (192 bits of entropy per attempt) but bounded-retried
   * rather than assumed impossible. */
  private async insertWithRetry(
    tx: TenantTransaction,
    values: { tenantId: string; targetType: string; targetId: string; expiresAt: Date | undefined },
  ): Promise<QrCodeRow> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      try {
        return await this.qrCodesRepository.create(tx, {
          id: generateId(),
          tenantId: values.tenantId,
          code: generateQrCode(),
          targetType: values.targetType,
          targetId: values.targetId,
          expiresAt: values.expiresAt,
        });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        lastError = error;
      }
    }
    throw new ConflictException('Could not generate a unique QR code.', { cause: lastError });
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
        entityType: 'qr_code',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation.
    }
  }
}
