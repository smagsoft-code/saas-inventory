import { describe, expect, it } from 'vitest';
import { makeFiles, makeJournal, must, privilegedManifestFor, TAG_0000, TAG_0019 } from './fixtures';
import {
  findPrivilegedStatements,
  findUndeclaredPrivileged,
  parsePrivilegedManifest,
  privilegedTags,
  stripSqlComments,
  validatePrivilegedManifest,
} from './privileged-manifest';

describe('validatePrivilegedManifest', () => {
  const journal = makeJournal(25);
  const files = makeFiles(journal);
  const manifest = privilegedManifestFor(files);

  it('accepts a manifest that lists 0000 and 0019 with their real hashes', () => {
    expect(validatePrivilegedManifest(manifest, journal, files.fileHashes)).toEqual([]);
    expect([...privilegedTags(manifest)].sort()).toEqual([TAG_0000, TAG_0019].sort());
  });

  it('requires 0000 and 0019 to be listed, always', () => {
    const withoutOne = { ...manifest, entries: manifest.entries.filter((e) => e.tag !== TAG_0019) };
    const diagnostics = validatePrivilegedManifest(withoutOne, journal, files.fileHashes);
    expect(diagnostics.map((d) => d.code)).toEqual(['PRIVILEGED_MANIFEST_REQUIRED_MISSING']);
    expect(diagnostics[0]?.migration).toBe(TAG_0019);
  });

  it('refuses an entry whose tag is not in the journal', () => {
    const extra = { ...manifest, entries: [...manifest.entries, { tag: '0099_ghost', sha256: 'a'.repeat(64), reason: 'x' }] };
    expect(validatePrivilegedManifest(extra, journal, files.fileHashes).map((d) => d.code)).toEqual(['PRIVILEGED_MANIFEST_TAG_UNKNOWN']);
  });

  it('refuses a duplicated entry', () => {
    const dup = { ...manifest, entries: [...manifest.entries, must(manifest.entries[0])] };
    expect(validatePrivilegedManifest(dup, journal, files.fileHashes).map((d) => d.code)).toEqual(['PRIVILEGED_MANIFEST_DUPLICATE']);
  });

  it('refuses a privileged file whose content changed', () => {
    const edited = makeFiles(journal, { [TAG_0019]: 'CREATE ROLE evil;\n' });
    const diagnostics = validatePrivilegedManifest(manifest, journal, edited.fileHashes);
    expect(diagnostics.map((d) => d.code)).toEqual(['PRIVILEGED_MANIFEST_HASH_MISMATCH']);
  });
});

describe('parsePrivilegedManifest', () => {
  it.each([
    ['invalid JSON', '{'],
    ['wrong version', JSON.stringify({ manifestVersion: 2, entries: [] })],
    ['no entries', JSON.stringify({ manifestVersion: 1 })],
    ['entry without a reason', JSON.stringify({ manifestVersion: 1, entries: [{ tag: 'a', sha256: 'a'.repeat(64), reason: ' ' }] })],
    ['entry with a bad hash', JSON.stringify({ manifestVersion: 1, entries: [{ tag: 'a', sha256: 'zz', reason: 'r' }] })],
  ])('reports malformed manifest: %s', (_name, text) => {
    const parsed = parsePrivilegedManifest(text);
    expect(parsed.manifest).toBeNull();
    expect(parsed.diagnostics.map((d) => d.code)).toEqual(['PRIVILEGED_MANIFEST_MALFORMED']);
  });

  it('parses a valid manifest', () => {
    const text = JSON.stringify({ manifestVersion: 1, entries: [{ tag: 'a', sha256: 'a'.repeat(64), reason: 'because' }] });
    expect(parsePrivilegedManifest(text).manifest?.entries).toHaveLength(1);
  });
});

describe('undeclared privileged statements (safety net)', () => {
  it.each([
    ['CREATE ROLE x;', 'CREATE ROLE'],
    ['ALTER ROLE x WITH PASSWORD \'p\';', 'ALTER ROLE'],
    ['create extension if not exists pgcrypto;', 'CREATE EXTENSION'],
    ['RESET ROLE;', 'RESET ROLE'],
    ['SET ROLE app_migrator;', 'SET ROLE'],
    ['SET SESSION AUTHORIZATION postgres;', 'SET SESSION AUTHORIZATION'],
  ])('finds %s', (sql, name) => {
    expect(findPrivilegedStatements(sql)).toContain(name);
  });

  it('ignores ordinary DDL and DML', () => {
    expect(findPrivilegedStatements('ALTER TABLE a ADD COLUMN b text; INSERT INTO t VALUES (1); GRANT SELECT ON t TO app_tenant;')).toEqual([]);
  });

  it('ignores the words inside comments', () => {
    const sql = '-- RESET ROLE is explained here\n/* CREATE ROLE foo */\nSELECT 1;';
    expect(stripSqlComments(sql)).not.toMatch(/ROLE/);
    expect(findPrivilegedStatements(sql)).toEqual([]);
  });

  it('flags a migration that is not declared and skips one that is', () => {
    const journal = makeJournal(25);
    const files = makeFiles(journal, { [must(journal[5]).tag]: 'RESET ROLE;\nCREATE ROLE sneaky;\n' });
    const manifest = privilegedManifestFor(files);
    const diagnostics = findUndeclaredPrivileged(manifest, journal, files.sqlByTag);
    expect(diagnostics.map((d) => d.code)).toEqual(['PRIVILEGED_STATEMENT_UNDECLARED']);
    expect(diagnostics[0]?.migration).toBe(must(journal[5]).tag);

    const declared = { ...manifest, entries: [...manifest.entries, { tag: must(journal[5]).tag, sha256: must(files.fileHashes[must(journal[5]).tag]), reason: 'ok' }] };
    expect(findUndeclaredPrivileged(declared, journal, files.sqlByTag)).toEqual([]);
  });
});
