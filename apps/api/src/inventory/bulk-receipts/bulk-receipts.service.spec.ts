import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkReceiptsService, type BulkReceiptInput } from './bulk-receipts.service';
import { BULK_RECEIPT_MAX_ROWS } from './bulk-receipts.parser';

/** Same convention as the other service specs: withTenantTransaction just runs its callback. Real
 * PostgreSQL coverage (atomicity, idempotency under HTTP) is test/inventory/bulk-receipts.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() })),
}));

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TENANT = 't1';
const ACTOR = 'u1';
const LOCATION = '0198f1d2-0000-7000-8000-000000000001';

type Cell = string | number | null;

async function workbook(rows: Cell[][], headers: string[] = ['Código', 'Cantidad', 'Costo unitario', 'Motivo']): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Carga');
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function variant(sku: string, overrides: Record<string, unknown> = {}) {
  return { variantId: `variant-${sku}`, sku, productName: `Producto ${sku}`, variantStatus: 'active', productStatus: 'active', isSerialized: false, isLotTracked: false, ...overrides };
}

function build(variants: ReturnType<typeof variant>[] = [variant('PEI-001'), variant('PEI-002')]) {
  const locationsRepository = { findById: vi.fn().mockResolvedValue({ id: LOCATION }) };
  const locationAuthorizationService = { assertAccess: vi.fn().mockResolvedValue(undefined) };
  const lookupRepository = {
    listActive: vi.fn().mockResolvedValue([
      { sku: 'A-1', productName: 'Silla', cost: '12.50' },
      { sku: 'B-1', productName: 'Mesa', cost: null },
    ]),
    findByCodes: vi.fn().mockResolvedValue(new Map(variants.map((v) => [v.sku.toLowerCase(), v]))) };
  let balance = 0;
  const movementsService = {
    createAdjustmentInTx: vi.fn(async (_tx: unknown, _t: string, _a: string, dto: { quantity: number; productVariantId?: string }) => {
      balance += dto.quantity;
      return { id: 'm', balanceAfter: balance };
    }),
  };
  const stored = new Map<string, { requestHash: string; responseBody: unknown }>();
  const idempotencyKeysRepository = {
    find: vi.fn(async (_tx: unknown, _t: string, _s: string, key: string) => stored.get(key)),
    create: vi.fn(async (_tx: unknown, v: { idempotencyKey: string; requestHash: string; responseBody: unknown }) => {
      stored.set(v.idempotencyKey, { requestHash: v.requestHash, responseBody: v.responseBody });
    }),
  };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue({ timezone: 'UTC' }) };
  const service = new BulkReceiptsService(
    locationsRepository as never,
    locationAuthorizationService as never,
    lookupRepository as never,
    movementsService as never,
    idempotencyKeysRepository as never,
    tenantSettingsRepository as never,
  );
  return { service, locationsRepository, locationAuthorizationService, lookupRepository, movementsService, idempotencyKeysRepository };
}

async function input(rows: Cell[][], overrides: Partial<BulkReceiptInput> = {}): Promise<BulkReceiptInput> {
  return { buffer: await workbook(rows), filename: 'carga.xlsx', mimeType: XLSX_MIME, locationId: LOCATION, ...overrides };
}

const META = { correlationId: 'c', ipAddress: 'ip' };

describe('BulkReceiptsService.buildTemplate', () => {
  async function load(service: { buildTemplate: (t: string, c: boolean) => Promise<Buffer> }, canViewCost: boolean): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load((await service.buildTemplate('t1', canViewCost)) as any);
    return wb;
  }

  it('has the four columns, an instructions sheet and a products reference sheet', async () => {
    const { service } = build();
    const wb = await load(service, true);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Carga', 'Instrucciones', 'Productos']);
    expect(wb.worksheets[0]!.getRow(1).values).toEqual([undefined, 'Código', 'Cantidad', 'Costo unitario', 'Motivo']);
  });

  it('the Productos sheet lists code, name and cost for callers who may see costs', async () => {
    const { service, lookupRepository } = build();
    const sheet = (await load(service, true)).getWorksheet('Productos')!;
    expect(lookupRepository.listActive).toHaveBeenCalledWith(expect.anything(), 't1', true);
    expect(sheet.getRow(1).values).toEqual([undefined, 'Código', 'Nombre', 'Costo']);
    expect(sheet.getRow(2).values).toEqual([undefined, 'A-1', 'Silla', 12.5]);
    expect(sheet.getRow(3).getCell(3).value).toBeNull();
  });

  it('without pricing.cost.view the Productos sheet has no cost column and cost is never fetched', async () => {
    const { service, lookupRepository } = build();
    const sheet = (await load(service, false)).getWorksheet('Productos')!;
    expect(lookupRepository.listActive).toHaveBeenCalledWith(expect.anything(), 't1', false);
    expect(sheet.getRow(1).values).toEqual([undefined, 'Código', 'Nombre']);
  });
});

describe('BulkReceiptsService.preview', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('a clean file: every row valid, totals computed, nothing written', async () => {
    const r = await ctx.service.preview(TENANT, ACTOR, await input([['PEI-001', 5, 10.5, 'Compra'], ['pei-002', '3', '4,5', 'Producción']]));
    expect(r).toMatchObject({ totalRows: 2, validRows: 2, invalidRows: 0, totalQuantity: 8, occurredAt: null });
    expect(r.rows[1]).toMatchObject({ code: 'pei-002', quantity: 3, unitCost: 4.5, productName: 'Producto PEI-002', errors: [] });
    expect(ctx.movementsService.createAdjustmentInTx).not.toHaveBeenCalled();
  });

  it('checks the almacén exists and the caller may write to it', async () => {
    await ctx.service.preview(TENANT, ACTOR, await input([['PEI-001', 1, 1, 'x']]));
    expect(ctx.locationAuthorizationService.assertAccess).toHaveBeenCalledWith(expect.anything(), TENANT, ACTOR, LOCATION);
    ctx.locationsRepository.findById.mockResolvedValueOnce(undefined);
    await expect(ctx.service.preview(TENANT, ACTOR, await input([['PEI-001', 1, 1, 'x']]))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('reports every kind of row error, in Spanish, with the real row number', async () => {
    ctx = build([variant('PEI-001'), variant('OLD-1', { variantStatus: 'discontinued' }), variant('SER-1', { isSerialized: true }), variant('LOT-1', { isLotTracked: true })]);
    const r = await ctx.service.preview(
      TENANT,
      ACTOR,
      await input([
        ['', 1, 1, 'x'], // row 2: no code
        ['NOPE', 1, 1, 'x'], // row 3: unknown
        ['PEI-001', 'abc', -1, ''], // row 4: bad qty, negative cost, no reason
        ['OLD-1', 1, 1, 'x'], // row 5: discontinued
        ['SER-1', 1, 1, 'x'], // row 6: serialized
        ['LOT-1', 1, 1, 'x'], // row 7: lot tracked
        ['PEI-001', 0, null, 'x'], // row 8: duplicate code, qty 0, no cost
      ]),
    );
    const errors = (n: number) => r.rows.find((row) => row.rowNumber === n)!.errors.join(' | ');
    expect(errors(2)).toMatch(/código es obligatorio/i);
    expect(errors(3)).toMatch(/No existe un producto con el código «NOPE»/);
    expect(errors(4)).toMatch(/cantidad debe ser un número/);
    expect(errors(4)).toMatch(/costo unitario no puede ser negativo/);
    expect(errors(4)).toMatch(/motivo es obligatorio/);
    expect(errors(5)).toMatch(/descontinuado/);
    expect(errors(6)).toMatch(/número de serie/);
    expect(errors(7)).toMatch(/lote/);
    expect(errors(8)).toMatch(/ya aparece en la fila 4/);
    expect(errors(8)).toMatch(/cantidad debe ser mayor que 0/);
    expect(errors(8)).toMatch(/costo unitario es obligatorio/);
    expect(r.validRows).toBe(0);
    expect(r.invalidRows).toBe(7);
  });

  it('structural problems are request errors: wrong extension/type, missing columns, no rows, too many rows', async () => {
    await expect(ctx.service.preview(TENANT, ACTOR, await input([['PEI-001', 1, 1, 'x']], { filename: 'carga.csv' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.preview(TENANT, ACTOR, await input([['PEI-001', 1, 1, 'x']], { mimeType: 'text/csv' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctx.service.preview(TENANT, ACTOR, { ...(await input([])), buffer: await workbook([['PEI-001', 1]], ['Código', 'Cantidad']) })).rejects.toThrow(/Faltan columnas.*Costo unitario, Motivo/);
    await expect(ctx.service.preview(TENANT, ACTOR, await input([]))).rejects.toThrow(/no tiene filas/);
    const tooMany = Array.from({ length: BULK_RECEIPT_MAX_ROWS + 1 }, (_, i) => [`C-${i}`, 1, 1, 'x'] as Cell[]);
    await expect(ctx.service.preview(TENANT, ACTOR, await input(tooMany))).rejects.toThrow(/más de 500 filas/);
  });

  it('accepts headers in any order, with accents/case differences, and ignores extra columns', async () => {
    const buffer = await workbook([['Compra', 9, 'PEI-001', 2, 'x']], ['motivo', 'CANTIDAD', 'Codigo de producto', 'Costo', 'Notas']);
    const r = await ctx.service.preview(TENANT, ACTOR, { ...(await input([])), buffer });
    expect(r.rows[0]).toMatchObject({ code: 'PEI-001', quantity: 9, unitCost: 2, reason: 'Compra', errors: [] });
  });

  describe('movement date', () => {
    const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date());
    const daysAgo = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(Date.now() - n * 86_400_000));

    it('no date or today = now (occurredAt null); a past day = noon of that day; a future day is rejected', async () => {
      const rows: Cell[][] = [['PEI-001', 1, 1, 'x']];
      expect((await ctx.service.preview(TENANT, ACTOR, await input(rows))).occurredAt).toBeNull();
      expect((await ctx.service.preview(TENANT, ACTOR, await input(rows, { occurredOn: today() }))).occurredAt).toBeNull();
      const past = await ctx.service.preview(TENANT, ACTOR, await input(rows, { occurredOn: daysAgo(10) }));
      expect(past.occurredAt).toBe(`${daysAgo(10)}T12:00:00.000Z`);
      await expect(ctx.service.preview(TENANT, ACTOR, await input(rows, { occurredOn: '2999-01-01' }))).rejects.toThrow(/no puede ser futura/);
      await expect(ctx.service.preview(TENANT, ACTOR, await input(rows, { occurredOn: '05/10/2026' }))).rejects.toThrow(/AAAA-MM-DD/);
    });
  });
});

describe('BulkReceiptsService.confirm', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => {
    ctx = build();
  });

  it('needs an Idempotency-Key', async () => {
    await expect(ctx.service.confirm(TENANT, ACTOR, await input([['PEI-001', 1, 1, 'x']]), undefined, META, true)).rejects.toThrow(/Idempotency-Key/);
  });

  it('ALL OR NOTHING: one bad row => 422 and not a single movement is written', async () => {
    await expect(
      ctx.service.confirm(TENANT, ACTOR, await input([['PEI-001', 1, 1, 'x'], ['NOPE', 1, 1, 'x']]), 'k1', META, true),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(ctx.movementsService.createAdjustmentInTx).not.toHaveBeenCalled();
    expect(ctx.idempotencyKeysRepository.create).not.toHaveBeenCalled();
  });

  it('a clean file writes one RECEIPT per row through the single-adjustment path, with cost, reason and the date', async () => {
    const result = await ctx.service.confirm(
      TENANT,
      ACTOR,
      await input([['PEI-002', 3, 4.5, 'Producción'], ['PEI-001', 5, 10, 'Compra']], { occurredOn: '2020-01-15' }),
      'k2',
      META,
      true,
    );
    expect(result).toMatchObject({ loadedRows: 2, totalQuantity: 8, occurredAt: '2020-01-15T12:00:00.000Z' });
    const calls = ctx.movementsService.createAdjustmentInTx.mock.calls;
    expect(calls).toHaveLength(2);
    // written in a stable variant order (lock order), reported in file order
    expect(calls.map((c) => (c[3] as { productVariantId: string }).productVariantId)).toEqual(['variant-PEI-001', 'variant-PEI-002']);
    expect(calls[0]![3]).toEqual({
      productVariantId: 'variant-PEI-001',
      locationId: LOCATION,
      movementType: 'RECEIPT',
      quantity: 5,
      unitCost: 10,
      reason: 'Compra',
      occurredAt: '2020-01-15T12:00:00.000Z',
    });
    expect(result.movements.map((m) => m.code)).toEqual(['PEI-002', 'PEI-001']);
  });

  it('DOUBLE SUBMIT: the same key + same file replays the first result and writes nothing again', async () => {
    const file = await input([['PEI-001', 5, 10, 'Compra']]);
    const first = await ctx.service.confirm(TENANT, ACTOR, file, 'same-key', META, true);
    ctx.movementsService.createAdjustmentInTx.mockClear();
    const second = await ctx.service.confirm(TENANT, ACTOR, file, 'same-key', META, true);
    expect(second).toEqual(first);
    expect(ctx.movementsService.createAdjustmentInTx).not.toHaveBeenCalled();
  });

  it('the same key with a different file, almacén or date is a 409, not a silent replay', async () => {
    await ctx.service.confirm(TENANT, ACTOR, await input([['PEI-001', 5, 10, 'Compra']]), 'reused', META, true);
    await expect(ctx.service.confirm(TENANT, ACTOR, await input([['PEI-001', 6, 10, 'Compra']]), 'reused', META, true)).rejects.toBeInstanceOf(ConflictException);
    await expect(
      ctx.service.confirm(TENANT, ACTOR, await input([['PEI-001', 5, 10, 'Compra']], { occurredOn: '2020-01-15' }), 'reused', META, true),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
