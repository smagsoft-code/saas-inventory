import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PlatformSummaryService } from './platform-summary.service';
import type { PlatformSummaryQueryDto } from './dto/platform-summary-query.dto';
import type { PlatformTenantCountsRow } from './platform-summary.repository';

const COUNTS: PlatformTenantCountsRow = {
  totalCount: '12',
  activeCount: '9',
  suspendedCount: '2',
  archivedCount: '1',
  demoCount: '3',
};

function buildService() {
  const platformSummaryRepository = {
    counts: vi.fn().mockResolvedValue(COUNTS),
    newInPeriod: vi.fn().mockResolvedValue(4),
  };
  const service = new PlatformSummaryService(platformSummaryRepository as never);
  return { service, platformSummaryRepository };
}

const query = (overrides: Partial<PlatformSummaryQueryDto> = {}): PlatformSummaryQueryDto =>
  ({ ...overrides }) as PlatformSummaryQueryDto;

describe('PlatformSummaryService.getSummary', () => {
  it('returns the point-in-time counts and period: null when no from/to is given', async () => {
    const { service, platformSummaryRepository } = buildService();
    const result = await service.getSummary(query());
    expect(result.totalCount).toBe(12);
    expect(result.byStatus).toEqual({ active: 9, suspended: 2, archived: 1 });
    expect(result.demoCount).toBe(3);
    expect(result.period).toBeNull();
    expect(platformSummaryRepository.newInPeriod).not.toHaveBeenCalled();
    expect(typeof result.generatedAt).toBe('string');
  });

  it('active + suspended + archived always equals totalCount for a well-formed count row', async () => {
    const { service } = buildService();
    const r = await service.getSummary(query());
    expect(r.byStatus.active + r.byStatus.suspended + r.byStatus.archived).toBe(r.totalCount);
  });

  it('computes newInPeriod (half-open [from, to)) only when BOTH from and to are given', async () => {
    const { service, platformSummaryRepository } = buildService();
    const result = await service.getSummary(query({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }));
    expect(platformSummaryRepository.newInPeriod).toHaveBeenCalledTimes(1);
    expect(result.period).toEqual({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z', newInPeriod: 4 });
  });

  it('rejects `from` without `to`', async () => {
    const { service } = buildService();
    await expect(service.getSummary(query({ from: '2026-09-01T00:00:00.000Z' }))).rejects.toThrow(BadRequestException);
  });

  it('rejects `to` without `from`', async () => {
    const { service } = buildService();
    await expect(service.getSummary(query({ to: '2026-09-01T00:00:00.000Z' }))).rejects.toThrow(BadRequestException);
  });

  it('rejects `from` not strictly before `to`', async () => {
    const { service } = buildService();
    await expect(
      service.getSummary(query({ from: '2026-09-01T00:00:00.000Z', to: '2026-09-01T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('converts every numeric-string count to a number', async () => {
    const { service, platformSummaryRepository } = buildService();
    platformSummaryRepository.counts.mockResolvedValue({
      totalCount: '0',
      activeCount: '0',
      suspendedCount: '0',
      archivedCount: '0',
      demoCount: '0',
    });
    const result = await service.getSummary(query());
    expect(result).toMatchObject({ totalCount: 0, byStatus: { active: 0, suspended: 0, archived: 0 }, demoCount: 0 });
    expect(result).not.toHaveProperty('currency');
    expect(result).not.toHaveProperty('timezone');
  });
});
