import { describe, expect, it } from 'vitest';
import { parseHistoryManifest, validateClassifications } from './history-manifest';
import { historyManifestFor, makeFiles, makeJournal, must } from './fixtures';

describe('explicit classification and review evidence (history manifest v2)', () => {
  const journal = makeJournal(21);
  const files = makeFiles(journal);
  const manifest = historyManifestFor(journal, files);
  const declared = new Set(['0000_extensions_and_roles', '0019_import_worker_role']);
  const withEntry = (tag: string, patch: Record<string, unknown>) => ({
    ...manifest,
    entries: manifest.entries.map((e) => (e.tag === tag ? { ...e, ...patch } : e)),
  });
  const tag5 = must(journal[5]).tag;

  it('accepts a fully classified and reviewed manifest', () => {
    expect(validateClassifications(manifest, declared)).toEqual([]);
  });

  it('blocks an entry without classification (absence is never "ordinary")', () => {
    const codes = validateClassifications(withEntry(tag5, { classification: null }), declared).map((d) => d.code);
    expect(codes).toEqual(['CLASSIFICATION_MISSING']);
  });

  it('a missing or non-enum classification in the file parses to null and blocks', () => {
    const raw = JSON.parse(JSON.stringify(manifest));
    delete raw.entries[5].classification;
    raw.entries[6].classification = 'maybe';
    const parsed = parseHistoryManifest(JSON.stringify(raw));
    expect(parsed.manifest).not.toBeNull();
    expect(validateClassifications(must(parsed.manifest), declared).map((d) => d.code)).toEqual(['CLASSIFICATION_MISSING', 'CLASSIFICATION_MISSING']);
  });

  it('blocks an entry without review evidence, or with a malformed one', () => {
    expect(validateClassifications(withEntry(tag5, { reviewedIn: null }), declared).map((d) => d.code)).toEqual(['REVIEW_EVIDENCE_MISSING']);
    expect(validateClassifications(withEntry(tag5, { reviewedIn: '   ' }), declared).map((d) => d.code)).toEqual(['REVIEW_EVIDENCE_MISSING']);
    for (const bad of ['approved', 'commit:xyz', 'pr:0', 'review:x:2026-1-1', 'TODO']) {
      expect(validateClassifications(withEntry(tag5, { reviewedIn: bad }), declared).map((d) => d.code)).toEqual(['REVIEW_EVIDENCE_INVALID']);
    }
  });

  it.each(['commit:2734363', 'pr:41', 'review:ADR-0041:2026-10-28', 'retroactive-review:D-7.2:2026-10-28'])('accepts the reference "%s"', (ref) => {
    expect(validateClassifications(withEntry(tag5, { reviewedIn: ref }), declared)).toEqual([]);
  });

  it('refuses "privileged" that the privileged manifest does not declare, and the reverse', () => {
    expect(validateClassifications(withEntry(tag5, { classification: 'privileged' }), declared).map((d) => d.code)).toEqual(['CLASSIFICATION_MISMATCH']);
    expect(validateClassifications(withEntry('0000_extensions_and_roles', { classification: 'ordinary' }), declared).map((d) => d.code)).toEqual([
      'CLASSIFICATION_MISMATCH',
    ]);
  });

  it('treats a version-1 manifest as malformed (it has no classification)', () => {
    const parsed = parseHistoryManifest(JSON.stringify({ manifestVersion: 1, hashAlgorithm: 'sha256', entries: [] }));
    expect(parsed.manifest).toBeNull();
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['MANIFEST_MALFORMED']);
  });
});
