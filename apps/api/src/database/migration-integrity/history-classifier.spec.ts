import { describe, expect, it } from 'vitest';
import { classifyHistory, parseCreatedAt } from './history-classifier';
import { hashMigrationSql } from './hash';
import { makeFiles, makeJournal, must, registryRows, TAG_0019 } from './fixtures';
import type { DiagnosticCode, RegistryRow, RegistryState } from './types';

const journal = makeJournal(30);
const files = makeFiles(journal);
const privileged = new Set([must(journal[0]).tag, TAG_0019]);

function run(registry: RegistryState, publicTableCount: number, overrides: Partial<Parameters<typeof classifyHistory>[0]> = {}) {
  return classifyHistory({
    journal,
    fileHashes: files.fileHashes,
    registryHashCandidates: files.registryHashCandidates,
    registry,
    publicTableCount,
    privilegedTags: privileged,
    ...overrides,
  });
}
const present = (rows: RegistryRow[]): RegistryState => ({ kind: 'present', rows });
const codesOf = (r: ReturnType<typeof run>): DiagnosticCode[] => r.diagnostics.map((d) => d.code);

describe('classifyHistory — new and consistent states', () => {
  it('a database with no registry and no tables is NEW and everything is pending', () => {
    const r = run({ kind: 'absent' }, 0);
    expect(r.state).toBe('NEW');
    expect(r.pending).toHaveLength(30);
    expect(r.diagnostics).toEqual([]);
  });

  it('an empty registry with no tables is also NEW', () => {
    expect(run(present([]), 0).state).toBe('NEW');
  });

  it('a registry that is an exact prefix is CONSISTENT and the rest is pending', () => {
    const r = run(present(registryRows(journal, 22, files)), 54);
    expect(r.state).toBe('CONSISTENT');
    expect(r.appliedCount).toBe(22);
    expect(r.pending.map((e) => e.idx)).toEqual([22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it('a fully applied registry is CONSISTENT with nothing pending', () => {
    const r = run(present(registryRows(journal, 30, files)), 54);
    expect(r.state).toBe('CONSISTENT');
    expect(r.pending).toEqual([]);
  });
});

describe('classifyHistory — inconsistent states abort with a diagnostic', () => {
  it('no registry but tables exist', () => {
    const r = run({ kind: 'absent' }, 54);
    expect(r.state).toBe('INCONSISTENT');
    expect(codesOf(r)).toEqual(['REGISTRY_MISSING_WITH_TABLES']);
  });

  it('an empty registry but tables exist', () => {
    expect(codesOf(run(present([]), 54))).toEqual(['REGISTRY_EMPTY_WITH_TABLES']);
  });

  it('a registry with rows but no tables', () => {
    expect(codesOf(run(present(registryRows(journal, 5, files)), 0))).toContain('REGISTRY_WITHOUT_TABLES');
  });

  it('registry rows with no journal entry', () => {
    const shortJournal = journal.slice(0, 10);
    const r = classifyHistory({
      journal: shortJournal,
      fileHashes: files.fileHashes,
      registryHashCandidates: files.registryHashCandidates,
      registry: present(registryRows(journal, 12, files)),
      publicTableCount: 54,
    });
    expect(codesOf(r)).toEqual(['REGISTRY_ROW_WITHOUT_JOURNAL_ENTRY', 'REGISTRY_ROW_WITHOUT_JOURNAL_ENTRY']);
  });

  it('a row that is not the journal entry at its position', () => {
    const rows = registryRows(journal, 10, files);
    rows[4] = { ...must(rows[4]), createdAt: must(rows[4]).createdAt + 1 };
    const r = run(present(rows), 54);
    expect(r.state).toBe('INCONSISTENT');
    expect(codesOf(r)).toContain('HISTORY_NOT_PREFIX');
  });

  it('a migration skipped in the middle of the registry is named', () => {
    const rows = registryRows(journal, 10, files);
    rows.splice(5, 1); // migration 5 is missing; rows 6.. shift up
    const r = run(present(rows), 54);
    expect(codesOf(r)).toContain('HISTORY_MISSING_APPLIED_MIGRATION');
    expect(r.diagnostics.find((d) => d.code === 'HISTORY_MISSING_APPLIED_MIGRATION')?.details).toMatchObject({ skipped: must(journal[5]).tag });
  });

  it('a missing PRIVILEGED migration with later ones applied is reported as such', () => {
    const rows = registryRows(journal, 25, files);
    rows.splice(19, 1); // 0019 never recorded
    const r = run(present(rows), 54);
    expect(codesOf(r)).toContain('PRIVILEGED_MIGRATION_MISSING_FROM_HISTORY');
    expect(r.diagnostics.find((d) => d.code === 'PRIVILEGED_MIGRATION_MISSING_FROM_HISTORY')?.migration).toBe(TAG_0019);
  });

  it('a registered hash that differs from the file (file edited after being applied)', () => {
    const rows = registryRows(journal, 10, files);
    rows[3] = { ...must(rows[3]), hash: hashMigrationSql('SELECT "something else";') };
    const r = run(present(rows), 54);
    expect(codesOf(r)).toEqual(['HISTORY_HASH_MISMATCH']);
    expect(r.diagnostics[0]?.migration).toBe(must(journal[3]).tag);
  });

  it('a forged row with a very high created_at makes pending migrations unreachable and is caught', () => {
    const rows = registryRows(journal, 20, files);
    rows.push({ hash: 'x', createdAt: 9_999_999_999_999 });
    const r = run(present(rows), 54);
    expect(r.state).toBe('INCONSISTENT');
    expect(codesOf(r)).toContain('HISTORY_NOT_PREFIX');
    expect(codesOf(r)).toContain('PENDING_WHEN_AT_OR_BELOW_MAX_APPLIED');
  });

  it('an unusable created_at in the registry', () => {
    const rows = registryRows(journal, 5, files);
    rows[2] = { ...must(rows[2]), createdAt: Number.NaN };
    expect(codesOf(run(present(rows), 54))).toContain('REGISTRY_ROW_INVALID');
  });

  it('a malformed journal stops the classification before the registry is compared', () => {
    const broken = journal.map((e) => (e.idx === 7 ? { ...e, when: must(journal[6]).when } : e));
    const r = classifyHistory({
      journal: broken,
      fileHashes: files.fileHashes,
      registryHashCandidates: files.registryHashCandidates,
      registry: present(registryRows(journal, 10, files)),
      publicTableCount: 54,
    });
    expect(r.state).toBe('INCONSISTENT');
    expect(codesOf(r)).toEqual(['JOURNAL_WHEN_NOT_INCREASING']);
  });
});

describe('classifyHistory — line endings', () => {
  it('accepts a registry written from a CRLF checkout of the same content', () => {
    const rows = registryRows(journal, 8, files).map((row, i) => ({
      ...row,
      hash: hashMigrationSql(must(files.sqlByTag[must(journal[i]).tag]).replace(/\n/g, '\r\n')),
    }));
    expect(run(present(rows), 54).state).toBe('CONSISTENT');
  });
});

describe('parseCreatedAt', () => {
  it('parses the bigint string postgres.js returns', () => {
    expect(parseCreatedAt('1790006292917')).toBe(1_790_006_292_917);
    expect(parseCreatedAt(1790006292917)).toBe(1_790_006_292_917);
    expect(parseCreatedAt(1790006292917n)).toBe(1_790_006_292_917);
  });

  it.each([['abc'], ['-5'], ['0'], ['1.5'], ['9'.repeat(30)]])('rejects %s', (value) => {
    expect(parseCreatedAt(value)).toBeNull();
  });
});
