import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { readMigrationsFolder } from '../migration-files';
import { contextOf, lintMigrations } from './lint-folder';
import type { LintFinding } from './lint-migration';
import { exitCodeFor } from './report';
import { loadSqlParser } from './sql-parser';

/**
 * The linter against the REAL migrations in `database/migrations/` (read only, no database). This is the diagnostic inventory
 * of the 51 migrations that existed when the linter was written, frozen as an expectation: it fails if a rule starts or stops
 * firing on them. No exception is applied anywhere. New migrations (after the 51) are not part of the frozen inventory; they
 * must only satisfy the invariants at the bottom.
 */

const DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'database', 'migrations');
const folder = readMigrationsFolder(DIR);
const HISTORICAL = new Set(folder.historyManifest?.entries.filter((e) => e.reviewedIn?.startsWith('retroactive-review:D-7.2')).map((e) => e.tag));

let all: LintFinding[];
beforeAll(async () => {
  all = lintMigrations(await loadSqlParser(), folder.journal, folder.sqlByTag, folder.historyManifest);
});

const inventory = (findings: readonly LintFinding[]) => {
  const out: Record<string, number> = {};
  for (const f of findings) out[`${f.severity} ${f.ruleId}`] = (out[`${f.severity} ${f.ruleId}`] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

describe('the linter on the 51 historical migrations (diagnostic mode, no exceptions)', () => {
  it('there are 51 of them', () => {
    expect(HISTORICAL.size).toBe(51);
  });

  it('every file parses: no LINT-PARSE-ERROR, no LINT-INTERNAL, no empty file', () => {
    const bad = all.filter((f) => HISTORICAL.has(f.tag) && ['LINT-PARSE-ERROR', 'LINT-INTERNAL', 'LINT-EMPTY'].includes(f.ruleId));
    expect(bad).toEqual([]);
  });

  it('no ERROR at all, so the wrapper can apply a fresh database without any exception', () => {
    const errors = all.filter((f) => HISTORICAL.has(f.tag) && f.severity === 'ERROR');
    expect(errors).toEqual([]);
    expect(exitCodeFor(all.filter((f) => HISTORICAL.has(f.tag)))).toBe(0);
  });

  it('the frozen inventory of findings by rule', () => {
    expect(inventory(all.filter((f) => HISTORICAL.has(f.tag)))).toEqual({
      'INFO ADMIN-EXTENSION': 1,
      'INFO PRIV-OWNER-CHANGE': 1,
      'INFO RLS-ENABLE': 45,
      'INFO RLS-FORCE': 66,
      'INFO RLS-POLICY-CREATE': 52,
      'INFO SESSION-IDENTITY': 3,
      'WARNING PLPGSQL-UNANALYZED': 9,
      'WARNING PRIV-GRANT': 79,
      'WARNING PRIV-GRANT-BROAD': 3,
      'WARNING RLS-POLICY-ALWAYS-TRUE': 6,
      'WARNING RLS-POLICY-CHANGE': 41,
      'WARNING RLS-WINDOW': 21,
      'WARNING RLS-WINDOW-UNGUARDED': 21,
      'WARNING TRIGGER-DISABLE-WINDOW': 1,
    });
  });

  it('PL/pgSQL the parser cannot read exists ONLY in the two migrations declared privileged (otherwise it would be an ERROR)', () => {
    const tags = new Set(all.filter((f) => f.ruleId === 'PLPGSQL-UNANALYZED').map((f) => f.tag));
    expect([...tags].sort()).toEqual(['0000_extensions_and_roles', '0019_import_worker_role']);
    for (const tag of tags) expect(contextOf(folder.historyManifest, tag)).toBe('privileged');
    expect(all.filter((f) => f.ruleId === 'PLPGSQL-UNANALYZED').every((f) => f.severity === 'WARNING' && f.certainty === 'low')).toBe(true);
  });

  it('the twelve migrations with a NO FORCE window each restore FORCE (no RLS-WINDOW-UNRESTORED) and none shows a verification the parser can see', () => {
    const windows = all.filter((f) => f.ruleId === 'RLS-WINDOW');
    expect(new Set(windows.map((f) => f.tag)).size).toBe(12);
    expect(all.filter((f) => f.ruleId === 'RLS-WINDOW-UNRESTORED')).toEqual([]);
    expect(new Set(all.filter((f) => f.ruleId === 'RLS-WINDOW-UNGUARDED').map((f) => f.tag))).toEqual(new Set(windows.map((f) => f.tag)));
  });

  it('every table that enables RLS in a migration also FORCEs it in the same file', () => {
    expect(all.filter((f) => f.ruleId === 'RLS-ENABLE-WITHOUT-FORCE')).toEqual([]);
  });

  it('nothing grants to PUBLIC or to a non-project role, creates a SECURITY DEFINER function, or touches tenant_id', () => {
    for (const id of ['PRIV-GRANT-PUBLIC', 'FUNC-SECURITY-DEFINER', 'TENANT-COLUMN', 'RLS-DISABLE', 'RLS-SETTING', 'RLS-POLICY-PUBLIC', 'ADMIN-DATABASE', 'ADMIN-FILE-ACCESS', 'TXN-CONTROL']) {
      expect(all.filter((f) => f.ruleId === id), id).toEqual([]);
    }
  });

  it('what the privileged migrations hide inside DO blocks is invisible to the linter — that is exactly what PLPGSQL-UNANALYZED says', () => {
    // 0000 creates roles inside DO blocks: no ROLE-DDL finding exists for them, only the unanalysed-body warnings.
    expect(all.filter((f) => f.tag === '0000_extensions_and_roles' && f.ruleId === 'ROLE-DDL')).toEqual([]);
    expect(all.filter((f) => f.tag === '0000_extensions_and_roles' && f.ruleId === 'PLPGSQL-UNANALYZED').length).toBeGreaterThanOrEqual(6);
  });
});

describe('migrations added after the 51', () => {
  it('may not introduce an ERROR (the wrapper would refuse them); their warnings are theirs to justify', () => {
    const newer = all.filter((f) => !HISTORICAL.has(f.tag));
    expect(newer.filter((f) => f.severity === 'ERROR')).toEqual([]);
  });
});
