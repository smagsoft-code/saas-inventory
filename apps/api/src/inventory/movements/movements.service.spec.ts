import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientStockError } from '../stock-ledger.service';
import { MovementsService } from './movements.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const VARIANT_ID = 'variant-1';
const LOCATION_ID = 'location-1';
const META = { correlationId: undefined, ipAddress: undefined };

const EXISTING_MOVEMENT = {
  id: 'movement-1',
  tenantId: TENANT_ID,
  productVariantId: VARIANT_ID,
  locationId: LOCATION_ID,
  movementType: 'RECEIPT',
  quantity: '10',
  balanceAfter: '10',
  referenceType: 'manual_adjustment',
  referenceId: null,
  reason: 'Initial stock count',
  actorType: 'user',
  actorId: ACTOR_ID,
  idempotencyKey: null,
  correlationId: null,
  occurredAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function buildService() {
  const movementsRepository = { listByTenant: vi.fn() };
  const productVariantsLookup = { exists: vi.fn() };
  const locationsRepository = { findById: vi.fn() };
  const locationAuthorizationService = { assertAccess: vi.fn() };
  const stockLedgerService = { applyMovement: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const service = new MovementsService(
    movementsRepository as never,
    productVariantsLookup as never,
    locationsRepository as never,
    locationAuthorizationService as never,
    stockLedgerService as never,
    auditLogService as never,
  );
  return { service, movementsRepository, productVariantsLookup, locationsRepository, locationAuthorizationService, stockLedgerService, auditLogService };
}

const VALID_DTO = { productVariantId: VARIANT_ID, locationId: LOCATION_ID, movementType: 'RECEIPT' as const, quantity: 10, reason: 'Restock' };

describe('MovementsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createAdjustment', () => {
    it('throws NotFoundException when the product variant does not exist in this tenant', async () => {
      const { service, productVariantsLookup } = buildService();
      productVariantsLookup.exists.mockResolvedValue(false);
      await expect(service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the location does not exist in this tenant', async () => {
      const { service, productVariantsLookup, locationsRepository } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue(undefined);
      await expect(service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META)).rejects.toThrow(NotFoundException);
    });

    it('propagates ForbiddenException from location authorization before touching the ledger (ADR-0024)', async () => {
      const { service, productVariantsLookup, locationsRepository, locationAuthorizationService, stockLedgerService } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue({ id: LOCATION_ID });
      locationAuthorizationService.assertAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META)).rejects.toThrow(ForbiddenException);
      expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    });

    it('maps InsufficientStockError to ConflictException', async () => {
      const { service, productVariantsLookup, locationsRepository, locationAuthorizationService, stockLedgerService } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue({ id: LOCATION_ID });
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      stockLedgerService.applyMovement.mockRejectedValue(new InsufficientStockError('Resulting quantity would be negative.'));

      await expect(
        service.createAdjustment(TENANT_ID, ACTOR_ID, { ...VALID_DTO, movementType: 'ADJUSTMENT_OUT', quantity: 999 }, META),
      ).rejects.toThrow(ConflictException);
    });

    it('applies the movement via StockLedgerService and writes an audit entry on success', async () => {
      const { service, productVariantsLookup, locationsRepository, locationAuthorizationService, stockLedgerService, auditLogService } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue({ id: LOCATION_ID });
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      stockLedgerService.applyMovement.mockResolvedValue({ movement: EXISTING_MOVEMENT, balance: { id: 'balance-1' } });

      const result = await service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META);

      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ tenantId: TENANT_ID, productVariantId: VARIANT_ID, locationId: LOCATION_ID, movementType: 'RECEIPT', quantity: 10, actorId: ACTOR_ID }),
      );
      expect(auditLogService.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actionCode: 'inventory.adjustment.created' }));
      expect(result.movementType).toBe('RECEIPT');
      expect(result.quantity).toBe(10);
    });
  });

  describe('list', () => {
    it('paginates and passes filters through to the repository', async () => {
      const { service, movementsRepository } = buildService();
      movementsRepository.listByTenant.mockResolvedValue({ rows: [EXISTING_MOVEMENT], total: 1 });

      const result = await service.list(TENANT_ID, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
