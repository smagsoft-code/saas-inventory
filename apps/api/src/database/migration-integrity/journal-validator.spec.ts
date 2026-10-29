import { describe, expect, it } from 'vitest';
import { makeFiles, makeJournal, must } from './fixtures';
import { parseJournal, validateJournal } from './journal-validator';
import type { DiagnosticCode, JournalEntry } from './types';

const codes = (entries: readonly JournalEntry[], files = makeFiles(entries)) =>
  validateJournal(entries, files.fileHashes).map((d) => d.code);

describe('validateJournal', () => {
  it('accepts a well-formed journal', () => {
    expect(codes(makeJournal(25))).toEqual([]);
  });

  it('rejects an empty journal', () => {
    expect(codes([])).toEqual(['JOURNAL_EMPTY']);
  });

  it('rejects a gap in the indexes', () => {
    const journal = makeJournal(6).filter((e) => e.idx !== 3);
    const result = codes(journal);
    expect(result).toContain<DiagnosticCode>('JOURNAL_IDX_NOT_CONTIGUOUS');
  });

  it('rejects a duplicated index', () => {
    const journal = makeJournal(5).map((e) => (e.idx === 4 ? { ...e, idx: 3 } : e));
    const result = codes(journal);
    expect(result).toContain<DiagnosticCode>('JOURNAL_IDX_DUPLICATE');
    expect(result).toContain<DiagnosticCode>('JOURNAL_IDX_NOT_CONTIGUOUS');
  });

  it('rejects a duplicated tag', () => {
    const journal = makeJournal(5).map((e) => (e.idx === 4 ? { ...e, tag: must(makeJournal(5)[3]).tag } : e));
    expect(codes(journal)).toContain<DiagnosticCode>('JOURNAL_TAG_DUPLICATE');
  });

  it('rejects a tag whose numeric prefix is not its index', () => {
    const journal = makeJournal(5).map((e) => (e.idx === 2 ? { ...e, tag: '0007_wrong' } : e));
    expect(codes(journal)).toContain<DiagnosticCode>('JOURNAL_TAG_INDEX_MISMATCH');
  });

  it('rejects a "when" equal to the previous one (Drizzle would skip it)', () => {
    const base = makeJournal(5);
    const journal = base.map((e) => (e.idx === 3 ? { ...e, when: must(base[2]).when } : e));
    expect(codes(journal)).toContain<DiagnosticCode>('JOURNAL_WHEN_NOT_INCREASING');
  });

  it('rejects a decreasing "when"', () => {
    const base = makeJournal(5);
    const journal = base.map((e) => (e.idx === 3 ? { ...e, when: must(base[1]).when } : e));
    expect(codes(journal)).toContain<DiagnosticCode>('JOURNAL_WHEN_NOT_INCREASING');
  });

  it('rejects an unusable "when"', () => {
    const journal = makeJournal(3).map((e) => (e.idx === 1 ? { ...e, when: -5 } : e));
    expect(codes(journal)).toContain<DiagnosticCode>('JOURNAL_WHEN_INVALID');
  });

  it('rejects an entry whose SQL file is missing', () => {
    const journal = makeJournal(4);
    const files = makeFiles(journal);
    const missing = { ...files.fileHashes, [must(journal[2]).tag]: null };
    const diagnostics = validateJournal(journal, missing);
    expect(diagnostics.map((d) => d.code)).toEqual(['SQL_FILE_MISSING']);
    expect(diagnostics[0]?.migration).toBe(must(journal[2]).tag);
  });

  it('treats a tag absent from the hash map as a missing file', () => {
    const journal = makeJournal(2);
    expect(validateJournal(journal, {}).map((d) => d.code)).toEqual(['SQL_FILE_MISSING', 'SQL_FILE_MISSING']);
  });
});

describe('parseJournal', () => {
  const good = JSON.stringify({ version: '7', dialect: 'postgresql', entries: makeJournal(2) });

  it('parses a journal', () => {
    const { entries, diagnostics } = parseJournal(good);
    expect(diagnostics).toEqual([]);
    expect(entries).toHaveLength(2);
  });

  it('reports invalid JSON instead of throwing', () => {
    expect(parseJournal('{').diagnostics.map((d) => d.code)).toEqual(['JOURNAL_MALFORMED']);
  });

  it('reports a missing entries array', () => {
    expect(parseJournal('{"version":"7"}').diagnostics.map((d) => d.code)).toEqual(['JOURNAL_MALFORMED']);
  });

  it('reports an entry without the expected fields', () => {
    const text = JSON.stringify({ entries: [{ idx: 0, tag: 'x' }] });
    const result = parseJournal(text);
    expect(result.entries).toEqual([]);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['JOURNAL_MALFORMED']);
  });
});
