import { describe, expect, it } from 'vitest';
import type { PaginatedResult, ReportBucket, ReportResult } from './index';

describe('types package', () => {
  it('allows constructing a PaginatedResult shape', () => {
    const result: PaginatedResult<{ id: string }> = {
      data: [{ id: '1' }],
      meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };

    expect(result.data).toHaveLength(1);
  });

  it('allows constructing a grouped ReportResult shape (F18-01)', () => {
    interface DayBucket extends ReportBucket {
      orderCount: number;
    }
    const result: ReportResult<DayBucket> = {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      timezone: 'America/Bogota',
      groupBy: 'day',
      buckets: [{ key: '2026-09-01', orderCount: 3 }],
    };

    expect(result.buckets).toHaveLength(1);
  });

  it('allows constructing an ungrouped ReportResult shape (groupBy omitted, not undefined)', () => {
    const result: ReportResult = {
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-09-02T00:00:00.000Z',
      timezone: 'UTC',
      buckets: [{ key: 'total' }],
    };

    expect(result.groupBy).toBeUndefined();
  });
});
