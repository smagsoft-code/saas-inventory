import { describe, expect, it } from 'vitest';
import { generateId, isNonNullable, sleep } from './index';

describe('shared package', () => {
  it('isNonNullable filters null and undefined', () => {
    expect([1, null, 2, undefined, 3].filter(isNonNullable)).toEqual([1, 2, 3]);
  });

  it('sleep resolves after the given delay', async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });

  describe('generateId', () => {
    it('generates a valid UUIDv7 (version nibble 7, RFC 4122 variant)', () => {
      const id = generateId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('generates unique, monotonically-sortable ids for calls close in time', () => {
      const ids = Array.from({ length: 50 }, () => generateId());
      expect(new Set(ids).size).toBe(ids.length);
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });
  });
});
