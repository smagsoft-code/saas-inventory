import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { diagnostic } from '../migration-integrity/types';
import { PreCommitInvariantError, invariantCheckFailed, isPreCommitInvariantError, withPreCommitGuard } from './invariants';

/**
 * `withPreCommitGuard` against a fake client: no database. The real behaviour (rollback of the batch, state left
 * behind) is proven in the PostgreSQL harness; here only the contract of the decorator is pinned down.
 */

interface FakeTx {
  readonly marker: string;
}

function fakeSql(events: string[]) {
  const sql = {
    options: { parsers: {} },
    unsafe: () => 'unsafe-passthrough',
    begin: async (callback: (tx: FakeTx) => Promise<unknown>) => {
      events.push('BEGIN');
      try {
        const result = await callback({ marker: 'tx' });
        events.push('COMMIT');
        return result;
      } catch (error) {
        events.push('ROLLBACK');
        throw error;
      }
    },
  };
  return sql as unknown as Sql;
}

describe('withPreCommitGuard', () => {
  it('runs the check inside the transaction: after the callback, before the commit', async () => {
    const events: string[] = [];
    const guard = withPreCommitGuard(fakeSql(events), async (tx) => {
      events.push(`CHECK(${(tx as unknown as FakeTx).marker})`);
    });
    const result = await guard.client.begin((async () => {
      events.push('BATCH');
      return 'batch-result';
    }) as never);
    expect(result).toBe('batch-result');
    expect(events).toEqual(['BEGIN', 'BATCH', 'CHECK(tx)', 'COMMIT']);
    expect(guard.invocations()).toBe(1);
  });

  it('a throwing check makes the transaction roll back and the error reaches the caller', async () => {
    const events: string[] = [];
    const violation = new PreCommitInvariantError([diagnostic('INVARIANT_RLS_NOT_FORCED', 'x')]);
    const guard = withPreCommitGuard(fakeSql(events), async () => {
      throw violation;
    });
    await expect(guard.client.begin(async () => 'ok' as never)).rejects.toBe(violation);
    expect(events).toEqual(['BEGIN', 'ROLLBACK']);
    expect(isPreCommitInvariantError(violation)).toBe(true);
  });

  it('a failing batch never reaches the check', async () => {
    const events: string[] = [];
    const guard = withPreCommitGuard(fakeSql(events), async () => {
      events.push('CHECK');
    });
    await expect(
      guard.client.begin(async () => {
        throw new Error('migration failed');
      }),
    ).rejects.toThrow('migration failed');
    expect(events).toEqual(['BEGIN', 'ROLLBACK']);
    expect(guard.invocations()).toBe(0);
  });

  it('passes every other property through untouched (Drizzle reads options and calls unsafe on the same client)', () => {
    const guard = withPreCommitGuard(fakeSql([]), async () => undefined);
    expect((guard.client as unknown as { options: object }).options).toEqual({ parsers: {} });
    expect((guard.client as unknown as { unsafe: () => string }).unsafe()).toBe('unsafe-passthrough');
  });

  it('reports zero invocations when nothing called begin, which is how a bypass is noticed', () => {
    expect(withPreCommitGuard(fakeSql([]), async () => undefined).invocations()).toBe(0);
  });

  it('turns a failure of the check itself into a violation that carries no connection detail', () => {
    const d = invariantCheckFailed(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: '57P01' }));
    expect(d.code).toBe('INVARIANT_CHECK_FAILED');
    expect(d.message).toContain('57P01');
    expect(d.message).not.toMatch(/127\.0\.0\.1|ECONNREFUSED/);
  });
});
