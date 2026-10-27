import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientStockError } from '../stock-ledger.service';
import { MovementsService } from './movements.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const VIEW_ALL = ['sales.orders.view_all'];
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
  unitCost: null,
};

function buildService() {
  const movementsRepository = {
    listByTenant: vi.fn(),
    resolveOrderNumbers: vi.fn().mockResolvedValue(new Map()),
    resolveReturnNumbers: vi.fn().mockResolvedValue(new Map()),
    resolveImportJobNumbers: vi.fn().mockResolvedValue(new Map()),
    resolveReceiptTransferIds: vi.fn().mockResolvedValue(new Map()),
    resolveTransferCodes: vi.fn().mockResolvedValue(new Map()),
  };
  const productVariantsLookup = { exists: vi.fn() };
  const locationsRepository = { findById: vi.fn() };
  const locationAuthorizationService = { assertAccess: vi.fn() };
  const stockLedgerService = { applyMovement: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const movingAverageCostService = { getCurrentAverageCost: vi.fn().mockResolvedValue({ stock: 0, averageCost: 0, estimated: false }) };
  const service = new MovementsService(
    movementsRepository as never,
    productVariantsLookup as never,
    locationsRepository as never,
    locationAuthorizationService as never,
    stockLedgerService as never,
    auditLogService as never,
    movingAverageCostService as never,
  );
  return {
    service,
    movementsRepository,
    productVariantsLookup,
    locationsRepository,
    locationAuthorizationService,
    stockLedgerService,
    auditLogService,
    movingAverageCostService,
  };
}

const CAN_VIEW_COST = true;

const VALID_DTO = { productVariantId: VARIANT_ID, locationId: LOCATION_ID, movementType: 'RECEIPT' as const, quantity: 10, reason: 'Restock', unitCost: 5 };

describe('MovementsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createAdjustment', () => {
    it('throws NotFoundException when the product variant does not exist in this tenant', async () => {
      const { service, productVariantsLookup } = buildService();
      productVariantsLookup.exists.mockResolvedValue(false);
      await expect(service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META, CAN_VIEW_COST)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the location does not exist in this tenant', async () => {
      const { service, productVariantsLookup, locationsRepository } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue(undefined);
      await expect(service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META, CAN_VIEW_COST)).rejects.toThrow(NotFoundException);
    });

    it('propagates ForbiddenException from location authorization before touching the ledger (ADR-0024)', async () => {
      const { service, productVariantsLookup, locationsRepository, locationAuthorizationService, stockLedgerService } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue({ id: LOCATION_ID });
      locationAuthorizationService.assertAccess.mockRejectedValue(new ForbiddenException());

      await expect(service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META, CAN_VIEW_COST)).rejects.toThrow(ForbiddenException);
      expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    });

    it('maps InsufficientStockError to ConflictException', async () => {
      const { service, productVariantsLookup, locationsRepository, locationAuthorizationService, stockLedgerService } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue({ id: LOCATION_ID });
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      stockLedgerService.applyMovement.mockRejectedValue(new InsufficientStockError('Resulting quantity would be negative.'));

      await expect(
        service.createAdjustment(TENANT_ID, ACTOR_ID, { ...VALID_DTO, movementType: 'ADJUSTMENT_OUT', quantity: 999 }, META, CAN_VIEW_COST),
      ).rejects.toThrow(ConflictException);
    });

    it('applies the movement via StockLedgerService and writes an audit entry on success', async () => {
      const { service, productVariantsLookup, locationsRepository, locationAuthorizationService, stockLedgerService, auditLogService } = buildService();
      productVariantsLookup.exists.mockResolvedValue(true);
      locationsRepository.findById.mockResolvedValue({ id: LOCATION_ID });
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      stockLedgerService.applyMovement.mockResolvedValue({ movement: EXISTING_MOVEMENT, balance: { id: 'balance-1' } });

      const result = await service.createAdjustment(TENANT_ID, ACTOR_ID, VALID_DTO, META, CAN_VIEW_COST);

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

      const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    describe('referenceLabel', () => {
      it('labels a SALE with its resolved order number', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [{ ...EXISTING_MOVEMENT, movementType: 'SALE', referenceType: 'order', referenceId: 'order-1', reason: null }],
          total: 1,
        });
        movementsRepository.resolveOrderNumbers.mockResolvedValue(new Map([['order-1', 'ORD-000123']]));

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveOrderNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['order-1'], undefined);
        expect(result.data[0]!.referenceLabel).toBe('Venta #ORD-000123');
      });

      it('labels an Excel-import movement "Importación #N" and never returns the raw reason (it embeds the job uuid)', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [{ ...EXISTING_MOVEMENT, movementType: 'INITIAL_STOCK', referenceType: 'import_job', referenceId: 'job-1', reason: 'Excel import job job-1' }],
          total: 1,
        });
        movementsRepository.resolveImportJobNumbers.mockResolvedValue(new Map([['job-1', 3]]));

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveImportJobNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['job-1']);
        expect(result.data[0]!.referenceLabel).toBe('Importación #3');
        expect(result.data[0]!.reason).toBeUndefined();
        expect(result.data[0]!.referenceId, 'the import job uuid is not an id a ledger reader can open').toBeUndefined();
      });

      it('omits referenceLabel for a SALE whose order number could not be resolved', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [{ ...EXISTING_MOVEMENT, movementType: 'SALE', referenceType: 'order', referenceId: 'order-1', reason: null }],
          total: 1,
        });

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        // unresolved under the caller's scope = masked: a generic label, never the number
        expect(result.data[0]!.referenceLabel).toBe('Venta');
      });

      it('labels a TRANSFER_OUT with its transfer code, resolved directly from its own referenceId', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [{ ...EXISTING_MOVEMENT, movementType: 'TRANSFER_OUT', referenceType: 'transfer', referenceId: 'transfer-1', reason: null }],
          total: 1,
        });
        movementsRepository.resolveTransferCodes.mockResolvedValue(new Map([['transfer-1', 'SUC-PRIN-ALM-PRIN-005']]));

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveReceiptTransferIds).toHaveBeenCalledWith(expect.anything(), TENANT_ID, []);
        expect(movementsRepository.resolveTransferCodes).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['transfer-1']);
        expect(result.data[0]!.referenceLabel).toBe('Transferencia #SUC-PRIN-ALM-PRIN-005');
      });

      it('labels a TRANSFER_IN with its paired transfer code, resolved via the receipt then the transfer', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [{ ...EXISTING_MOVEMENT, movementType: 'TRANSFER_IN', referenceType: 'transfer_receipt', referenceId: 'receipt-1', reason: null }],
          total: 1,
        });
        movementsRepository.resolveReceiptTransferIds.mockResolvedValue(new Map([['receipt-1', 'transfer-1']]));
        movementsRepository.resolveTransferCodes.mockResolvedValue(new Map([['transfer-1', 'SUC-PRIN-ALM-PRIN-005']]));

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveReceiptTransferIds).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['receipt-1']);
        expect(movementsRepository.resolveTransferCodes).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['transfer-1']);
        expect(result.data[0]!.referenceLabel).toBe('Transferencia #SUC-PRIN-ALM-PRIN-005');
      });

      it('names the order behind a RESERVATION / RELEASE too ("Pedido #…") instead of leaving the raw id', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [
            { ...EXISTING_MOVEMENT, id: 'm1', movementType: 'RESERVATION', referenceType: 'order', referenceId: 'order-1', reason: null },
            { ...EXISTING_MOVEMENT, id: 'm2', movementType: 'RESERVATION_RELEASE', referenceType: 'order', referenceId: 'order-1', reason: null },
            { ...EXISTING_MOVEMENT, id: 'm3', movementType: 'SALE', referenceType: 'order', referenceId: 'order-1', reason: null },
          ],
          total: 3,
        });
        movementsRepository.resolveOrderNumbers.mockResolvedValue(new Map([['order-1', 'ORD-000046']]));

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveOrderNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['order-1', 'order-1', 'order-1'], undefined);
        expect(result.data.map((m) => m.referenceLabel)).toEqual(['Pedido #ORD-000046', 'Pedido #ORD-000046', 'Venta #ORD-000046']);
      });

      it('names the return behind a RETURN movement ("Devolución #DEV-001")', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [{ ...EXISTING_MOVEMENT, movementType: 'RETURN', referenceType: 'sales_return_item', referenceId: 'item-1', reason: null }],
          total: 1,
        });
        movementsRepository.resolveReturnNumbers.mockResolvedValue(new Map([['item-1', 'DEV-001']]));

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveReturnNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['item-1'], undefined);
        expect(result.data[0]!.referenceLabel).toBe('Devolución #DEV-001');
      });

      it('names the transfer behind a transfer RESERVATION (referenceType transfer, any movement type)', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({
          rows: [{ ...EXISTING_MOVEMENT, movementType: 'RESERVATION', referenceType: 'transfer', referenceId: 'transfer-1', reason: null }],
          total: 1,
        });
        movementsRepository.resolveTransferCodes.mockResolvedValue(new Map([['transfer-1', 'SUC-001']]));

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(result.data[0]!.referenceLabel).toBe('Transferencia #SUC-001');
      });

      it('leaves referenceLabel undefined for RECEIPT/ADJUSTMENT/etc. — those already show a plain reason', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [EXISTING_MOVEMENT], total: 1 });

        const result = await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(result.data[0]!.referenceLabel).toBeUndefined();
      });
    });

    describe('seller scope of the commercial references (ADR-0040, FASE 19)', () => {
      const SALE_ROW = { ...EXISTING_MOVEMENT, movementType: 'SALE', referenceType: 'order', referenceId: 'order-9', reason: 'order order-9', actorId: 'seller-b' };

      it('asks the resolvers for the caller own orders only when the caller lacks sales.orders.view_all', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [SALE_ROW, { ...SALE_ROW, id: 'm2', movementType: 'RETURN', referenceType: 'sales_return_item', referenceId: 'item-9' }], total: 2 });

        await service.list(TENANT_ID, ACTOR_ID, ['inventory.view'], { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveOrderNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['order-9'], ACTOR_ID);
        expect(movementsRepository.resolveReturnNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['item-9'], ACTOR_ID);
      });

      it('lets the warehouse (inventory.returns.manage) resolve every return, but still only its own orders', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [{ ...SALE_ROW, referenceType: 'sales_return_item', referenceId: 'item-9' }], total: 1 });

        await service.list(TENANT_ID, ACTOR_ID, ['inventory.view', 'inventory.returns.manage'], { page: 1, pageSize: 20 }, CAN_VIEW_COST);

        expect(movementsRepository.resolveReturnNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ['item-9'], undefined);
        expect(movementsRepository.resolveOrderNumbers).toHaveBeenCalledWith(expect.anything(), TENANT_ID, [], ACTOR_ID);
      });

      it('masks a reference that did not resolve: keeps the row and the arithmetic, drops id, reason, actor and number', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [SALE_ROW], total: 1 });

        const [row] = (await service.list(TENANT_ID, ACTOR_ID, ['inventory.view'], { page: 1, pageSize: 20 }, CAN_VIEW_COST)).data;

        expect(row).toMatchObject({ movementType: 'SALE', quantity: Number(SALE_ROW.quantity), balanceAfter: Number(SALE_ROW.balanceAfter), referenceType: 'order', referenceLabel: 'Venta' });
        expect(row).not.toHaveProperty('referenceId');
        expect(row).not.toHaveProperty('reason');
        expect(row).not.toHaveProperty('actorId');
      });

      it('does not mask a reference the caller may see', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [SALE_ROW], total: 1 });
        movementsRepository.resolveOrderNumbers.mockResolvedValue(new Map([['order-9', 'ORD-000009']]));

        const [row] = (await service.list(TENANT_ID, ACTOR_ID, ['inventory.view'], { page: 1, pageSize: 20 }, CAN_VIEW_COST)).data;

        expect(row).toMatchObject({ referenceId: 'order-9', referenceLabel: 'Venta #ORD-000009', actorId: 'seller-b' });
      });
    });

    describe('occurredFrom/occurredTo (F18-03, GAP-MOVEMENTS-DATE-FILTER)', () => {
      it('rejects when occurredFrom is not strictly before occurredTo', async () => {
        const { service } = buildService();
        await expect(
          service.list(
            TENANT_ID,
            ACTOR_ID,
            VIEW_ALL,
            {
              page: 1,
              pageSize: 20,
              occurredFrom: '2026-09-02T00:00:00.000Z',
              occurredTo: '2026-09-02T00:00:00.000Z',
            },
            CAN_VIEW_COST,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.list(
            TENANT_ID,
            ACTOR_ID,
            VIEW_ALL,
            {
              page: 1,
              pageSize: 20,
              occurredFrom: '2026-09-03T00:00:00.000Z',
              occurredTo: '2026-09-02T00:00:00.000Z',
            },
            CAN_VIEW_COST,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('applies only occurredGte when occurredTo is omitted', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
        await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20, occurredFrom: '2026-09-01T00:00:00.000Z' }, CAN_VIEW_COST);
        expect(movementsRepository.listByTenant).toHaveBeenCalledWith(
          expect.anything(),
          TENANT_ID,
          expect.objectContaining({ occurredGte: new Date('2026-09-01T00:00:00.000Z') }),
        );
        const call = movementsRepository.listByTenant.mock.calls[0]![2] as Record<string, unknown>;
        expect(call).not.toHaveProperty('occurredLt');
      });

      it('applies only occurredLt when occurredFrom is omitted', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
        await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20, occurredTo: '2026-09-02T00:00:00.000Z' }, CAN_VIEW_COST);
        expect(movementsRepository.listByTenant).toHaveBeenCalledWith(
          expect.anything(),
          TENANT_ID,
          expect.objectContaining({ occurredLt: new Date('2026-09-02T00:00:00.000Z') }),
        );
        const call = movementsRepository.listByTenant.mock.calls[0]![2] as Record<string, unknown>;
        expect(call).not.toHaveProperty('occurredGte');
      });

      it('applies both bounds when both are given', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
        await service.list(
          TENANT_ID,
          ACTOR_ID,
          VIEW_ALL,
          {
            page: 1,
            pageSize: 20,
            occurredFrom: '2026-09-01T00:00:00.000Z',
            occurredTo: '2026-09-02T00:00:00.000Z',
          },
          CAN_VIEW_COST,
        );
        expect(movementsRepository.listByTenant).toHaveBeenCalledWith(
          expect.anything(),
          TENANT_ID,
          expect.objectContaining({
            occurredGte: new Date('2026-09-01T00:00:00.000Z'),
            occurredLt: new Date('2026-09-02T00:00:00.000Z'),
          }),
        );
      });

      it('passes no occurred bounds at all when neither is given (no regression)', async () => {
        const { service, movementsRepository } = buildService();
        movementsRepository.listByTenant.mockResolvedValue({ rows: [], total: 0 });
        await service.list(TENANT_ID, ACTOR_ID, VIEW_ALL, { page: 1, pageSize: 20 }, CAN_VIEW_COST);
        const call = movementsRepository.listByTenant.mock.calls[0]![2] as Record<string, unknown>;
        expect(call).not.toHaveProperty('occurredGte');
        expect(call).not.toHaveProperty('occurredLt');
      });
    });
  });
});
