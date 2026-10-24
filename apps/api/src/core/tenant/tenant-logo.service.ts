import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { ObjectStorageService } from '../../common/storage/object-storage.service';
import { withTenantTransaction } from '../../database/tenant-context';
import { TenantLogoRepository } from './tenant-logo.repository';

/** Same 3-type set the `tenant_logos_mime_type_check` DB constraint enforces. */
export const TENANT_LOGO_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type LogoMimeType = (typeof TENANT_LOGO_ALLOWED_MIME_TYPES)[number];

/** A logo is drawn at a few dozen pixels — far below a product photo's limit. */
export const TENANT_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<LogoMimeType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

interface AuditMeta {
  actorId: string;
  correlationId?: string | undefined;
  ipAddress?: string | undefined;
}

/**
 * The company logo (owner request). One per tenant, uploaded/replaced/removed from Configuración;
 * the app shell shows it in place of the company's initials. Bytes live in `ObjectStorageService`
 * (like `product_images`), the pointer in `tenant_logos`. The response never carries the storage
 * key: clients only ever learn `logoVersion` (the row's last change, in ms) — used as a cache-buster
 * on the stable `GET /tenant/logo` URL.
 */
@Injectable()
export class TenantLogoService {
  constructor(
    private readonly tenantLogoRepository: TenantLogoRepository,
    private readonly objectStorage: ObjectStorageService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** `undefined` when the company has no logo. */
  async getVersion(tenantId: string): Promise<number | undefined> {
    const row = await withTenantTransaction(tenantId, (tx) => this.tenantLogoRepository.find(tx, tenantId));
    return row ? row.updatedAt.getTime() : undefined;
  }

  async upload(tenantId: string, file: { buffer: Buffer; mimeType: string }, meta: AuditMeta): Promise<{ logoVersion: number }> {
    if (file.buffer.length === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }
    if (file.buffer.length > TENANT_LOGO_MAX_BYTES) {
      throw new BadRequestException(`The logo exceeds the ${TENANT_LOGO_MAX_BYTES / (1024 * 1024)} MB limit.`);
    }
    if (!(TENANT_LOGO_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
      throw new BadRequestException(`Unsupported image type. Allowed: ${TENANT_LOGO_ALLOWED_MIME_TYPES.join(', ')}.`);
    }
    const mimeType = file.mimeType as LogoMimeType;
    const storageKey = `tenant-logos/${tenantId}/${randomUUID()}.${EXTENSION_BY_MIME[mimeType]}`;

    // Object first, then the row: a failed upload never leaves a row pointing at nothing. A failed
    // row write leaves an unreferenced object, which is harmless and removed below on the next change.
    await this.objectStorage.putObject(storageKey, file.buffer, mimeType);
    const { previousKey, row } = await withTenantTransaction(tenantId, async (tx) => {
      const previous = await this.tenantLogoRepository.find(tx, tenantId);
      const saved = await this.tenantLogoRepository.upsert(tx, tenantId, { storageKey, mimeType });
      await this.audit(tx, tenantId, meta, previous ? 'tenant.logo.replaced' : 'tenant.logo.uploaded');
      return { previousKey: previous?.storageKey, row: saved };
    });
    if (previousKey) {
      await this.objectStorage.deleteObject(previousKey).catch(() => undefined);
    }
    return { logoVersion: row.updatedAt.getTime() };
  }

  async getBinary(tenantId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const row = await withTenantTransaction(tenantId, (tx) => this.tenantLogoRepository.find(tx, tenantId));
    if (!row) {
      throw new NotFoundException('This company has no logo.');
    }
    return { buffer: await this.objectStorage.getObject(row.storageKey), mimeType: row.mimeType };
  }

  async remove(tenantId: string, meta: AuditMeta): Promise<void> {
    const previous = await withTenantTransaction(tenantId, async (tx) => {
      const found = await this.tenantLogoRepository.find(tx, tenantId);
      if (!found) {
        return undefined;
      }
      await this.tenantLogoRepository.delete(tx, tenantId);
      await this.audit(tx, tenantId, meta, 'tenant.logo.removed');
      return found;
    });
    // Best-effort: the row is already gone, so the logo is gone for every client.
    if (previous) {
      await this.objectStorage.deleteObject(previous.storageKey).catch(() => undefined);
    }
  }

  private async audit(tx: Parameters<AuditLogService['record']>[0], tenantId: string, meta: AuditMeta, actionCode: string): Promise<void> {
    try {
      await this.auditLogService.record(tx, {
        tenantId,
        actorId: meta.actorId,
        actionCode,
        entityType: 'tenant',
        entityId: tenantId,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation.
    }
  }
}
