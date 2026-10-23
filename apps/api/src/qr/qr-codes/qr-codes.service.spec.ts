import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QrCodesService } from './qr-codes.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const META = { correlationId: undefined, ipAddress: undefined };

const EXISTING_VARIANT = { id: 'variant-1', productId: 'product-1', status: 'active' };
const EXISTING_LOCATION = { id: 'location-1', status: 'active' };

const EXISTING_QR = {
  id: 'qr-1',
  tenantId: TENANT_ID,
  code: 'opaque-code',
  targetType: 'product_variant',
  targetId: 'variant-1',
  status: 'active',
  expiresAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const qrCodesRepository = {
    create: vi.fn(),
    findById: vi.fn(),
    findByCode: vi.fn(),
    findActiveByTarget: vi.fn(),
    listByTenant: vi.fn(),
    updateStatus: vi.fn(),
    findPendingProductVariants: vi.fn(),
  };
  const qrTargetsRepository = { findProductVariant: vi.fn(), findLocation: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new QrCodesService(qrCodesRepository as never, qrTargetsRepository as never, auditLogService as never);
  return { service, qrCodesRepository, qrTargetsRepository, auditLogService };
}

describe('QrCodesService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create', () => {
    it('rejects a targetId that does not resolve to a product variant in the current tenant', async () => {
      const { service, qrTargetsRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(undefined);
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { targetType: 'product_variant', targetId: 'foreign-variant' }, META),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects a targetId that does not resolve to a location in the current tenant', async () => {
      const { service, qrTargetsRepository } = buildService();
      qrTargetsRepository.findLocation.mockResolvedValue(undefined);
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { targetType: 'location', targetId: 'foreign-location' }, META),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects generating a QR when the target already has one active', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      qrCodesRepository.findActiveByTarget.mockResolvedValue(EXISTING_QR);

      await expect(
        service.create(TENANT_ID, ACTOR_ID, { targetType: 'product_variant', targetId: 'variant-1' }, META),
      ).rejects.toThrow(ConflictException);
      expect(qrCodesRepository.create).not.toHaveBeenCalled();
    });

    it('allows generating a QR when the target only has a revoked one', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      // findActiveByTarget only ever returns a row whose status is 'active' — a revoked-only
      // target resolves to undefined here, exactly like one that never had a QR at all.
      qrCodesRepository.findActiveByTarget.mockResolvedValue(undefined);
      qrCodesRepository.create.mockResolvedValue(EXISTING_QR);

      const result = await service.create(TENANT_ID, ACTOR_ID, { targetType: 'product_variant', targetId: 'variant-1' }, META);
      expect(result.id).toBe('qr-1');
    });

    it('creates a QR code for a valid product variant target and audits it', async () => {
      const { service, qrTargetsRepository, qrCodesRepository, auditLogService } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      qrCodesRepository.create.mockResolvedValue(EXISTING_QR);

      const result = await service.create(TENANT_ID, ACTOR_ID, { targetType: 'product_variant', targetId: 'variant-1' }, META);

      expect(result.id).toBe('qr-1');
      expect(result.code).toBe('opaque-code');
      expect(result.targetType).toBe('product_variant');
      expect(auditLogService.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionCode: 'qr.created' }));
    });

    it('retries with a fresh code on a unique-violation and eventually succeeds', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      qrCodesRepository.create.mockRejectedValueOnce(uniqueViolation).mockResolvedValueOnce(EXISTING_QR);

      const result = await service.create(TENANT_ID, ACTOR_ID, { targetType: 'product_variant', targetId: 'variant-1' }, META);

      expect(qrCodesRepository.create).toHaveBeenCalledTimes(2);
      expect(result.id).toBe('qr-1');
      // §15/§13.11: never SELECT-then-INSERT — the repository's create() is called directly again
      // with a freshly generated code, not preceded by an existence check.
      const calls = qrCodesRepository.create.mock.calls as [unknown, { code: string }][];
      const firstCode = calls[0]?.[1].code;
      const secondCode = calls[1]?.[1].code;
      expect(firstCode).toBeDefined();
      expect(secondCode).toBeDefined();
      expect(firstCode).not.toBe(secondCode);
    });

    it('gives up after repeated unique-violations rather than retrying forever', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      qrCodesRepository.create.mockRejectedValue(uniqueViolation);

      await expect(
        service.create(TENANT_ID, ACTOR_ID, { targetType: 'product_variant', targetId: 'variant-1' }, META),
      ).rejects.toThrow(ConflictException);
    });

    it('propagates a non-unique-violation error immediately, without retrying', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      qrCodesRepository.create.mockRejectedValue(new Error('connection reset'));

      await expect(
        service.create(TENANT_ID, ACTOR_ID, { targetType: 'product_variant', targetId: 'variant-1' }, META),
      ).rejects.toThrow('connection reset');
      expect(qrCodesRepository.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('createBulk (bulk generation)', () => {
    it('generates a QR for each variant that has none, reusing create() unchanged', async () => {
      const { service, qrTargetsRepository, qrCodesRepository, auditLogService } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      qrCodesRepository.create
        .mockResolvedValueOnce({ ...EXISTING_QR, id: 'qr-a', targetId: 'variant-1' })
        .mockResolvedValueOnce({ ...EXISTING_QR, id: 'qr-b', targetId: 'variant-2' });

      const result = await service.createBulk(TENANT_ID, ACTOR_ID, { variantIds: ['variant-1', 'variant-2'] }, META);

      expect(result.summary).toEqual({ created: 2, skipped: 0, errors: 0 });
      expect(result.results).toEqual([
        { variantId: 'variant-1', status: 'created', qrCode: expect.objectContaining({ id: 'qr-a' }) },
        { variantId: 'variant-2', status: 'created', qrCode: expect.objectContaining({ id: 'qr-b' }) },
      ]);
      expect(auditLogService.record).toHaveBeenCalledTimes(2);
    });

    it('skips (never errors on) a variant that already has an active QR — idempotent re-submission', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      qrCodesRepository.findActiveByTarget.mockResolvedValue(EXISTING_QR);

      const result = await service.createBulk(TENANT_ID, ACTOR_ID, { variantIds: ['variant-1'] }, META);

      expect(result.results).toEqual([{ variantId: 'variant-1', status: 'skipped', reason: expect.stringContaining('already has an active QR') }]);
      expect(result.summary).toEqual({ created: 0, skipped: 1, errors: 0 });
      expect(qrCodesRepository.create).not.toHaveBeenCalled();
    });

    it('reports a nonexistent/foreign-tenant variant as an error, never leaking which case it was, and continues the batch', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant
        .mockResolvedValueOnce(undefined) // variant-missing: not found / foreign tenant
        .mockResolvedValueOnce(EXISTING_VARIANT); // variant-1: real
      qrCodesRepository.create.mockResolvedValueOnce({ ...EXISTING_QR, id: 'qr-ok' });

      const result = await service.createBulk(TENANT_ID, ACTOR_ID, { variantIds: ['variant-missing', 'variant-1'] }, META);

      expect(result.summary).toEqual({ created: 1, skipped: 0, errors: 1 });
      expect(result.results[0]).toEqual({ variantId: 'variant-missing', status: 'error', reason: 'Product variant not found.' });
      expect(result.results[1]).toEqual(expect.objectContaining({ variantId: 'variant-1', status: 'created' }));
    });

    it('never lets one failing variant abort the rest of the batch', async () => {
      const { service, qrTargetsRepository, qrCodesRepository } = buildService();
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);
      qrCodesRepository.create
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockResolvedValueOnce({ ...EXISTING_QR, id: 'qr-second' });

      const result = await service.createBulk(TENANT_ID, ACTOR_ID, { variantIds: ['variant-1', 'variant-2'] }, META);

      expect(result.summary).toEqual({ created: 1, skipped: 0, errors: 1 });
      expect(result.results[0]).toEqual({ variantId: 'variant-1', status: 'error', reason: 'connection reset' });
      expect(result.results[1]).toEqual(expect.objectContaining({ variantId: 'variant-2', status: 'created' }));
    });
  });

  describe('listPendingVariants (bulk-generation candidates)', () => {
    it('maps repository rows to the response shape and paginates', async () => {
      const { service, qrCodesRepository } = buildService();
      qrCodesRepository.findPendingProductVariants.mockResolvedValue({
        rows: [{ productId: 'p1', productName: 'Fridge', variantId: 'v1', sku: 'FRIDGE-A', categoryName: 'Cocina', totalCount: '1' }],
        total: 1,
      });

      const result = await service.listPendingVariants(TENANT_ID, { page: 1, pageSize: 100, categoryId: 'cat-1' });

      expect(qrCodesRepository.findPendingProductVariants).toHaveBeenCalledWith(expect.anything(), TENANT_ID, expect.objectContaining({ categoryId: 'cat-1' }));
      expect(result.data).toEqual([{ productId: 'p1', productName: 'Fridge', variantId: 'v1', sku: 'FRIDGE-A', categoryName: 'Cocina' }]);
      expect(result.meta).toEqual({ page: 1, pageSize: 100, total: 1, totalPages: 1 });
    });
  });

  describe('getById / cross-tenant (§28-style scenario)', () => {
    it('throws NotFoundException rather than leaking whether a foreign-tenant id exists', async () => {
      const { service, qrCodesRepository } = buildService();
      qrCodesRepository.findById.mockResolvedValue(undefined);
      await expect(service.getById(TENANT_ID, 'other-tenants-qr')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus (revoke)', () => {
    it('404s for a nonexistent/foreign-tenant id', async () => {
      const { service, qrCodesRepository } = buildService();
      qrCodesRepository.findById.mockResolvedValue(undefined);
      await expect(service.updateStatus(TENANT_ID, ACTOR_ID, 'missing', { status: 'revoked' }, META)).rejects.toThrow(NotFoundException);
    });

    it('revokes an active QR code and audits it', async () => {
      const { service, qrCodesRepository, auditLogService } = buildService();
      qrCodesRepository.findById.mockResolvedValue(EXISTING_QR);
      qrCodesRepository.updateStatus.mockResolvedValue({ ...EXISTING_QR, status: 'revoked' });

      const result = await service.updateStatus(TENANT_ID, ACTOR_ID, 'qr-1', { status: 'revoked' }, META);

      expect(result.status).toBe('revoked');
      expect(auditLogService.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionCode: 'qr.revoked' }));
    });
  });

  describe('resolveIdentity (authenticated resolve path)', () => {
    it('404s for a code that does not exist / belongs to another tenant', async () => {
      const { service, qrCodesRepository } = buildService();
      qrCodesRepository.findByCode.mockResolvedValue(undefined);
      await expect(service.resolveIdentity(TENANT_ID, 'unknown-code')).rejects.toThrow(NotFoundException);
    });

    it('rejects a revoked QR code with 410 Gone', async () => {
      const { service, qrCodesRepository } = buildService();
      qrCodesRepository.findByCode.mockResolvedValue({ ...EXISTING_QR, status: 'revoked' });
      await expect(service.resolveIdentity(TENANT_ID, 'opaque-code')).rejects.toThrow(GoneException);
    });

    it('rejects an expired QR code with 410 Gone', async () => {
      const { service, qrCodesRepository } = buildService();
      qrCodesRepository.findByCode.mockResolvedValue({ ...EXISTING_QR, expiresAt: new Date('2000-01-01T00:00:00Z') });
      await expect(service.resolveIdentity(TENANT_ID, 'opaque-code')).rejects.toThrow(GoneException);
    });

    it('resolves a product_variant target to identity only — never price fields', async () => {
      const { service, qrCodesRepository, qrTargetsRepository } = buildService();
      qrCodesRepository.findByCode.mockResolvedValue(EXISTING_QR);
      qrTargetsRepository.findProductVariant.mockResolvedValue(EXISTING_VARIANT);

      const result = await service.resolveIdentity(TENANT_ID, 'opaque-code');

      expect(result).toEqual({
        qrCodeId: 'qr-1',
        targetType: 'product_variant',
        productVariantId: 'variant-1',
        productId: 'product-1',
        status: 'active',
      });
      expect(result).not.toHaveProperty('maxPrice');
      expect(result).not.toHaveProperty('minPrice');
      expect(result).not.toHaveProperty('cost');
    });

    it('resolves a location target to identity only', async () => {
      const { service, qrCodesRepository, qrTargetsRepository } = buildService();
      qrCodesRepository.findByCode.mockResolvedValue({ ...EXISTING_QR, targetType: 'location', targetId: 'location-1' });
      qrTargetsRepository.findLocation.mockResolvedValue(EXISTING_LOCATION);

      const result = await service.resolveIdentity(TENANT_ID, 'opaque-code');

      expect(result).toEqual({ qrCodeId: 'qr-1', targetType: 'location', locationId: 'location-1', status: 'active' });
    });

    it('404s when the target row backing an otherwise-valid QR code no longer exists', async () => {
      const { service, qrCodesRepository, qrTargetsRepository } = buildService();
      qrCodesRepository.findByCode.mockResolvedValue(EXISTING_QR);
      qrTargetsRepository.findProductVariant.mockResolvedValue(undefined);
      await expect(service.resolveIdentity(TENANT_ID, 'opaque-code')).rejects.toThrow(NotFoundException);
    });
  });
});
