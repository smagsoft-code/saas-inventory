import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalsReportService } from './approvals-report.service';
import type { ApprovalsSummaryQueryDto } from './dto/approvals-summary-query.dto';

/** Same convention as sales-report.service.spec.ts / returns-report.service.spec.ts (F18-02/04):
 * mock withTenantTransaction to just invoke its callback with a stub `tx` — no database, no Nest
 * DI container. Real-PostgreSQL coverage is test/reports/approvals-summary.integration.test.ts. */
vi.mock('../../database/tenant-context', () => ({
  withTenantTransaction: vi.fn(async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
}));

function buildService() {
  const approvalsReportRepository = {
    summaryByPeriod: vi.fn().mockResolvedValue([]),
    summaryByStatus: vi.fn().mockResolvedValue([]),
  };
  const tenantSettingsRepository = { find: vi.fn().mockResolvedValue(undefined) };
  const service = new ApprovalsReportService(approvalsReportRepository as never, tenantSettingsRepository as never);
  return { service, approvalsReportRepository, tenantSettingsRepository };
}

interface QueryOverrides {
  from?: string | undefined;
  to?: string | undefined;
  groupBy?: ApprovalsSummaryQueryDto['groupBy'] | undefined;
  status?: ApprovalsSummaryQueryDto['status'] | undefined;
}

function query(overrides: QueryOverrides = {}): ApprovalsSummaryQueryDto {
  return {
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-09-02T00:00:00.000Z',
    groupBy: 'day',
    ...overrides,
  } as ApprovalsSummaryQueryDto;
}

describe('ApprovalsReportService.getApprovalsSummary', () => {
  it('rejects when `from` is missing', async () => {
    const { service } = buildService();
    await expect(service.getApprovalsSummary('t1', query({ from: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `to` is missing', async () => {
    const { service } = buildService();
    await expect(service.getApprovalsSummary('t1', query({ to: undefined }))).rejects.toThrow(BadRequestException);
  });

  it('rejects when `from` is not strictly before `to`', async () => {
    const { service } = buildService();
    await expect(
      service.getApprovalsSummary('t1', query({ from: '2026-09-02T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.getApprovalsSummary('t1', query({ from: '2026-09-03T00:00:00.000Z', to: '2026-09-02T00:00:00.000Z' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('has NO default status — passes status through as undefined when omitted', async () => {
    const { service, approvalsReportRepository } = buildService();
    await service.getApprovalsSummary('t1', query({ status: undefined }));
    expect(approvalsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: undefined }),
    );
  });

  it('respects an explicit status override', async () => {
    const { service, approvalsReportRepository } = buildService();
    await service.getApprovalsSummary('t1', query({ status: 'approved' }));
    expect(approvalsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({ status: 'approved' }),
    );
  });

  it('dispatches groupBy=day/week/month to summaryByPeriod with the matching date_trunc unit, and never summaryByStatus', async () => {
    const { service, approvalsReportRepository } = buildService();
    for (const groupBy of ['day', 'week', 'month'] as const) {
      approvalsReportRepository.summaryByPeriod.mockClear();
      approvalsReportRepository.summaryByStatus.mockClear();
      await service.getApprovalsSummary('t1', query({ groupBy }));
      expect(approvalsReportRepository.summaryByPeriod).toHaveBeenCalledWith(
        expect.anything(),
        't1',
        expect.objectContaining({ unit: groupBy }),
      );
      expect(approvalsReportRepository.summaryByStatus).not.toHaveBeenCalled();
    }
  });

  it('dispatches groupBy=status to summaryByStatus only', async () => {
    const { service, approvalsReportRepository } = buildService();
    await service.getApprovalsSummary('t1', query({ groupBy: 'status' }));
    expect(approvalsReportRepository.summaryByStatus).toHaveBeenCalledTimes(1);
    expect(approvalsReportRepository.summaryByPeriod).not.toHaveBeenCalled();
  });

  it('echoes the resolved tenant timezone, defaulting to UTC with no tenant_settings row', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue(undefined);
    const result = await service.getApprovalsSummary('t1', query());
    expect(result.timezone).toBe('UTC');
  });

  it('echoes the real tenant_settings.timezone when a row exists', async () => {
    const { service, tenantSettingsRepository } = buildService();
    tenantSettingsRepository.find.mockResolvedValue({ timezone: 'America/Bogota' });
    const result = await service.getApprovalsSummary('t1', query());
    expect(result.timezone).toBe('America/Bogota');
  });

  it('converts numeric-string counts/sums to numbers and computes approvalRate = approved / (approved + rejected), 4dp', async () => {
    const { service, approvalsReportRepository } = buildService();
    approvalsReportRepository.summaryByPeriod.mockResolvedValue([
      {
        key: '2026-09-01',
        requestCount: '10',
        approvedCount: '6',
        rejectedCount: '3',
        cancelledCount: '1',
        pendingCount: '0',
        approvedDiscountValue: '180.00',
      },
    ]);
    const result = await service.getApprovalsSummary('t1', query());
    const bucket = result.buckets[0] as {
      requestCount: number;
      approvedCount: number;
      rejectedCount: number;
      cancelledCount: number;
      pendingCount: number;
      approvedDiscountValue: number;
      approvalRate: number | null;
    };
    expect(bucket.requestCount).toBe(10);
    expect(bucket.approvedCount).toBe(6);
    expect(bucket.rejectedCount).toBe(3);
    expect(bucket.cancelledCount).toBe(1);
    expect(bucket.pendingCount).toBe(0);
    expect(bucket.approvedDiscountValue).toBe(180);
    // 6 / 9 = 0.66666... -> 4dp = 0.6667
    expect(bucket.approvalRate).toBe(0.6667);
  });

  it('approvalRate is null (never NaN/0) when no request in the bucket has been decided', async () => {
    const { service, approvalsReportRepository } = buildService();
    approvalsReportRepository.summaryByPeriod.mockResolvedValue([
      {
        key: '2026-09-01',
        requestCount: '4',
        approvedCount: '0',
        rejectedCount: '0',
        cancelledCount: '1',
        pendingCount: '3',
        approvedDiscountValue: '0',
      },
    ]);
    const result = await service.getApprovalsSummary('t1', query());
    expect((result.buckets[0] as { approvalRate: number | null }).approvalRate).toBeNull();
  });

  it('cancelled requests are excluded from the approvalRate denominator', async () => {
    const { service, approvalsReportRepository } = buildService();
    approvalsReportRepository.summaryByPeriod.mockResolvedValue([
      {
        key: '2026-09-01',
        requestCount: '10',
        approvedCount: '4',
        rejectedCount: '1',
        cancelledCount: '5',
        pendingCount: '0',
        approvedDiscountValue: '40',
      },
    ]);
    const result = await service.getApprovalsSummary('t1', query());
    // 4 / (4 + 1) = 0.8 — the 5 cancelled rows do not dilute it.
    expect((result.buckets[0] as { approvalRate: number | null }).approvalRate).toBe(0.8);
  });

  it('returns an empty buckets array (not an error) when nothing matches the range', async () => {
    const { service } = buildService();
    const result = await service.getApprovalsSummary('t1', query());
    expect(result.buckets).toEqual([]);
    expect(result.from).toBe('2026-09-01T00:00:00.000Z');
    expect(result.to).toBe('2026-09-02T00:00:00.000Z');
    expect(result.groupBy).toBe('day');
    expect(result.currency).toBe('USD');
  });

  it('status buckets carry requestCount + discountValue, never approvalRate', async () => {
    const { service, approvalsReportRepository } = buildService();
    approvalsReportRepository.summaryByStatus.mockResolvedValue([
      { key: 'approved', requestCount: '3', discountValue: '90.00' },
      { key: 'rejected', requestCount: '2', discountValue: '55.00' },
    ]);
    const result = await service.getApprovalsSummary('t1', query({ groupBy: 'status' }));
    expect(result.buckets).toEqual([
      { key: 'approved', requestCount: 3, discountValue: 90 },
      { key: 'rejected', requestCount: 2, discountValue: 55 },
    ]);
    expect(result.buckets[0]).not.toHaveProperty('approvalRate');
  });
});
