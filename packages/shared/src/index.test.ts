import { describe, expect, it } from 'vitest';
import { isNonNullable, sleep } from './index';

describe('shared package', () => {
  it('isNonNullable filters null and undefined', () => {
    expect([1, null, 2, undefined, 3].filter(isNonNullable)).toEqual([1, 2, 3]);
  });

  it('sleep resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });
});
