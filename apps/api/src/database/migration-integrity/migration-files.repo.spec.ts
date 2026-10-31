import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessExecution } from './execution-guard';
import { hashMigrationSql } from './hash';
import { validateAgainstHistoryManifest } from './history-manifest';
import { validateJournal } from './journal-validator';
import { readMigrationsFolder } from './migration-files';
import { findUndeclaredPrivileged, validatePrivilegedManifest } from './privileged-manifest';
import { bootstrapFacts, incrementalFacts, must } from './fixtures';
import type { RegistryRow } from './types';

/**
 * Consistency of the REAL `database/migrations/` folder with its two manifests. Reads files only —
 * no database. If this fails after adding a migration, update the history manifest with:
 *   pnpm --filter @saas-inventory/api exec tsx src/database/migration-integrity/history-manifest.cli.ts --write
 * (privileged migrations are declared by hand in `privileged-manifest.json`).
 */

const DIR = join(__dirname, '..', '..', '..', '..', '..', 'database', 'migrations');
const folder = readMigrationsFolder(DIR);

describe('database/migrations (real files)', () => {
  it('reads the journal, the SQL files and both manifests without problems', () => {
    expect(folder.diagnostics).toEqual([]);
    expect(folder.journal.length).toBeGreaterThanOrEqual(51);
    expect(folder.historyManifest).not.toBeNull();
    expect(folder.privilegedManifest).not.toBeNull();
  });

  it('the journal is structurally valid', () => {
    expect(validateJournal(folder.journal, folder.fileHashes)).toEqual([]);
  });

  it('the history manifest describes every migration with the real hashes', () => {
    expect(validateAgainstHistoryManifest(folder.journal, folder.fileHashes, must(folder.historyManifest ?? undefined))).toEqual([]);
    expect(must(folder.historyManifest ?? undefined).entries).toHaveLength(folder.journal.length);
  });

  it('the privileged manifest lists 0000, 0019 and 0051 and matches the files', () => {
    const manifest = must(folder.privilegedManifest ?? undefined);
    expect(validatePrivilegedManifest(manifest, folder.journal, folder.fileHashes)).toEqual([]);
    expect(manifest.entries.map((e) => e.tag)).toEqual(['0000_extensions_and_roles', '0019_import_worker_role', '0051_qa_readonly_role']);
  });

  it('no other migration contains an undeclared privileged statement', () => {
    expect(findUndeclaredPrivileged(must(folder.privilegedManifest ?? undefined), folder.journal, folder.sqlByTag)).toEqual([]);
  });

  it('the hash of 0032 is the one Drizzle registered in the synthetic clusters of the D-3/D-4 runs', () => {
    // 0032_core_roles_manage_permission, as read from drizzle.__drizzle_migrations in PostgreSQL 16.15.
    const registered = 'd09d6ffbd2daf4514a56d84015f597717c126cf77de0ef5bec8daecb324cca4e';
    const candidates = folder.registryHashCandidates['0032_core_roles_manage_permission'];
    expect(candidates).toContain(registered);
    // with LF checkouts the raw hash is exactly the registered one
    if (!must(folder.sqlByTag['0032_core_roles_manage_permission']).includes('\r')) {
      expect(hashMigrationSql(must(folder.sqlByTag['0032_core_roles_manage_permission']))).toBe(registered);
    }
  });

  it('a registry Drizzle would write for these files is recognised as fully consistent', () => {
    const rows: RegistryRow[] = folder.journal.map((e) => ({ hash: hashMigrationSql(must(folder.sqlByTag[e.tag])), createdAt: e.when }));
    const r = assessExecution({
      config: { requestedMode: 'incremental', expectedDatabase: 'app' },
      facts: incrementalFacts(),
      journal: folder.journal,
      fileHashes: folder.fileHashes,
      registryHashCandidates: folder.registryHashCandidates,
      sqlByTag: folder.sqlByTag,
      registry: { kind: 'present', rows },
      publicTableCount: 54,
      historyManifest: must(folder.historyManifest ?? undefined),
      privilegedManifest: must(folder.privilegedManifest ?? undefined),
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.allowed).toBe(true);
    expect(r.classification.appliedCount).toBe(folder.journal.length);
  });

  it('a new database needs bootstrap; incremental is refused', () => {
    const base = {
      journal: folder.journal,
      fileHashes: folder.fileHashes,
      registryHashCandidates: folder.registryHashCandidates,
      sqlByTag: folder.sqlByTag,
      registry: { kind: 'absent' } as const,
      publicTableCount: 0,
      historyManifest: must(folder.historyManifest ?? undefined),
      privilegedManifest: must(folder.privilegedManifest ?? undefined),
    };
    expect(assessExecution({ ...base, config: { requestedMode: 'bootstrap', expectedDatabase: 'app' }, facts: bootstrapFacts() }).allowed).toBe(true);
    const refused = assessExecution({ ...base, config: { requestedMode: 'incremental', expectedDatabase: 'app' }, facts: incrementalFacts() });
    expect(refused.allowed).toBe(false);
    expect(refused.diagnostics.map((d) => d.code)).toContain('MODE_NEW_DATABASE_REQUIRES_BOOTSTRAP');
  });

  it('a database stopped before 0019 cannot continue incrementally', () => {
    const upTo0018 = folder.journal.slice(0, 19);
    const rows: RegistryRow[] = upTo0018.map((e) => ({ hash: hashMigrationSql(must(folder.sqlByTag[e.tag])), createdAt: e.when }));
    const r = assessExecution({
      config: { requestedMode: 'incremental', expectedDatabase: 'app' },
      facts: incrementalFacts(),
      journal: folder.journal,
      fileHashes: folder.fileHashes,
      registryHashCandidates: folder.registryHashCandidates,
      sqlByTag: folder.sqlByTag,
      registry: { kind: 'present', rows },
      publicTableCount: 40,
      historyManifest: must(folder.historyManifest ?? undefined),
      privilegedManifest: must(folder.privilegedManifest ?? undefined),
    });
    expect(r.allowed).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain('PRIVILEGED_MIGRATION_PENDING_IN_INCREMENTAL_MODE');
  });
});
