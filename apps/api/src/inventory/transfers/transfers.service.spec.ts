import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsufficientStockError } from '../stock-ledger.service';
import { TransfersService } from './transfers.service';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const TENANT_ID = 'tenant-1';
const ACTOR_ID = 'actor-1';
const TRANSFER_ID = 'transfer-1';
const SOURCE_ID = 'source-1';
const DEST_ID = 'dest-1';
const VARIANT_ID = 'variant-1';
const META = { correlationId: undefined, ipAddress: undefined };

function transfer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TRANSFER_ID,
    tenantId: TENANT_ID,
    code: 'WH-SRC-001',
    sourceLocationId: SOURCE_ID,
    destinationLocationId: DEST_ID,
    status: 'draft',
    requestedBy: ACTOR_ID,
    approvedBy: null,
    dispatchedBy: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    approvedAt: null,
    dispatchedAt: null,
    receivedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

function item(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'item-1',
    tenantId: TENANT_ID,
    transferId: TRANSFER_ID,
    productVariantId: VARIANT_ID,
    quantityRequested: '10',
    quantityDispatched: '0',
    quantityReceived: '0',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildService() {
  const transfersRepository = { findById: vi.fn(), lockById: vi.fn(), listByTenant: vi.fn(), create: vi.fn(), update: vi.fn(), nextTransferCode: vi.fn() };
  const itemsRepository = { listByTransfer: vi.fn(), findById: vi.fn(), createMany: vi.fn(), setDispatched: vi.fn(), incrementReceived: vi.fn() };
  const receiptsRepository = { createReceipt: vi.fn(), createReceiptItems: vi.fn(), listByTransfer: vi.fn() };
  const locationsRepository = { findById: vi.fn() };
  const warehousesRepository = { findById: vi.fn() };
  const balancesRepository = { findByVariantAndLocation: vi.fn() };
  const productVariantsLookup = { exists: vi.fn(), findByIds: vi.fn().mockResolvedValue([]) };
  const workflowConfigRepository = { get: vi.fn().mockResolvedValue({ requireApproval: true, requirePreparation: true }) };
  const locationAuthorizationService = { assertAccess: vi.fn() };
  const stockLedgerService = { applyMovement: vi.fn() };
  const idempotencyKeysRepository = { find: vi.fn(), create: vi.fn() };
  const auditLogService = { record: vi.fn() };
  const movingAverageCostService = { getCurrentAverageCost: vi.fn().mockResolvedValue({ stock: 0, averageCost: 0, estimated: false }) };
  const movementsRepository = { findOneByReference: vi.fn().mockResolvedValue(undefined) };

  const service = new TransfersService(
    transfersRepository as never,
    itemsRepository as never,
    receiptsRepository as never,
    locationsRepository as never,
    warehousesRepository as never,
    balancesRepository as never,
    productVariantsLookup as never,
    workflowConfigRepository as never,
    locationAuthorizationService as never,
    stockLedgerService as never,
    idempotencyKeysRepository as never,
    auditLogService as never,
    movingAverageCostService as never,
    movementsRepository as never,
  );

  itemsRepository.listByTransfer.mockResolvedValue([]);
  warehousesRepository.findById.mockResolvedValue({ id: 'warehouse-1', code: 'WH' });
  balancesRepository.findByVariantAndLocation.mockResolvedValue({ quantityAvailable: '1000' });
  transfersRepository.nextTransferCode.mockResolvedValue('WH-SRC-001');

  return {
    service,
    transfersRepository,
    itemsRepository,
    receiptsRepository,
    locationsRepository,
    warehousesRepository,
    balancesRepository,
    workflowConfigRepository,
    productVariantsLookup,
    locationAuthorizationService,
    stockLedgerService,
    idempotencyKeysRepository,
    auditLogService,
    movingAverageCostService,
    movementsRepository,
  };
}

describe('TransfersService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('create', () => {
    it('rejects source === destination (400)', async () => {
      const { service } = buildService();
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { sourceLocationId: SOURCE_ID, destinationLocationId: SOURCE_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 1 }] }, META),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate productVariantId across items (400)', async () => {
      const { service, locationsRepository } = buildService();
      locationsRepository.findById.mockResolvedValue({ id: SOURCE_ID });
      await expect(
        service.create(
          TENANT_ID,
          ACTOR_ID,
          {
            sourceLocationId: SOURCE_ID,
            destinationLocationId: DEST_ID,
            items: [
              { productVariantId: VARIANT_ID, quantityRequested: 1 },
              { productVariantId: VARIANT_ID, quantityRequested: 2 },
            ],
          },
          META,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the source location does not exist in this tenant', async () => {
      const { service, locationsRepository } = buildService();
      locationsRepository.findById.mockResolvedValue(undefined);
      await expect(
        service.create(TENANT_ID, ACTOR_ID, { sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 1 }] }, META),
      ).rejects.toThrow(NotFoundException);
    });

    it('creates the transfer header and items on success', async () => {
      const { service, locationsRepository, productVariantsLookup, transfersRepository, itemsRepository } = buildService();
      locationsRepository.findById.mockResolvedValue({ id: SOURCE_ID });
      productVariantsLookup.exists.mockResolvedValue(true);
      transfersRepository.create.mockResolvedValue(transfer());

      await service.create(TENANT_ID, ACTOR_ID, { sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 5 }] }, META);

      expect(transfersRepository.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: 'WH-SRC-001', sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, requestedBy: ACTOR_ID }),
      );
      expect(itemsRepository.createMany).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ productVariantId: VARIANT_ID, quantityRequested: 5 })]);
    });

    it('rejects a quantityRequested above the source location\'s available stock (409) — spec §4, an advisory pre-check, not a reservation', async () => {
      const { service, locationsRepository, productVariantsLookup, balancesRepository, transfersRepository } = buildService();
      locationsRepository.findById.mockResolvedValue({ id: SOURCE_ID, warehouseId: 'warehouse-1', code: 'SRC' });
      productVariantsLookup.exists.mockResolvedValue(true);
      balancesRepository.findByVariantAndLocation.mockResolvedValue({ quantityAvailable: '3' });

      await expect(
        service.create(TENANT_ID, ACTOR_ID, { sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 5 }] }, META),
      ).rejects.toThrow(ConflictException);
      expect(transfersRepository.create).not.toHaveBeenCalled();
    });

    it('treats a missing balance row as zero available stock', async () => {
      const { service, locationsRepository, productVariantsLookup, balancesRepository } = buildService();
      locationsRepository.findById.mockResolvedValue({ id: SOURCE_ID, warehouseId: 'warehouse-1', code: 'SRC' });
      productVariantsLookup.exists.mockResolvedValue(true);
      balancesRepository.findByVariantAndLocation.mockResolvedValue(undefined);

      await expect(
        service.create(TENANT_ID, ACTOR_ID, { sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 1 }] }, META),
      ).rejects.toThrow(ConflictException);
    });

    it('generates the code from the source warehouse/location scope (nextTransferCode)', async () => {
      const { service, locationsRepository, productVariantsLookup, transfersRepository, warehousesRepository } = buildService();
      locationsRepository.findById.mockResolvedValue({ id: SOURCE_ID, warehouseId: 'warehouse-1', code: 'SRC' });
      productVariantsLookup.exists.mockResolvedValue(true);
      warehousesRepository.findById.mockResolvedValue({ id: 'warehouse-1', code: 'MATR' });
      transfersRepository.nextTransferCode.mockResolvedValue('MATR-SRC-004');
      transfersRepository.create.mockResolvedValue(transfer({ code: 'MATR-SRC-004' }));

      await service.create(TENANT_ID, ACTOR_ID, { sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 1 }] }, META);

      expect(transfersRepository.nextTransferCode).toHaveBeenCalledWith(expect.anything(), TENANT_ID, SOURCE_ID, 'MATR', 'SRC');
      expect(transfersRepository.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ code: 'MATR-SRC-004' }));
    });

    it('F17-TRANSFERS-AUDIT §1: auto-approves but does NOT auto-prepare when only requireApproval is disabled', async () => {
      const { service, locationsRepository, productVariantsLookup, transfersRepository, workflowConfigRepository, stockLedgerService } = buildService();
      locationsRepository.findById.mockResolvedValue({ id: SOURCE_ID, warehouseId: 'warehouse-1', code: 'SRC' });
      productVariantsLookup.exists.mockResolvedValue(true);
      workflowConfigRepository.get.mockResolvedValue({ requireApproval: false, requirePreparation: true });
      transfersRepository.create.mockResolvedValue(transfer({ status: 'draft' }));
      transfersRepository.update.mockImplementation((..._args: unknown[]) => {
        const values = _args[3] as Record<string, unknown>;
        return Promise.resolve(transfer({ status: 'approved', ...values }));
      });

      const result = await service.create(
        TENANT_ID,
        ACTOR_ID,
        { sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 1 }] },
        META,
      );

      expect(result.status).toBe('approved');
      expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    });

    it('F17-TRANSFERS-AUDIT §1: auto-approves AND auto-prepares (reserves stock) when both gates are disabled', async () => {
      const {
        service,
        locationsRepository,
        productVariantsLookup,
        transfersRepository,
        workflowConfigRepository,
        stockLedgerService,
        itemsRepository,
        locationAuthorizationService,
      } = buildService();
      locationsRepository.findById.mockResolvedValue({ id: SOURCE_ID, warehouseId: 'warehouse-1', code: 'SRC' });
      productVariantsLookup.exists.mockResolvedValue(true);
      workflowConfigRepository.get.mockResolvedValue({ requireApproval: false, requirePreparation: false });
      transfersRepository.create.mockResolvedValue(transfer({ status: 'draft' }));
      transfersRepository.update.mockImplementation((..._args: unknown[]) => {
        const values = _args[3] as { status?: string };
        return Promise.resolve(transfer({ status: values.status ?? 'draft', ...values }));
      });
      itemsRepository.listByTransfer.mockResolvedValue([item({ quantityRequested: '3' })]);
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });

      const result = await service.create(
        TENANT_ID,
        ACTOR_ID,
        { sourceLocationId: SOURCE_ID, destinationLocationId: DEST_ID, items: [{ productVariantId: VARIANT_ID, quantityRequested: 3 }] },
        META,
      );

      expect(result.status).toBe('preparing');
      expect(locationAuthorizationService.assertAccess).toHaveBeenCalledWith(expect.anything(), TENANT_ID, ACTOR_ID, SOURCE_ID);
      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ movementType: 'RESERVATION', quantity: 3, locationId: SOURCE_ID }),
      );
    });
  });

  describe('approve', () => {
    it('rejects a transfer not in draft status (409)', async () => {
      const { service, transfersRepository } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'approved' }));
      await expect(service.approve(TENANT_ID, ACTOR_ID, TRANSFER_ID, META)).rejects.toThrow(ConflictException);
    });

    it('transitions draft to approved and does not auto-advance when both gates are required (default)', async () => {
      const { service, transfersRepository, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'draft' }));
      transfersRepository.update.mockResolvedValue(transfer({ status: 'approved', approvedBy: ACTOR_ID }));

      const result = await service.approve(TENANT_ID, ACTOR_ID, TRANSFER_ID, META);

      expect(result.status).toBe('approved');
      expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    });

    it('F17-TRANSFERS-AUDIT §1: auto-prepares (reserves stock) right after approving when requirePreparation is disabled', async () => {
      const { service, transfersRepository, workflowConfigRepository, itemsRepository, locationAuthorizationService, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'draft' }));
      workflowConfigRepository.get.mockResolvedValue({ requireApproval: true, requirePreparation: false });
      transfersRepository.update.mockImplementation((..._args: unknown[]) => {
        const values = _args[3] as { status?: string };
        return Promise.resolve(transfer({ status: values.status ?? 'approved', ...values }));
      });
      itemsRepository.listByTransfer.mockResolvedValue([item({ quantityRequested: '5' })]);
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });

      const result = await service.approve(TENANT_ID, ACTOR_ID, TRANSFER_ID, META);

      expect(result.status).toBe('preparing');
      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ movementType: 'RESERVATION', quantity: 5 }));
    });

    it('throws NotFoundException for a nonexistent/foreign-tenant transfer', async () => {
      const { service, transfersRepository } = buildService();
      transfersRepository.lockById.mockResolvedValue(undefined);
      await expect(service.approve(TENANT_ID, ACTOR_ID, TRANSFER_ID, META)).rejects.toThrow(NotFoundException);
    });
  });

  describe('prepare', () => {
    it('rejects a transfer not in approved status (409)', async () => {
      const { service, transfersRepository } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'draft' }));
      await expect(service.prepare(TENANT_ID, ACTOR_ID, TRANSFER_ID, META)).rejects.toThrow(ConflictException);
    });

    it('propagates ForbiddenException from location authorization before reserving stock (ADR-0024)', async () => {
      const { service, transfersRepository, locationAuthorizationService, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'approved' }));
      locationAuthorizationService.assertAccess.mockRejectedValue(new ForbiddenException());
      await expect(service.prepare(TENANT_ID, ACTOR_ID, TRANSFER_ID, META)).rejects.toThrow(ForbiddenException);
      expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    });

    it('maps InsufficientStockError to ConflictException', async () => {
      const { service, transfersRepository, locationAuthorizationService, itemsRepository, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'approved' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item()]);
      stockLedgerService.applyMovement.mockRejectedValue(new InsufficientStockError('Insufficient available stock for this operation.'));
      await expect(service.prepare(TENANT_ID, ACTOR_ID, TRANSFER_ID, META)).rejects.toThrow(ConflictException);
    });

    it('reserves each item at the source location and transitions to preparing', async () => {
      const { service, transfersRepository, locationAuthorizationService, itemsRepository, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'approved' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item({ quantityRequested: '7' })]);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });
      transfersRepository.update.mockResolvedValue(transfer({ status: 'preparing' }));

      await service.prepare(TENANT_ID, ACTOR_ID, TRANSFER_ID, META);

      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ movementType: 'RESERVATION', quantity: 7, locationId: SOURCE_ID }));
      expect(transfersRepository.update).toHaveBeenCalledWith(expect.anything(), TENANT_ID, TRANSFER_ID, expect.objectContaining({ status: 'preparing' }));
    });
  });

  describe('dispatch', () => {
    it('rejects a transfer not in preparing status (409)', async () => {
      const { service, transfersRepository } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'approved' }));
      await expect(service.dispatch(TENANT_ID, ACTOR_ID, TRANSFER_ID, {}, META)).rejects.toThrow(ConflictException);
    });

    it('releases the full reservation and dispatches the full requested quantity by default', async () => {
      const { service, transfersRepository, locationAuthorizationService, itemsRepository, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'preparing' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item({ quantityRequested: '10' })]);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });
      transfersRepository.update.mockResolvedValue(transfer({ status: 'dispatched' }));

      await service.dispatch(TENANT_ID, ACTOR_ID, TRANSFER_ID, {}, META);

      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ movementType: 'RESERVATION_RELEASE', quantity: 10 }));
      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ movementType: 'TRANSFER_OUT', quantity: 10, idempotencyKey: `transfer-dispatch:${TRANSFER_ID}:item-1` }),
      );
      expect(itemsRepository.setDispatched).toHaveBeenCalledWith(expect.anything(), TENANT_ID, 'item-1', 10);
    });

    it('supports a short-shipped quantity (releases full requested, dispatches only the override)', async () => {
      const { service, transfersRepository, locationAuthorizationService, itemsRepository, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'preparing' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item({ id: 'item-1', quantityRequested: '10' })]);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });
      transfersRepository.update.mockResolvedValue(transfer({ status: 'dispatched' }));

      await service.dispatch(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityDispatched: 6 }] }, META);

      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ movementType: 'RESERVATION_RELEASE', quantity: 10 }));
      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ movementType: 'TRANSFER_OUT', quantity: 6 }));
    });

    it('rejects quantityDispatched exceeding quantityRequested (400)', async () => {
      const { service, transfersRepository, locationAuthorizationService, itemsRepository } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'preparing' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item({ id: 'item-1', quantityRequested: '10' })]);

      await expect(service.dispatch(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityDispatched: 99 }] }, META)).rejects.toThrow(BadRequestException);
    });
  });

  describe('receive', () => {
    it('requires an Idempotency-Key header (400)', async () => {
      const { service } = buildService();
      await expect(service.receive(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityReceived: 1 }] }, META, undefined)).rejects.toThrow(BadRequestException);
    });

    it('returns the cached response on a retried key with the same request body', async () => {
      const { service, idempotencyKeysRepository, transfersRepository } = buildService();
      const dto = { items: [{ transferItemId: 'item-1', quantityReceived: 5 }] };
      const cached = { id: TRANSFER_ID, status: 'received' };
      idempotencyKeysRepository.find.mockResolvedValue({
        requestHash: createHash('sha256').update(JSON.stringify(dto)).digest('hex'),
        responseBody: cached,
      });

      const result = await service.receive(TENANT_ID, ACTOR_ID, TRANSFER_ID, dto, META, 'idem-key-1');

      expect(result).toEqual(cached);
      expect(transfersRepository.lockById).not.toHaveBeenCalled();
    });

    it('rejects key reuse with a different request body (409)', async () => {
      const { service, idempotencyKeysRepository } = buildService();
      idempotencyKeysRepository.find.mockResolvedValue({ requestHash: 'different-hash', responseBody: {} });
      await expect(
        service.receive(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityReceived: 5 }] }, META, 'idem-key-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a transfer not dispatched/partially_received (409)', async () => {
      const { service, idempotencyKeysRepository, transfersRepository } = buildService();
      idempotencyKeysRepository.find.mockResolvedValue(undefined);
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'preparing' }));
      await expect(
        service.receive(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityReceived: 5 }] }, META, 'idem-key-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects receiving more than remains undelivered (400)', async () => {
      const { service, idempotencyKeysRepository, transfersRepository, locationAuthorizationService, itemsRepository } = buildService();
      idempotencyKeysRepository.find.mockResolvedValue(undefined);
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'dispatched' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item({ id: 'item-1', quantityDispatched: '10', quantityReceived: '8' })]);

      await expect(
        service.receive(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityReceived: 5 }] }, META, 'idem-key-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('fully receives, writes TRANSFER_IN, and marks the transfer received', async () => {
      const {
        service,
        idempotencyKeysRepository,
        transfersRepository,
        locationAuthorizationService,
        itemsRepository,
        receiptsRepository,
        stockLedgerService,
      } = buildService();
      idempotencyKeysRepository.find.mockResolvedValue(undefined);
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'dispatched' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item({ id: 'item-1', quantityDispatched: '10', quantityReceived: '0' })]);
      receiptsRepository.createReceipt.mockResolvedValue({ id: 'receipt-1' });
      receiptsRepository.createReceiptItems.mockResolvedValue([]);
      itemsRepository.incrementReceived.mockResolvedValue(undefined);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });
      transfersRepository.update.mockResolvedValue(transfer({ status: 'received' }));

      await service.receive(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityReceived: 10 }] }, META, 'idem-key-1');

      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ movementType: 'TRANSFER_IN', quantity: 10, locationId: DEST_ID, referenceType: 'transfer_receipt', referenceId: 'receipt-1' }),
      );
      expect(transfersRepository.update).toHaveBeenCalledWith(expect.anything(), TENANT_ID, TRANSFER_ID, expect.objectContaining({ status: 'received' }));
      expect(idempotencyKeysRepository.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idempotencyKey: 'idem-key-1', scope: 'transfer.receive' }));
    });

    it('partial receipt keeps the transfer partially_received', async () => {
      const { service, idempotencyKeysRepository, transfersRepository, locationAuthorizationService, itemsRepository, receiptsRepository, stockLedgerService } = buildService();
      idempotencyKeysRepository.find.mockResolvedValue(undefined);
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'dispatched' }));
      locationAuthorizationService.assertAccess.mockResolvedValue(undefined);
      itemsRepository.listByTransfer.mockResolvedValue([item({ id: 'item-1', quantityDispatched: '10', quantityReceived: '0' })]);
      receiptsRepository.createReceipt.mockResolvedValue({ id: 'receipt-1' });
      receiptsRepository.createReceiptItems.mockResolvedValue([]);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });
      transfersRepository.update.mockResolvedValue(transfer({ status: 'partially_received' }));

      await service.receive(TENANT_ID, ACTOR_ID, TRANSFER_ID, { items: [{ transferItemId: 'item-1', quantityReceived: 4 }] }, META, 'idem-key-1');

      expect(transfersRepository.update).toHaveBeenCalledWith(expect.anything(), TENANT_ID, TRANSFER_ID, expect.objectContaining({ status: 'partially_received' }));
    });
  });

  describe('cancel', () => {
    it('rejects cancellation once dispatched (409) — a dispatched transfer cannot be cancelled per ADR-0020', async () => {
      const { service, transfersRepository } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'dispatched' }));
      await expect(service.cancel(TENANT_ID, ACTOR_ID, TRANSFER_ID, META)).rejects.toThrow(ConflictException);
    });

    it('releases the reservation when cancelling from preparing', async () => {
      const { service, transfersRepository, itemsRepository, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'preparing' }));
      itemsRepository.listByTransfer.mockResolvedValue([item({ quantityRequested: '10' })]);
      stockLedgerService.applyMovement.mockResolvedValue({ balance: {}, movement: {} });
      transfersRepository.update.mockResolvedValue(transfer({ status: 'cancelled' }));

      await service.cancel(TENANT_ID, ACTOR_ID, TRANSFER_ID, META);

      expect(stockLedgerService.applyMovement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ movementType: 'RESERVATION_RELEASE', quantity: 10 }));
    });

    it('does not touch the ledger when cancelling from draft', async () => {
      const { service, transfersRepository, stockLedgerService } = buildService();
      transfersRepository.lockById.mockResolvedValue(transfer({ status: 'draft' }));
      transfersRepository.update.mockResolvedValue(transfer({ status: 'cancelled' }));

      await service.cancel(TENANT_ID, ACTOR_ID, TRANSFER_ID, META);

      expect(stockLedgerService.applyMovement).not.toHaveBeenCalled();
    });
  });
});
