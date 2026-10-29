import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCK_TIMEOUT_SECONDS, MAX_LOCK_TIMEOUT_SECONDS, MIGRATION_LOCK_CLASS, MIGRATION_LOCK_OBJECT, acquireMigrationLock } from './lock';
import type { Queryable } from './rls-window';

/**
 * The lock helper against a fake connection and a fake clock: no database. That two real processes exclude each other,
 * and that the lock goes away with its session, is proven in the PostgreSQL harness.
 */

function fake(script: boolean[]) {
  const calls: { query: string; params: unknown[] | undefined }[] = [];
  let attempt = 0;
  const sql = {
    unsafe: async (query: string, params?: unknown[]) => {
      calls.push({ query, params });
      if (query.includes('pg_try_advisory_lock')) return [{ ok: script[Math.min(attempt++, script.length - 1)] }];
      if (query.includes('pg_advisory_unlock')) return [{ ok: true }];
      return [{ pid: 4242, application_name: 'saas-inventory-migrator', backend_start: '2026-10-28T12:00:00.000Z' }];
    },
  } as unknown as Queryable;
  return { sql, calls, attempts: () => attempt };
}
function clock() {
  let t = 1_000;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe('acquireMigrationLock', () => {
  it('takes a free lock on the first attempt, with the documented key, and does not announce a wait', async () => {
    const f = fake([true]);
    let waited = false;
    const r = await acquireMigrationLock(f.sql, { timeoutMs: 5_000, onWait: () => { waited = true; }, ...clock() });
    expect(r.acquired).toBe(true);
    expect(waited).toBe(false);
    expect(f.calls[0]?.params).toEqual([MIGRATION_LOCK_CLASS, MIGRATION_LOCK_OBJECT]);
    expect(f.calls[0]?.query).toContain('pg_try_advisory_lock');
    if (r.acquired) expect(r.lock.waitedMs).toBe(0);
  });

  it('waits and polls until the holder lets go, announcing the wait once with the holder', async () => {
    const f = fake([false, false, false, true]);
    const holders: (string | undefined)[] = [];
    const r = await acquireMigrationLock(f.sql, { timeoutMs: 10_000, pollMs: 250, onWait: (h) => holders.push(h), ...clock() });
    expect(r.acquired).toBe(true);
    expect(f.attempts()).toBe(4);
    expect(holders).toHaveLength(1);
    expect(holders[0]).toContain('backend pid 4242');
    if (r.acquired) expect(r.lock.waitedMs).toBe(750);
  });

  it('gives up at the timeout with the time waited and the holder, instead of waiting for ever', async () => {
    const f = fake([false]);
    const r = await acquireMigrationLock(f.sql, { timeoutMs: 1_000, pollMs: 250, ...clock() });
    expect(r.acquired).toBe(false);
    if (!r.acquired) {
      expect(r.waitedMs).toBe(1_000);
      expect(r.holder).toContain('4242');
    }
    expect(f.calls.some((c) => c.query.includes('pg_advisory_unlock'))).toBe(false);
  });

  it('a zero timeout is one attempt', async () => {
    const f = fake([false]);
    const r = await acquireMigrationLock(f.sql, { timeoutMs: 0, ...clock() });
    expect(r.acquired).toBe(false);
    expect(f.attempts()).toBe(1);
  });

  it('release unlocks the same key and reports whether this session held it', async () => {
    const f = fake([true]);
    const r = await acquireMigrationLock(f.sql, { timeoutMs: 0, ...clock() });
    if (!r.acquired) throw new Error('not acquired');
    expect(await r.lock.release()).toMatchObject({ released: true });
    const unlock = f.calls.find((c) => c.query.includes('pg_advisory_unlock'));
    expect(unlock?.params).toEqual([MIGRATION_LOCK_CLASS, MIGRATION_LOCK_OBJECT]);
  });

  it('an unreadable holder never breaks the wait (it is only for the message)', async () => {
    let attempt = 0;
    const sql = {
      unsafe: async (query: string) => {
        if (query.includes('pg_try_advisory_lock')) return [{ ok: attempt++ > 0 }];
        throw new Error('permission denied');
      },
    } as unknown as Queryable;
    const r = await acquireMigrationLock(sql, { timeoutMs: 5_000, ...clock() });
    expect(r.acquired).toBe(true);
  });

  it('uses a class that fits int4 and a bounded default timeout', () => {
    expect(MIGRATION_LOCK_CLASS).toBeLessThan(2 ** 31);
    expect(DEFAULT_LOCK_TIMEOUT_SECONDS).toBeLessThanOrEqual(MAX_LOCK_TIMEOUT_SECONDS);
  });
});
