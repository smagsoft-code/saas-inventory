import { describe, expect, it } from 'vitest';
import { canonicalMigrationHash, hashMigrationSql, registryHashCandidates } from './hash';
import {
  appendMissingEntries,
  buildHistoryManifest,
  parseHistoryManifest,
  validateAgainstHistoryManifest,
} from './history-manifest';
import { decisionsFor, historyManifestFor, makeFiles, makeJournal, must } from './fixtures';

describe('hashes', () => {
  it('hashMigrationSql is the plain SHA-256 of the text', () => {
    // sha256("abc")
    expect(hashMigrationSql('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('the canonical hash ignores CRLF, the raw hash does not', () => {
    const lf = 'SELECT 1;\nSELECT 2;\n';
    const crlf = 'SELECT 1;\r\nSELECT 2;\r\n';
    expect(canonicalMigrationHash(crlf)).toBe(canonicalMigrationHash(lf));
    expect(hashMigrationSql(crlf)).not.toBe(hashMigrationSql(lf));
  });

  it('registry candidates cover both line endings but not different content', () => {
    const lf = 'SELECT 1;\n';
    const candidates = registryHashCandidates(lf);
    expect(candidates).toContain(hashMigrationSql(lf));
    expect(candidates).toContain(hashMigrationSql('SELECT 1;\r\n'));
    expect(candidates).not.toContain(hashMigrationSql('SELECT 2;\n'));
  });
});

describe('history manifest', () => {
  const journal = makeJournal(6);
  const files = makeFiles(journal);
  const manifest = historyManifestFor(journal, files);

  it('describes every migration with idx, tag, when and sha256', () => {
    expect(manifest.entries).toHaveLength(6);
    expect(manifest.entries[3]).toEqual({ idx: 3, tag: must(journal[3]).tag, when: must(journal[3]).when, sha256: must(files.fileHashes[must(journal[3]).tag]), classification: 'ordinary', reviewedIn: 'retroactive-review:test:2026-01-01' });
  });

  it('validates a journal that matches', () => {
    expect(validateAgainstHistoryManifest(journal, files.fileHashes, manifest)).toEqual([]);
  });

  it('refuses a migration the manifest does not list (an unrecorded new migration)', () => {
    const longer = makeJournal(7);
    const diagnostics = validateAgainstHistoryManifest(longer, makeFiles(longer).fileHashes, manifest);
    expect(diagnostics.map((d) => d.code)).toEqual(['MANIFEST_ENTRY_MISSING']);
  });

  it('refuses a manifest entry the journal no longer has', () => {
    const shorter = makeJournal(5);
    const diagnostics = validateAgainstHistoryManifest(shorter, makeFiles(shorter).fileHashes, manifest);
    expect(diagnostics.map((d) => d.code)).toEqual(['MANIFEST_ENTRY_EXTRA']);
  });

  it('refuses a changed "when" or "idx"', () => {
    const changed = journal.map((e) => (e.idx === 2 ? { ...e, when: e.when + 1 } : e));
    const diagnostics = validateAgainstHistoryManifest(changed, files.fileHashes, manifest);
    expect(diagnostics.map((d) => d.code)).toEqual(['MANIFEST_FIELD_MISMATCH']);
    expect(diagnostics[0]?.details).toMatchObject({ field: 'when' });
  });

  it('refuses a file whose content changed', () => {
    const edited = makeFiles(journal, { [must(journal[3]).tag]: 'SELECT 999;\n' });
    const diagnostics = validateAgainstHistoryManifest(journal, edited.fileHashes, manifest);
    expect(diagnostics.map((d) => d.code)).toEqual(['MANIFEST_HASH_MISMATCH']);
    expect(diagnostics[0]?.migration).toBe(must(journal[3]).tag);
  });

  it('accepts a file that differs only in line endings', () => {
    const crlf = makeFiles(journal, { [must(journal[3]).tag]: `-- ${must(journal[3]).tag}\r\nSELECT 1;\r\n` });
    expect(validateAgainstHistoryManifest(journal, crlf.fileHashes, manifest)).toEqual([]);
  });

  it('does not hash a missing file (the journal validator reports it)', () => {
    const missing = { ...files.fileHashes, [must(journal[3]).tag]: null };
    expect(validateAgainstHistoryManifest(journal, missing, manifest)).toEqual([]);
  });

  it('build refuses to describe a migration without its file', () => {
    expect(() => buildHistoryManifest(journal, { ...files.fileHashes, [must(journal[0]).tag]: null }, decisionsFor(journal))).toThrow(/missing/);
  });
});

describe('parseHistoryManifest', () => {
  it('round-trips a manifest', () => {
    const journal = makeJournal(3);
    const manifest = historyManifestFor(journal, makeFiles(journal));
    const parsed = parseHistoryManifest(JSON.stringify(manifest));
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.manifest?.entries).toEqual(manifest.entries);
  });

  it.each([
    ['invalid JSON', '{'],
    ['wrong version', JSON.stringify({ manifestVersion: 1, hashAlgorithm: 'sha256', entries: [] })],
    ['wrong algorithm', JSON.stringify({ manifestVersion: 2, hashAlgorithm: 'md5', entries: [] })],
    ['no entries array', JSON.stringify({ manifestVersion: 2, hashAlgorithm: 'sha256' })],
    ['entry with a short hash', JSON.stringify({ manifestVersion: 2, hashAlgorithm: 'sha256', entries: [{ idx: 0, tag: 'a', when: 1, sha256: 'abc' }] })],
  ])('reports malformed manifest: %s', (_name, text) => {
    const parsed = parseHistoryManifest(text);
    expect(parsed.manifest).toBeNull();
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['MANIFEST_MALFORMED']);
  });
});

describe('appendMissingEntries (what --write does)', () => {
  const journal = makeJournal(4);
  const files = makeFiles(journal);

  it('appends only the new migrations and keeps the existing entries untouched', () => {
    const existing = buildHistoryManifest(journal.slice(0, 3), files.fileHashes, decisionsFor(journal));
    const result = appendMissingEntries(existing, journal, files.fileHashes, decisionsFor(journal));
    expect(result.conflicts).toEqual([]);
    expect(result.added).toEqual([must(journal[3]).tag]);
    expect(result.manifest.entries.slice(0, 3)).toEqual(existing.entries);
    expect(result.manifest.entries).toHaveLength(4);
  });

  it('adds nothing when the manifest is complete', () => {
    const complete = buildHistoryManifest(journal, files.fileHashes, decisionsFor(journal));
    const result = appendMissingEntries(complete, journal, files.fileHashes, decisionsFor(journal));
    expect(result.added).toEqual([]);
    expect(result.manifest).toEqual(complete);
  });

  it('refuses to regenerate an already-recorded migration whose file changed', () => {
    const existing = buildHistoryManifest(journal.slice(0, 3), files.fileHashes, decisionsFor(journal));
    const edited = makeFiles(journal, { [must(journal[1]).tag]: 'SELECT 42;\n' });
    const result = appendMissingEntries(existing, journal, edited.fileHashes);
    expect(result.conflicts.map((d) => d.code)).toEqual(['MANIFEST_HASH_MISMATCH']);
    expect(result.added).toEqual([]);
    expect(result.manifest).toBe(existing);
  });
});
