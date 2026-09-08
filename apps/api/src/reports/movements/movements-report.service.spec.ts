import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { MovementsReportService } from './movements-report.service';
import type { MovementsSummaryQueryDto } from './dto/movements-summary-query.dto';

/** Same convention as the other reports service specs (F18-02..06): mock withTenantTransaction to
 * just invoke its callback with a stub `tx` — no database, no Nest DI container. Real-PostgreSQL
 * coverage is test/reports/movements-summary.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function buildService() {
  const movementsReportRepository = {
    summaryByPeriod: vi.fn().mockResolvedValue([]),
    summaryByType: vi.fn().mockResolvedValue([]),
  };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue(undefined) };
  const service = new MovementsReportService(movementsReportRepository as never, tenantSettingsRepository as never);
  return { service, movementsReportRepository, tenantSettingsRepository };
}

interface QueryOverrides {
  from?: string | undefined;
  to?: string | undefined;
  groupBy?: MovementsSummaryQueryDto['groupBy'] | undefined;
  movementType?: MovementsSummaryQueryDto['movementType'] | undefined;
  locationId?: string | undefined;
  productVariantId?: string | undefined;
}

function query(overrides: QueryOverrides = {}): MovementsSummaryQueryDto {
  return {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-02T00:00:00.000Z',
    groupBy: 'day',
    ...overrides,
  } as MovementsSummaryQueryDto;
}

describe('MovementsReportService.getMovementsSummary', () => {
  it('rejects when `from` is missing', async () => {
    const { service } = buildService();
    await expect(service.getMovementsSummary('t1', query({ from: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `to` is missing', async () => {
    const { service } = buildService();
    await expect(service.getMovementsSummary('t1', query({ to: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `from` is not strictly before `to`', async () => {
    const { service } = buildService();
    await expect(
      service.getMovementsSummary('t1', query({ from: '2026-09-02T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('dispatches groupBy=day/week/month to summaryByPeriod with the matching date_trunc unit', async () => {
    const { service, movementsReportRepository } = buildService();
    for (const groupBy of ['day', 'week', 'month'] as const) {
      movementsReportRepository.summaryByPeriod.mockClear();
      await service.getMovementsSummary('t1', query({ groupBy }));
      expect(movementsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        expect.objectContaining({ unit: groupBy }),
      );
      expect(movementsReportRepository.summaryByType).not.toHaveBeenCalled();
    }
  });

  it('dispatches groupBy=type to summaryByType only', async () => {
    const { service, movementsReportRepository } = buildService();
    await service.getMovementsSummary('t1', query({ groupBy: 'type' }));
    expect(movementsReportRepository.summaryByType).toHaveBeenCalledTimes(1);
    expect(movementsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
  });

  it('passes movementType/locationId/productVariantId filters straight through to the repository', async () => {
    const { service, movementsReportRepository } = buildService();
    await service.getMovementsSummary(
      't1',
      query({ movementType: 'RECEIPT', locationId: 'loc-1', productVariantId: 'var-1' }),
    );
    expect(movementsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ movementType: 'RECEIPT', locationId: 'loc-1', productVariantId: 'var-1' }),
    );
  });

  it('echoes the resolved tenant timezone, defaulting to UTC with no tenant_settings row', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue(undefined);
    const result = await service.getMovementsSummary('t1', query());
    expect(result.timezone).toBe('UTC');
  });

  it('echoes the real tenant_settings.timezone when a row exists', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue({ timezone: 'America/Bogota' });
    const result = await service.getMovementsSummary('t1', query());
    expect(result.timezone).toBe('America/Bogota');
  });

  it('converts numeric-string count/quantity to numbers and preserves the signed sum', async () => {
    const { service, movementsReportRepository } = buildService();
    movementsReportRepository.summaryByType.mockResolvedValue([
      { key: 'RECEIPT', movementCount: '4', totalQuantity: '120' },
      { key: 'SALE', movementCount: '2', totalQuantity: '-15' },
    ]);
    const result = await service.getMovementsSummary('t1', query({ groupBy: 'type' }));
    expect(result.buckets).toEqual([
      { key: 'RECEIPT', movementCount: 4, totalQuantity: 120 },
      { key: 'SALE', movementCount: 2, totalQuantity: -15 },
    ]);
  });

  it('returns an empty buckets array (not an error) when nothing matches the range', async () => {
    const { service } = buildService();
    const result = await service.getMovementsSummary('t1', query());
    expect(result.buckets).toEqual([]);
    expect(result.from).toBe('2026-09-01T00:00:00.000Z');
    expect(result.to).toBe('2026-09-02T00:00:00.000Z');
    expect(result.groupBy).toBe('day');
    expect(result).not.toHaveProperty('currency');
  });
});
