import { describe, expect, it } from 'vitest';
import type { PaginatedResult } from './index';

describe('types package', () => {
  it('allows constructing a PaginatedResult shape', () => {
    const result: PaginatedResult<{ id: string }> = {
      data: [{ id: '1' }],
      meta: { page: 1, pageSize: 10, total: 1, totalPages: 1 },
    };

    expect(result.data).toHaveLength(1);
  });
});
