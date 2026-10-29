import { describe, expect, it } from 'vitest';
import { evaluateInvariants, type InvariantSnapshot, type OwnedObject, type RlsTable } from './invariants';

const obj = (id: string, name: string, owner = 'app_migrator', kind: OwnedObject['kind'] = 'table'): OwnedObject => ({ kind, id, name, owner });
const rls = (id: string, name: string, enabled = true, forced = true): RlsTable => ({ id, name, enabled, forced });
const snap = (over: Partial<InvariantSnapshot> = {}): InvariantSnapshot => ({ publicObjects: [], drizzleObjects: [], tables: [], ...over });

const GOOD = snap({
  publicObjects: [obj('1', 'public', 'app_migrator', 'schema'), obj('2', 'orders'), obj('3', 'orders_seq', 'app_migrator', 'sequence')],
  drizzleObjects: [obj('9', '__drizzle_migrations', 'postgres')],
  tables: [rls('2', 'orders')],
});
const codes = (before: InvariantSnapshot, after: InvariantSnapshot) => evaluateInvariants(before, after).blocking.map((d) => d.code);

describe('evaluateInvariants', () => {
  it('a correct state raises nothing', () => {
    const e = evaluateInvariants(snap(), GOOD);
    expect(e.blocking).toEqual([]);
    expect(e.preExisting).toEqual({ owner: 0, notForced: 0 });
  });

  it('a table with RLS enabled but not FORCEd is blocking', () => {
    const after = { ...GOOD, tables: [rls('2', 'orders'), rls('4', 'invoices', true, false)] };
    const d = evaluateInvariants(GOOD, after).blocking;
    expect(d.map((x) => x.code)).toEqual(['INVARIANT_RLS_NOT_FORCED']);
    expect(d[0]?.message).toContain('invoices');
  });

  it('an object with the wrong owner is blocking, whatever its kind', () => {
    for (const kind of ['table', 'sequence', 'view', 'function', 'type', 'materialized view'] as const) {
      const after = { ...GOOD, publicObjects: [...GOOD.publicObjects, obj('5', 'thing', 'postgres', kind)] };
      const d = evaluateInvariants(GOOD, after).blocking;
      expect(d.map((x) => x.code)).toEqual(['INVARIANT_OWNER_MISMATCH']);
      expect(d[0]?.message).toContain(`${kind} thing (owner postgres)`);
    }
  });

  it('the schema itself must be owned by app_migrator', () => {
    const after = { ...GOOD, publicObjects: [obj('1', 'public', 'postgres', 'schema'), ...GOOD.publicObjects.slice(1)] };
    expect(codes(GOOD, after)).toEqual(['INVARIANT_OWNER_MISMATCH']);
  });

  it('RLS that was enabled and is now disabled is blocking, even though nothing is "enabled but unforced"', () => {
    const after = { ...GOOD, tables: [rls('2', 'orders', false, false)] };
    expect(codes(GOOD, after)).toEqual(['INVARIANT_RLS_DISABLED']);
  });

  it('losing FORCE on a table that had it is blocking', () => {
    const after = { ...GOOD, tables: [rls('2', 'orders', true, false)] };
    expect(codes(GOOD, after)).toEqual(['INVARIANT_RLS_NOT_FORCED']);
  });

  it('the migration history owned by app_migrator is blocking', () => {
    const after = { ...GOOD, drizzleObjects: [obj('9', '__drizzle_migrations', 'app_migrator')] };
    expect(codes(GOOD, after)).toEqual(['INVARIANT_DRIZZLE_OWNER']);
  });

  it('several violations are all reported, each with its own code', () => {
    const after = snap({
      publicObjects: [...GOOD.publicObjects, obj('5', 'x', 'postgres')],
      drizzleObjects: [obj('9', '__drizzle_migrations', 'app_migrator')],
      tables: [rls('2', 'orders', true, false)],
    });
    expect(codes(GOOD, after).sort()).toEqual(['INVARIANT_DRIZZLE_OWNER', 'INVARIANT_OWNER_MISMATCH', 'INVARIANT_RLS_NOT_FORCED']);
  });

  describe('baseline: deviations that already existed are reported, not blocking', () => {
    const legacy = snap({
      publicObjects: [...GOOD.publicObjects, obj('7', 'old_table', 'postgres')],
      tables: [rls('2', 'orders'), rls('8', 'old_rls', true, false)],
    });

    it('a legacy database with a wrong owner and an unforced table can still migrate', () => {
      const e = evaluateInvariants(legacy, legacy);
      expect(e.blocking).toEqual([]);
      expect(e.preExisting).toEqual({ owner: 1, notForced: 1 });
    });

    it('but a NEW violation on top of the legacy ones is still blocking', () => {
      const after = { ...legacy, publicObjects: [...legacy.publicObjects, obj('9', 'new_one', 'postgres')], tables: [...legacy.tables, rls('10', 'new_rls', true, false)] };
      expect(codes(legacy, after).sort()).toEqual(['INVARIANT_OWNER_MISMATCH', 'INVARIANT_RLS_NOT_FORCED']);
    });

    it('dropping the offending objects is fine', () => {
      expect(evaluateInvariants(legacy, GOOD).blocking).toEqual([]);
    });
  });

  it('a fresh database whose public schema started with another owner passes once 0000 hands it over', () => {
    const before = snap({ publicObjects: [obj('1', 'public', 'pg_database_owner', 'schema')] });
    expect(evaluateInvariants(before, GOOD).blocking).toEqual([]);
  });

  it('lists at most ten names and counts the rest; messages carry no secrets', () => {
    const many = Array.from({ length: 14 }, (_, i) => obj(`${100 + i}`, `t${i}`, 'postgres'));
    const d = evaluateInvariants(snap(), snap({ publicObjects: many })).blocking[0];
    expect(d?.message).toContain('14 object(s)');
    expect(d?.message).toContain('and 4 more');
    expect(d?.message).not.toMatch(/postgres(ql)?:\/\/|password/i);
  });

  it('an empty before/after is a no-op', () => {
    expect(evaluateInvariants(snap(), snap())).toEqual({ blocking: [], preExisting: { owner: 0, notForced: 0 } });
  });
});
