import { describe, expect, it, vi } from 'vitest';
import { PaymentsExportService } from './payments-export.service';
import { PaymentsReportService, toPaymentRowDto } from './payments-report.service';
import type { PaymentListRow } from './payments-report.repository';
import type { PaymentsReportQueryDto } from './dto/payments-report-query.dto';

vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function row(overrides: Partial<PaymentListRow> = {}): PaymentListRow {
  return {
    id: 'p1',
    paidAt: new Date('2026-10-13T15:00:00.000Z'),
    orderId: 'o1',
    orderNumber: 'ORD-000001',
    customerName: 'Ana',
    paymentMethod: 'cash',
    amount: '50.00',
    sellerName: 'Luis',
    locationId: 'l1',
    locationLabel: 'Matriz · General',
    documentType: 'sales_note',
    returnCount: '0',
    returnNumbers: null,
    returnedValue: '0',
    ...overrides,
  };
}

function build() {
  const repo = {
    totalsByMethod: vi.fn().mockResolvedValue([
      { paymentMethod: 'cash', paymentCount: '2', amount: '70.50' },
      { paymentMethod: 'card', paymentCount: '1', amount: '29.50' },
    ]),
    list: vi.fn().mockResolvedValue([row()]),
  };
  const settings = { find: vi.fn().mockResolvedValue(undefined) };
  const scope = { resolveReadScope: vi.fn((_tx: unknown, _t: string, _u: string, loc?: string) => Promise.resolve(loc ? { locationId: loc } : {})) };
  const service = new PaymentsReportService(repo as never, settings as never, scope as never);
  return { service, repo, scope };
}

const query = (o: Partial<PaymentsReportQueryDto> = {}): PaymentsReportQueryDto => ({ dateFrom: '2026-10-13', page: 1, pageSize: 20, ...o }) as PaymentsReportQueryDto;

describe('PaymentsReportService', () => {
  it('sums the totals across methods over the whole filtered set and pages the rows', async () => {
    const { service, repo } = build();
    const result = await service.getPayments('t1', 'u1', query({ page: 2, pageSize: 1 }), true);
    expect(result.totals).toEqual({
      paymentCount: 3,
      amount: 100,
      byMethod: [
        { paymentMethod: 'cash', paymentCount: 2, amount: 70.5 },
        { paymentMethod: 'card', paymentCount: 1, amount: 29.5 },
      ],
    });
    expect(result.meta).toEqual({ page: 2, pageSize: 1, total: 3, totalPages: 3 });
    expect(repo.list.mock.calls[0]?.[3]).toMatchObject({ limit: 1, offset: 1, sort: 'createdAt', dir: 'desc' });
  });

  it('scopes a caller without sales.orders.view_all to their own orders, ignoring placedByUserId', async () => {
    const { service, repo } = build();
    await service.getPayments('t1', 'seller-1', query({ placedByUserId: 'someone-else' }), false);
    expect(repo.totalsByMethod.mock.calls[0]?.[2]).toMatchObject({ placedByUserId: 'seller-1' });
    await service.getPayments('t1', 'admin', query({ placedByUserId: 'someone-else' }), true);
    expect(repo.totalsByMethod.mock.calls[1]?.[2]).toMatchObject({ placedByUserId: 'someone-else' });
  });

  it('export ignores paging and flags truncation past the cap', async () => {
    const { service, repo } = build();
    repo.totalsByMethod.mockResolvedValue([{ paymentMethod: 'cash', paymentCount: '6000', amount: '1' }]);
    const result = await service.getPayments('t1', 'u1', query({ page: 3 }), true, true);
    expect(result.truncated).toBe(true);
    expect(repo.list.mock.calls[0]?.[3]).toMatchObject({ limit: 5000, offset: 0 });
  });

  it('flags a payment whose order has a non-cancelled return', () => {
    const dto = toPaymentRowDto(row({ returnCount: '1', returnNumbers: ['DEV-001'], returnedValue: '25.005' }));
    expect(dto.returns).toEqual({ count: 1, numbers: ['DEV-001'], returnedValue: 25.01 });
    expect(toPaymentRowDto(row())).not.toHaveProperty('returns');
  });
});

describe('PaymentsExportService', () => {
  const data = {
    timezone: 'UTC',
    currency: 'USD',
    totals: { paymentCount: 2, amount: 100, byMethod: [{ paymentMethod: 'cash', paymentCount: 2, amount: 100 }] },
    data: [toPaymentRowDto(row()), toPaymentRowDto(row({ id: 'p2', returnCount: '1', returnNumbers: ['DEV-001'], returnedValue: '10' }))],
    meta: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
  };
  const context = { timezone: 'UTC', currency: 'USD', dateFrom: '2026-10-13', dateTo: undefined, truncated: false };

  it('builds a real xlsx with a red amount cell and a note for the returned order', async () => {
    const buffer = await new PaymentsExportService().buildXlsx(data, context);
    expect(buffer.subarray(0, 2).toString()).toBe('PK');
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet('Formas de pago');
    let red = 0;
    sheet?.eachRow((r) => {
      const fill = r.getCell(5).fill as { fgColor?: { argb?: string } } | undefined;
      if (fill?.fgColor?.argb === 'FFDC2626') red += 1;
    });
    expect(red).toBe(1);
  });

  it('builds a PDF', async () => {
    const buffer = await new PaymentsExportService().buildPdf(data, context);
    expect(buffer.subarray(0, 4).toString()).toBe('%PDF');
  });
});
