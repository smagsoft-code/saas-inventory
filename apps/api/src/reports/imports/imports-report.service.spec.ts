import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ImportsReportService } from './imports-report.service';
import type { ImportsSummaryQueryDto } from './dto/imports-summary-query.dto';
import type { ImportsBucketRow } from './imports-report.repository';

/** Same convention as the other reports service specs (F18-02..08): mock withTenantTransaction to
 * just invoke its callback with a stub `tx` — no database, no Nest DI container. Real-PostgreSQL
 * coverage is test/reports/imports-summary.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

const ZERO: ImportsBucketRow = {
  key: 'total',
  jobCount: '0',
  totalRows: '0',
  validRows: '0',
  invalidRows: '0',
  warningRows: '0',
  importedRows: '0',
};

function buildService() {
  const importsReportRepository = {
    totals: vi.fn().mockResolvedValue(ZERO),
    summaryByPeriod: vi.fn().mockResolvedValue([]),
    summaryByStatus: vi.fn().mockResolvedValue([]),
  };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue(undefined) };
  const service = new ImportsReportService(importsReportRepository as never, tenantSettingsRepository as never);
  return { service, importsReportRepository, tenantSettingsRepository };
}

interface QueryOverrides {
  from?: string | undefined;
  to?: string | undefined;
  groupBy?: ImportsSummaryQueryDto['groupBy'] | undefined;
  status?: ImportsSummaryQueryDto['status'] | undefined;
}

function query(overrides: QueryOverrides = {}): ImportsSummaryQueryDto {
  return {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-08T00:00:00.000Z',
    groupBy: 'day',
    ...overrides,
  } as ImportsSummaryQueryDto;
}

describe('ImportsReportService.getImportsSummary', () => {
  it('rejects when `from` is missing', async () => {
    const { service } = buildService();
    await expect(service.getImportsSummary('t1', query({ from: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `to` is missing', async () => {
    const { service } = buildService();
    await expect(service.getImportsSummary('t1', query({ to: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `from` is not strictly before `to`', async () => {
    const { service } = buildService();
    await expect(
      service.getImportsSummary('t1', query({ from: '2026-09-02T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('dispatches groupBy=day/week/month to summaryByPeriod with the matching date_trunc unit', async () => {
    const { service, importsReportRepository } = buildService();
    for (const groupBy of ['day', 'week', 'month'] as const) {
      importsReportRepository.summaryByPeriod.mockClear();
      await service.getImportsSummary('t1', query({ groupBy }));
      expect(importsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        expect.objectContaining({ unit: groupBy }),
      );
      expect(importsReportRepository.summaryByStatus).not.toHaveBeenCalled();
    }
  });

  it('dispatches groupBy=status to summaryByStatus only', async () => {
    const { service, importsReportRepository } = buildService();
    await service.getImportsSummary('t1', query({ groupBy: 'status' }));
    expect(importsReportRepository.summaryByStatus).toHaveBeenCalledTimes(1);
    expect(importsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
  });

  it('always loads the groupBy-independent totals and passes the status filter through everywhere', async () => {
    const { service, importsReportRepository } = buildService();
    await service.getImportsSummary('t1', query({ status: 'completed' }));
    expect(importsReportRepository.totals).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'completed' }),
    );
    expect(importsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('echoes the resolved tenant timezone, defaulting to UTC with no tenant_settings row', async () => {
    const { service } = buildService();
    const result = await service.getImportsSummary('t1', query());
    expect(result.timezone).toBe('UTC');
  });

  it('echoes the real tenant_settings.timezone when a row exists', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue({ timezone: 'America/Bogota' });
    const result = await service.getImportsSummary('t1', query());
    expect(result.timezone).toBe('America/Bogota');
  });

  it('converts every numeric-string column to a number, in buckets and totals', async () => {
    const { service, importsReportRepository } = buildService();
    importsReportRepository.totals.mockResolvedValue({
      key: 'total',
      jobCount: '3',
      totalRows: '300',
      validRows: '270',
      invalidRows: '20',
      warningRows: '10',
      importedRows: '250',
    });
    importsReportRepository.summaryByStatus.mockResolvedValue([
      { key: 'completed', jobCount: '2', totalRows: '200', validRows: '190', invalidRows: '5', warningRows: '5', importedRows: '190' },
      { key: 'failed', jobCount: '1', totalRows: '100', validRows: '80', invalidRows: '15', warningRows: '5', importedRows: '60' },
    ]);
    const result = await service.getImportsSummary('t1', query({ groupBy: 'status' }));
    expect(result.totals).toEqual({
      key: 'total',
      jobCount: 3,
      totalRows: 300,
      validRows: 270,
      invalidRows: 20,
      warningRows: 10,
      importedRows: 250,
    });
    expect(result.buckets).toEqual([
      { key: 'completed', jobCount: 2, totalRows: 200, validRows: 190, invalidRows: 5, warningRows: 5, importedRows: 190 },
      { key: 'failed', jobCount: 1, totalRows: 100, validRows: 80, invalidRows: 15, warningRows: 5, importedRows: 60 },
    ]);
    expect(result).not.toHaveProperty('currency');
  });

  it('returns an empty buckets array (not an error) when nothing completed in the range', async () => {
    const { service } = buildService();
    const result = await service.getImportsSummary('t1', query());
    expect(result.buckets).toEqual([]);
    expect(result.totals.jobCount).toBe(0);
    expect(result.from).toBe('2026-09-01T00:00:00.000Z');
    expect(result.groupBy).toBe('day');
  });
});
